import Foundation
import Security

// Keychain-backed storage for credentials received from the paired iPhone.
// Separate service string from the iOS app's KeychainStore so the two
// sandboxes never share a row.
enum WatchTokenStore {
    private static let service = "dev.tryluke.watchos"

    struct Tokens {
        var accessToken: String
        var refreshToken: String
        var expiry: Date
        var email: String
        var name: String?
        var accountID: String?
        var pictureURL: String?
    }

    private enum Key: String, CaseIterable {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiry = "token_expiry"
        case email
        case name
        case accountID = "account_id"
        case pictureURL = "picture_url"
    }

    static func save(_ tokens: Tokens) {
        set(tokens.accessToken, for: .accessToken)
        set(tokens.refreshToken, for: .refreshToken)
        set(String(tokens.expiry.timeIntervalSinceReferenceDate), for: .expiry)
        set(tokens.email, for: .email)
        tokens.name.map { set($0, for: .name) } ?? delete(.name)
        tokens.accountID.map { set($0, for: .accountID) } ?? delete(.accountID)
        tokens.pictureURL.map { set($0, for: .pictureURL) } ?? delete(.pictureURL)
    }

    static func load() -> Tokens? {
        guard let accessToken = get(.accessToken),
              let email = get(.email)
        else { return nil }
        let expiry: Date = {
            guard let s = get(.expiry), let t = TimeInterval(s) else { return Date() }
            return Date(timeIntervalSinceReferenceDate: t)
        }()
        return Tokens(
            accessToken: accessToken,
            refreshToken: get(.refreshToken) ?? "",
            expiry: expiry,
            email: email,
            name: get(.name),
            accountID: get(.accountID),
            pictureURL: get(.pictureURL)
        )
    }

    static func clear() {
        for key in Key.allCases { delete(key) }
    }

    @discardableResult
    private static func set(_ value: String, for key: Key) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }
        var query = baseQuery(for: key)
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = data
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    private static func get(_ key: Key) -> String? {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func delete(_ key: Key) {
        SecItemDelete(baseQuery(for: key) as CFDictionary)
    }

    private static func baseQuery(for key: Key) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            // AfterFirstUnlock lets writes succeed while the watch is locked,
            // which is the normal state when transferUserInfo delivers tokens.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
    }
}
