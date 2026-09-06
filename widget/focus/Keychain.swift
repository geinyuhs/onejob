import Foundation
import Security

// Secrets travel over private stdin/stdout pipes, never process arguments.
func respond(_ value: [String: Any]) {
    do { let bytes = try JSONSerialization.data(withJSONObject: value); FileHandle.standardOutput.write(bytes) }
    catch let error { _ = error; exit(1) }
}
do {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    let request = try JSONSerialization.jsonObject(with: input) as? [String: Any] ?? [:]
    let key = request["key"] as? String ?? ""
    guard key.range(of: "^[a-z0-9-]{1,128}$", options: .regularExpression) != nil else { respond(["error":"Invalid key"]); exit(1) }
    let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:"app.onejob.oauth", kSecAttrAccount as String:key, kSecAttrSynchronizable as String:false]
    switch request["operation"] as? String {
    case "read":
        var lookup = query; lookup[kSecReturnData as String] = true; lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecItemNotFound { respond(["value":NSNull()]) }
        else if status == errSecSuccess, let data = result as? Data { respond(["value":try JSONSerialization.jsonObject(with:data)]) }
        else { respond(["error":"Keychain unavailable"]); exit(1) }
    case "write":
        let data = try JSONSerialization.data(withJSONObject:request["value"] ?? NSNull(), options:.fragmentsAllowed)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String:data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query; item[kSecValueData as String] = data; item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(item as CFDictionary,nil) == errSecSuccess else { respond(["error":"Keychain unavailable"]); exit(1) }
        } else if status != errSecSuccess { respond(["error":"Keychain unavailable"]); exit(1) }
        respond(["value":true])
    case "remove":
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { respond(["error":"Keychain unavailable"]); exit(1) }
        respond(["value":true])
    default: respond(["error":"Unknown operation"]); exit(1)
    }
} catch let error { _ = error; respond(["error":"Keychain request failed"]); exit(1) }
