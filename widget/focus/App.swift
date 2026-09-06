import AppKit
import WebKit
import Speech
import AVFoundation

final class FocusApp: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, AVSpeechSynthesizerDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var worker: Process!
    let input = Pipe()
    var outputBuffer = Data()
    let ioQueue = DispatchQueue(label: "onejob.worker")
    let engine = AVAudioEngine()
    let recognizer = SFSpeechRecognizer(locale: Locale.current)
    var request: SFSpeechAudioBufferRecognitionRequest?
    var recognition: SFSpeechRecognitionTask?
    var listening = false
    var tapInstalled = false
    var transcript = ""
    var voiceTimer: Timer?
    let speech = AVSpeechSynthesizer()
    var dataDirectory: URL!

    func applicationDidFinishLaunching(_ notification: Notification) {
        signal(SIGPIPE, SIG_IGN)
        speech.delegate = self
        let menu = NSMenu()
        let item = NSMenuItem(); menu.addItem(item)
        let submenu = NSMenu(); submenu.addItem(withTitle: "Quit onejob", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"); item.submenu = submenu
        let edit = NSMenuItem(); menu.addItem(edit); let editMenu = NSMenu(title: "Edit"); edit.submenu = editMenu
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        NSApp.mainMenu = menu
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "focus")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1080, height: 800), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "onejob"; window.minSize = NSSize(width: 720, height: 650)
        window.backgroundColor = NSColor(calibratedRed: 0.094, green: 0.106, blue: 0.094, alpha: 1)
        window.contentView = web; window.center(); window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        do {
            let resources = Bundle.main.resourceURL!
            let override = ProcessInfo.processInfo.environment["ONEJOB_DATA"]
            dataDirectory = override.map { URL(fileURLWithPath: $0, isDirectory: true) } ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("onejob", isDirectory: true)
            try FileManager.default.createDirectory(at: dataDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            worker = Process()
            worker.executableURL = resources.appendingPathComponent("node")
            let workspace = override.map { URL(fileURLWithPath: $0, isDirectory: true).appendingPathComponent("workspace") } ?? FileManager.default.urls(for: .desktopDirectory, in: .userDomainMask)[0].appendingPathComponent("onejob")
            worker.arguments = [resources.appendingPathComponent("ui/server/focus/main.mjs").path, dataDirectory.path, resources.appendingPathComponent("OnejobSearch").path, workspace.path, resources.appendingPathComponent("OnejobKeychain").path]
            worker.standardInput = input
            let output = Pipe(); worker.standardOutput = output
            worker.standardError = FileHandle.nullDevice
            output.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                if data.isEmpty { handle.readabilityHandler = nil; return }
                self?.ioQueue.async { self?.consume(data) }
            }
            worker.terminationHandler = { [weak self] process in
                DispatchQueue.main.async { self?.emit(["event": "error", "message": "The local service stopped. Reopen onejob; your saved notes remain on this Mac."]) }
            }
            try worker.run()
            web.loadFileURL(resources.appendingPathComponent("widget/focus/ui/index.html"), allowingReadAccessTo: resources)
        } catch {
            let alert = NSAlert(); alert.messageText = "onejob could not start"; alert.informativeText = error.localizedDescription; alert.runModal()
        }
    }
    func consume(_ data: Data) {
        outputBuffer.append(data)
        while let newline = outputBuffer.firstIndex(of: 10) {
            let line = outputBuffer.prefix(upTo: newline); outputBuffer.removeSubrange(...newline)
            do {
                let value = try JSONSerialization.jsonObject(with: line) as? [String: Any] ?? [:]
                DispatchQueue.main.async {
                    if let result = value["result"] as? [String: Any], let path = result["workspaceToOpen"] as? String {
                        NSWorkspace.shared.open(URL(fileURLWithPath: path, isDirectory: true))
                    }
                    self.emit(value)
                }
            } catch { DispatchQueue.main.async { self.emit(["event": "error", "message": "The local service returned an unreadable response."]) } }
        }
    }
    func emit(_ value: [String: Any]) {
        do {
            let data = try JSONSerialization.data(withJSONObject: value)
            // Base64 keeps source text out of executable JavaScript syntax.
            let encoded = data.base64EncodedString()
            web.evaluateJavaScript("window.focusReceive(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('\(encoded)'),c=>c.charCodeAt(0)))))", completionHandler: nil)
        } catch { NSLog("onejob: response encoding failed") }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard NativePolicy.trustedPage(message.frameInfo.request.url, expected: Bundle.main.resourceURL?.appendingPathComponent("widget/focus/ui/index.html"), mainFrame: message.frameInfo.isMainFrame),
              let body = message.body as? [String: Any], let id = body["id"], let method = body["method"] as? String else { return }
        let params = body["params"] as? [String: Any] ?? [:]
        func done(_ result: Any = [:]) { emit(["id": id, "result": result]) }
        switch method {
        case "showArtifacts":
            do {
                let folder = dataDirectory.appendingPathComponent("artifacts")
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                NSWorkspace.shared.open(folder); done()
            } catch let error { _ = error; emit(["id":id,"error":"Could not open the documents folder."]) }
        case "startListening": startListening(); done()
        case "stopListening": stopListening(); done()
        case "speak":
            if let text = params["text"] as? String { speech.stopSpeaking(at: .immediate); speech.speak(AVSpeechUtterance(string: String(text.prefix(12000)))) }; done()
        case "stopSpeech": speech.stopSpeaking(at: .immediate); done()
        case "openAside":
            NSWorkspace.shared.open(URL(fileURLWithPath: "/Applications/Aside.app")); done()
        case "openServiceAuth":
            if let text = params["url"] as? String, let url = NativePolicy.serviceLoginURL(text) {
                NSWorkspace.shared.open(url); done()
            } else { emit(["id": id, "error": "Unexpected service sign-in address."]) }
        case "openAuth":
            if let text = params["url"] as? String, let url = NativePolicy.loginURL(text) {
                NSWorkspace.shared.open(url); done()
            } else { emit(["id": id, "error": "Unexpected sign-in address."]) }
        case "claudeLogin":
            do {
                let file = dataDirectory.appendingPathComponent("Claude Code sign-in.command")
                let script = "#!/bin/zsh\nexport PATH=\"$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin\"\nclaude auth login\n"
                try script.write(to: file, atomically: true, encoding: .utf8)
                try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: file.path)
                NSWorkspace.shared.open(file); done()
            } catch { emit(["id": id, "error": "Could not open Claude Code sign-in. Run claude auth login in Terminal."]) }
        default:
            do { var data = try JSONSerialization.data(withJSONObject: body); data.append(10); try input.fileHandleForWriting.write(contentsOf: data) }
            catch { emit(["id": id, "error": "The local service is unavailable. Reopen onejob."]) }
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let target = navigationAction.request.url?.standardizedFileURL
        let expected = Bundle.main.resourceURL?.appendingPathComponent("widget/focus/ui/index.html").standardizedFileURL
        decisionHandler(target == expected ? .allow : .cancel)
    }
    func startListening() {
        speech.stopSpeaking(at: .immediate)
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard status == .authorized else { self?.emit(["event": "error", "message": "Enable Speech Recognition for onejob in System Settings, or use text."]); return }
                AVCaptureDevice.requestAccess(for: .audio) { allowed in
                    DispatchQueue.main.async {
                        if allowed { self?.record() }
                        else { self?.emit(["event": "error", "message": "Enable microphone access in System Settings, or use text."]) }
                    }
                }
            }
        }
    }
    func record() {
        guard !listening else { return }
        guard let recognizer = recognizer, recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
            emit(["event": "error", "message": "On-device speech recognition is unavailable for this language. You can still type."]); return
        }
        let request = SFSpeechAudioBufferRecognitionRequest(); request.requiresOnDeviceRecognition = true; request.shouldReportPartialResults = true
        self.request = request; transcript = ""
        let mic = engine.inputNode
        let format = mic.outputFormat(forBus: 0)
        guard NativePolicy.mayRecord(authorized: SFSpeechRecognizer.authorizationStatus() == .authorized, microphone: AVCaptureDevice.authorizationStatus(for: .audio) == .authorized, available: recognizer.isAvailable, onDevice: recognizer.supportsOnDeviceRecognition, sampleRate: format.sampleRate, channels: format.channelCount) else { emit(["event": "error", "message": "On-device recording is unavailable. Check microphone and speech permissions."]); return }
        mic.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, time in request.append(buffer) }; tapInstalled = true
        recognition = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                if let result = result {
                    self?.transcript = result.bestTranscription.formattedString
                    self?.emit(["event": "transcript", "text": result.bestTranscription.formattedString])
                    if result.isFinal { self?.stopListening() }
                }
                if error != nil { self?.stopListening() }
            }
        }
        do {
            engine.prepare(); try engine.start(); listening = true
            emit(["event": "voice", "listening": true, "message": "Listening on this Mac. Tap again when you’re done."])
            voiceTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: false) { [weak self] _ in self?.stopListening() }
        } catch { stopListening(); emit(["event": "error", "message": "The microphone could not start. You can still type."]) }
    }
    func stopListening() {
        voiceTimer?.invalidate(); voiceTimer = nil
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        request?.endAudio(); request = nil
        recognition?.cancel(); recognition = nil; listening = false
        emit(["event": "voice", "listening": false, "message": transcript.isEmpty ? "Tap the orb to speak, or write below." : "Review your words, then send."])
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) { emit(["event": "speech", "speaking": true]) }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) { emit(["event": "speech", "speaking": false]) }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) { emit(["event": "speech", "speaking": false]) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { stopListening(); speech.stopSpeaking(at: .immediate); try? input.fileHandleForWriting.close(); worker?.terminate() }
}

let app = NSApplication.shared
let delegate = FocusApp()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
