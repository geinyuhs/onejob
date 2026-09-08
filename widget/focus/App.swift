import AppKit
import WebKit
import Speech
import AVFoundation

final class FocusApp: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, AVSpeechSynthesizerDelegate {
    var statusItem: NSStatusItem!
    var fileMenuItem: NSMenuItem!
    var orbPanels: [String:NSPanel] = [:]
    var jobs: [[String:Any]] = []
    var nativeRequests = Set<String>()
    var nativeCallbacks: [String:([String:Any])->Void] = [:]
    var audioRecorder: AVAudioRecorder?
    var audioFile: URL?
    var transcribing = false
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
    var voiceGeneration: UUID?
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
        let file = NSMenuItem(); fileMenuItem = file; menu.insertItem(file, at: 1)
        let fileMenu = NSMenu(title: "File"); file.submenu = fileMenu
        let newItem = fileMenu.addItem(withTitle: "New onejob", action: #selector(newJob), keyEquivalent: "n"); newItem.target = self
        NSApp.servicesProvider = self
        NSUpdateDynamicServices()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "◉"
        rebuildMenu()
        NotificationCenter.default.addObserver(self, selector: #selector(layoutOrbs), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        NSApp.mainMenu = menu
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "focus")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1080, height: 800), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
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
        } catch let error {
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
                    if let result = value["result"] as? [String:Any], let jobs = result["jobs"] as? [[String:Any]] { self.updateOrbs(jobs) }
                    if let id = value["id"] as? String, let callback = self.nativeCallbacks.removeValue(forKey:id) {callback(value)}
                    else if let id = value["id"] as? String, self.nativeRequests.remove(id) != nil {
                        if let result = value["result"] as? [String:Any] {self.emit(["event":"jobSelected","state":result])}
                        else if let error = value["error"] as? String {self.emit(["event":"error","message":error])}
                    } else {self.emit(value)}
                }
            } catch let error { DispatchQueue.main.async { self.emit(["event": "error", "message": "The local service returned an unreadable response."]) } }
        }
    }
    @objc func newJob() { requestJob("newJob") }
    @objc func newOnejobService(_ pasteboard: NSPasteboard, userData: String?, error: AutoreleasingUnsafeMutablePointer<NSString>) { newJob() }
    @objc func chooseJob(_ sender: NSMenuItem) { requestJob("selectJob", id: sender.representedObject as? String) }
    @objc func chooseOrb(_ sender: NSButton) { requestJob("selectJob", id: sender.identifier?.rawValue) }
    func requestJob(_ method: String, id: String? = nil) {
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        guard NativePolicy.canSwitchJob(listening:listening,transcribing:transcribing) else {emit(["event":"error","message":"Finish dictation before switching jobs."]); return}
        let requestId = "native-" + UUID().uuidString
        do {
            var message: [String:Any] = ["id":requestId,"method":method,"params":id.map {["id":$0]} ?? [:]]
            message["id"] = requestId
            var data = try JSONSerialization.data(withJSONObject: message); data.append(10)
            nativeRequests.insert(requestId); try input.fileHandleForWriting.write(contentsOf: data)
        } catch let error { _ = error; nativeRequests.remove(requestId); emit(["event":"error","message":"Could not open the job. Reopen onejob."]) }
    }
    func rebuildMenu() {
        let menu = NSMenu()
        let create = menu.addItem(withTitle: "New onejob", action: #selector(newJob), keyEquivalent: "n"); create.target = self
        menu.addItem(.separator())
        for job in jobs {
            let item = menu.addItem(withTitle: job["title"] as? String ?? "onejob", action: #selector(chooseJob(_:)), keyEquivalent: "")
            item.target = self; item.representedObject = job["id"]; item.state = (job["active"] as? Int == 1) ? .on : .off
        }
        menu.addItem(.separator()); menu.addItem(withTitle: "Quit onejob", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = menu
        let fileCopy = menu.copy() as! NSMenu; fileCopy.title = "File"
        fileCopy.removeItem(at:fileCopy.numberOfItems-1); fileCopy.removeItem(at:fileCopy.numberOfItems-1)
        fileMenuItem.submenu = fileCopy
    }
    func updateOrbs(_ current: [[String:Any]]) {
        jobs = current
        let live = Set(current.compactMap {$0["id"] as? String})
        for id in Array(orbPanels.keys) where !live.contains(id) {orbPanels.removeValue(forKey: id)?.close()}
        for (index,job) in jobs.enumerated() {
            let id = job["id"] as! String
            let panel: NSPanel
            if let existing = orbPanels[id] {panel = existing}
            else {
                panel = NSPanel(contentRect: NSRect(x:0,y:0,width:82,height:82),styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
                panel.isReleasedWhenClosed = false; panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = true
                panel.level = .floating; panel.collectionBehavior = [.canJoinAllSpaces,.fullScreenAuxiliary]; panel.hidesOnDeactivate = false
                let button = JobOrbButton(frame:NSRect(x:0,y:0,width:82,height:82)); button.isBordered = false
                button.target = self; button.action = #selector(chooseOrb(_:)); button.identifier = NSUserInterfaceItemIdentifier(id)
                panel.contentView = button; orbPanels[id] = panel
            }
            let button = panel.contentView as! JobOrbButton
            button.number = index + 1; button.selected = job["active"] as? Int == 1
            button.toolTip = job["title"] as? String; button.setAccessibilityLabel("Open onejob: " + (job["title"] as? String ?? "New onejob")); button.needsDisplay = true
            panel.orderFrontRegardless()
        }
        layoutOrbs(); rebuildMenu()
    }
    @objc func layoutOrbs() {
        let frame = NSScreen.screens.first?.visibleFrame ?? NSRect(x:0,y:0,width:1440,height:900)
        let rows = max(1,Int((frame.height - 20) / 82))
        for (index,job) in jobs.enumerated() {
            let id = job["id"] as! String
            orbPanels[id]?.setFrameOrigin(NSPoint(x:frame.minX + 6 + CGFloat(index / rows) * 78,y:frame.maxY - 92 - CGFloat(index % rows) * 82))
        }
    }
    func applicationDidBecomeActive(_ notification: Notification) {emit(["event":"accountChanged"])}
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {window.makeKeyAndOrderFront(nil); return true}
    func emit(_ value: [String: Any]) {
        do {
            let data = try JSONSerialization.data(withJSONObject: value)
            // Base64 keeps source text out of executable JavaScript syntax.
            let encoded = data.base64EncodedString()
            web.evaluateJavaScript("window.focusReceive(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('\(encoded)'),c=>c.charCodeAt(0)))))", completionHandler: nil)
        } catch let error { NSLog("onejob: response encoding failed") }
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
        case "chooseVoiceKey":
            let picker = NSOpenPanel(); picker.canChooseDirectories = false; picker.allowsMultipleSelection = false
            picker.message = "Choose a 0600 file containing an OpenAI API key. Dictation sends your recording directly to OpenAI, with separate API billing."
            picker.beginSheetModal(for:window) { response in
                if response == .OK, let url = picker.url {self.nativeCall("importVoiceKey",params:["path":url.path]) { value in
                    self.emit(["event":"voiceSetup","message":value["error"] as? String ?? "OpenAI dictation is ready. Recordings go directly to OpenAI."])
                }}
            }; done()
        case "startListening":
            nativeCall("voiceStatus") { value in
                if (value["result"] as? [String:Any])?["ready"] as? Bool == true {self.startCloudDictation()}
                else {self.startListening()}
            }; done()
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
            } catch let error { emit(["id": id, "error": "Could not open Claude Code sign-in. Run claude auth login in Terminal."]) }
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
    func nativeCall(_ method: String, params: [String:Any] = [:], completion: @escaping ([String:Any])->Void) {
        let id = "native-" + UUID().uuidString
        do {
            var data = try JSONSerialization.data(withJSONObject:["id":id,"method":method,"params":params]); data.append(10)
            nativeCallbacks[id] = completion; try input.fileHandleForWriting.write(contentsOf:data)
        } catch let error {_ = error;nativeCallbacks.removeValue(forKey:id);completion(["error":"The local service is unavailable."])}
    }
    func startCloudDictation() {
        guard !listening && !transcribing else {return}
        AVCaptureDevice.requestAccess(for:.audio) { allowed in DispatchQueue.main.async {
            if !allowed {self.emit(["event":"error","message":"Enable microphone access in System Settings, or type."]);return}
            do {
                let folder = self.dataDirectory.appendingPathComponent("recordings",isDirectory:true)
                try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
                let url = folder.appendingPathComponent(UUID().uuidString + ".m4a"); self.audioFile = url
                self.audioRecorder = try AVAudioRecorder(url:url,settings:[AVFormatIDKey:kAudioFormatMPEG4AAC,AVSampleRateKey:24000,AVNumberOfChannelsKey:1,AVEncoderBitRateKey:64000,AVEncoderAudioQualityKey:AVAudioQuality.high.rawValue])
                try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:url.path)
                guard self.audioRecorder?.record() == true else {throw NSError(domain:"onejob",code:1)}
                self.listening = true;self.transcript = ""
                self.emit(["event":"voice","listening":true,"message":"Recording for OpenAI dictation. Tap Finish speaking when you’re done."])
                self.voiceTimer = Timer.scheduledTimer(withTimeInterval:1200,repeats:false) { [weak self] _ in self?.stopListening() }
            } catch let error {_ = error;self.discardAudio();self.emit(["event":"error","message":"The microphone could not start."])}
        }}
    }
    func discardAudio() {
        audioRecorder?.stop();audioRecorder = nil
        if let url = audioFile {do{try FileManager.default.removeItem(at:url)}catch let error{_ = error;NSLog("onejob: temporary recording cleanup failed")}}
        audioFile = nil
    }
    func finishCloudDictation() {
        audioRecorder?.stop();audioRecorder = nil;listening = false;transcribing = true
        do {
            let data = try Data(contentsOf:audioFile!)
            discardAudio()
            emit(["event":"voice","listening":false,"transcribing":true,"message":"Transcribing with OpenAI…"])
            nativeCall("transcribe",params:["audio":data.base64EncodedString()]) { value in
                self.transcribing = false
                if let result = value["result"] as? [String:Any], let text = result["text"] as? String {self.transcript = text;self.emit(["event":"transcript","text":text])}
                self.emit(["event":"voice","listening":false,"message":value["error"] as? String ?? "Review your words before continuing."])
            }
        } catch let error {_ = error;discardAudio();transcribing = false;emit(["event":"voice","listening":false,"message":"Could not read the recording. Please try again."])}
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
        let generation = UUID(); voiceGeneration = generation
        self.request = request; transcript = ""
        let mic = engine.inputNode
        let format = mic.outputFormat(forBus: 0)
        guard NativePolicy.mayRecord(authorized: SFSpeechRecognizer.authorizationStatus() == .authorized, microphone: AVCaptureDevice.authorizationStatus(for: .audio) == .authorized, available: recognizer.isAvailable, onDevice: recognizer.supportsOnDeviceRecognition, sampleRate: format.sampleRate, channels: format.channelCount) else { emit(["event": "error", "message": "On-device recording is unavailable. Check microphone and speech permissions."]); return }
        mic.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, time in request.append(buffer) }; tapInstalled = true
        recognition = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard NativePolicy.acceptTranscript(current:self?.voiceGeneration,incoming:generation) else {return}
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
        } catch let error { stopListening(); emit(["event": "error", "message": "The microphone could not start. You can still type."]) }
    }
    func stopListening() {
        voiceTimer?.invalidate(); voiceTimer = nil
        if audioRecorder != nil {finishCloudDictation();return}
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        request?.endAudio(); request = nil
        voiceGeneration = nil; recognition?.cancel(); recognition = nil; listening = false
        emit(["event": "voice", "listening": false, "message": transcript.isEmpty ? "Tap the orb to speak, or write below." : "Review your words, then send."])
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) { emit(["event": "speech", "speaking": true]) }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) { emit(["event": "speech", "speaking": false]) }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) { emit(["event": "speech", "speaking": false]) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) { discardAudio(); stopListening(); speech.stopSpeaking(at: .immediate); try? input.fileHandleForWriting.close(); worker?.terminate() }
}

let app = NSApplication.shared
let delegate = FocusApp()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
