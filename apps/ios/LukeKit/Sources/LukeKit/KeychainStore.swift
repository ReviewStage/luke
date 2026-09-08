import Foundation
import Security

/// The account credentials one app holds. The phone writes them from its own
/// OAuth exchange; the watch writes the pair the phone hands it over
/// WatchConnectivity. Neither ever logs them or puts them in UserDefaults.
public struct StoredTokens: Sendable, Equatable {
    public var accessToken: String
    public var refreshToken: String
    public var expiry: Date
    public var email: String
    public var name: String?
    public var accountID: String?
    public var pictureURL: String?

    public init(
        accessToken: String,
        refreshToken: String,
        expiry: Date,
        email: String,
        name: String? = nil,
        accountID: String? = nil,
        pictureURL: String? = nil
    ) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiry = expiry
        self.email = email
        self.name = name
        self.accountID = accountID
        self.pictureURL = pictureURL
    }
}

/// When a keychain row may be read, which is the one thing the phone and the
/// watch answer differently. Both are ThisDeviceOnly: that is what keeps a
/// token out of an encrypted backup and off a restored second device, where it
/// would allow impersonation.
public enum KeychainAccessibility: Sendable {
    /// The phone's: nothing is read while the device is locked.
    case whenUnlocked
    /// The watch's: a write lands while the watch is locked, which is the
    /// normal state when `transferUserInfo` delivers tokens.
    case afterFirstUnlock

    var attribute: CFString {
        switch self {
        case .whenUnlocked: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        case .afterFirstUnlock: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        }
    }
}

/// Keychain-backed storage for account tokens. The service string and the
/// accessibility class are the only things the phone and the watch differ on,
/// so they are the parameters and there is one store rather than two.
public struct KeychainStore: Sendable {
    public enum Key: String, CaseIterable, Sendable {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiry = "token_expiry"
        case email
        case name
        case accountID = "account_id"
        case pictureURL = "picture_url"
    }

    private let service: String
    private let accessibility: KeychainAccessibility

    public init(service: String, accessibility: KeychainAccessibility) {
        self.service = service
        self.accessibility = accessibility
    }

    public static let phone = KeychainStore(
        service: "dev.tryluke.ios",
        accessibility: .whenUnlocked
    )

    /// A separate service string from the phone's, so the two sandboxes never
    /// share a row.
    public static let watch = KeychainStore(
        service: "dev.tryluke.watchos",
        accessibility: .afterFirstUnlock
    )

    /// Returns whether the write landed. A keychain can refuse writes outright
    /// (an unsigned development build on a fresh simulator), and a caller that
    /// cannot tell draws a signed-in surface whose credentials are not there.
    @discardableResult
    public func set(_ value: String, for key: Key) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }
        var query = baseQuery(for: key)
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = data
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    public func get(_ key: Key) -> String? {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func delete(_ key: Key) {
        SecItemDelete(baseQuery(for: key) as CFDictionary)
    }

    public func clearAll() {
        for key in Key.allCases { delete(key) }
    }

    /// Returns whether every credential the restore above gates on landed.
    /// The name, id, and picture are cosmetic and do not decide it; each is
    /// deleted when absent, so a photo removed at the provider does not
    /// outlive the provider's own answer.
    @discardableResult
    public func save(_ tokens: StoredTokens) -> Bool {
        let persisted = [
            set(tokens.accessToken, for: .accessToken),
            set(tokens.refreshToken, for: .refreshToken),
            set(String(tokens.expiry.timeIntervalSinceReferenceDate), for: .expiry),
            set(tokens.email, for: .email),
        ]
        write(tokens.name, to: .name)
        write(tokens.accountID, to: .accountID)
        write(tokens.pictureURL, to: .pictureURL)
        return persisted.allSatisfy { $0 }
    }

    public func load() -> StoredTokens? {
        guard let accessToken = get(.accessToken), let email = get(.email) else { return nil }
        return StoredTokens(
            accessToken: accessToken,
            refreshToken: get(.refreshToken) ?? "",
            expiry: storedExpiry,
            email: email,
            name: get(.name),
            accountID: get(.accountID),
            pictureURL: get(.pictureURL)
        )
    }

    /// An unreadable expiry reads as now, which is near expiry, so a token
    /// whose deadline was lost is treated as spent rather than as valid.
    private var storedExpiry: Date {
        guard let stored = get(.expiry), let interval = TimeInterval(stored) else { return Date() }
        return Date(timeIntervalSinceReferenceDate: interval)
    }

    private func write(_ value: String?, to key: Key) {
        if let value { set(value, for: key) } else { delete(key) }
    }

    private func baseQuery(for key: Key) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecAttrAccessible as String: accessibility.attribute,
        ]
    }
}
