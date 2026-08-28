import Foundation
import Security

/// Keychain-backed storage for account tokens. No tokens are logged or stored in UserDefaults.
enum KeychainStore {
    private static let service = "dev.tryluke.ios"

    enum Key: String {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiry = "token_expiry"
        case email
        case name
        case accountID = "account_id"
    }

    static func set(_ value: String, for key: Key) {
        guard let data = value.data(using: .utf8) else { return }
        var query = baseQuery(for: key)
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = data
        SecItemAdd(query as CFDictionary, nil)
    }

    static func get(_ key: Key) -> String? {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(_ key: Key) {
        SecItemDelete(baseQuery(for: key) as CFDictionary)
    }

    static func clearAll() {
        for key in [Key.accessToken, .refreshToken, .expiry, .email, .name, .accountID] {
            delete(key)
        }
    }

    private static func baseQuery(for key: Key) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
        ]
    }
}
