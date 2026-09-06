import Foundation

enum NativePolicy {
    static func trustedPage(_ url: URL?, expected: URL?, mainFrame: Bool) -> Bool {
        mainFrame && url?.isFileURL == true && url?.standardizedFileURL == expected?.standardizedFileURL
    }
    static func loginURL(_ text: String) -> URL? {
        guard let url = URL(string: text), url.scheme == "https",
              ["auth.openai.com", "chatgpt.com"].contains(url.host ?? ""),
              url.user == nil, url.password == nil else { return nil }
        return url
    }
    static func serviceLoginURL(_ text: String) -> URL? {
        guard let url = URL(string: text), url.scheme == "https",
              ["mcp.notion.com", "mcp.linear.app"].contains(url.host ?? ""),
              url.port == nil || url.port == 443, url.user == nil, url.password == nil, url.fragment == nil else { return nil }
        return url
    }
    static func mayRecord(authorized: Bool, microphone: Bool, available: Bool, onDevice: Bool, sampleRate: Double, channels: UInt32) -> Bool {
        authorized && microphone && available && onDevice && sampleRate > 0 && channels > 0
    }
}
