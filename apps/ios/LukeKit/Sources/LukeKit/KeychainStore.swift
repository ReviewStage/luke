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
        case pictureURL = "picture_url"
    }

    /// Returns whether the write landed. A keychain can refuse writes outright
    /// (an unsigned development build on a fresh simulator), and a caller that
    /// cannot tell draws a signed-in surface whose credentials are not there.
    @discardableResult
    static func set(_ value: String, for key: Key) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }
        var query = baseQuery(for: key)
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = data
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
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
        for key in [Key.accessToken, .refreshToken, .expiry, .email, .name, .accountID, .pictureURL] {
            delete(key)
        }
    }

    private static func baseQuery(for key: Key) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            // ThisDeviceOnly prevents tokens from being included in encrypted backups
            // or restored onto a different device, which would allow impersonation.
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
    }
}
