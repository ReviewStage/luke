import Foundation

public enum AccountConstants {
    public static let baseURL: URL = {
        #if DEBUG
        if let override = ProcessInfo.processInfo.environment["LUKE_ACCOUNT_BASE_URL"],
           let url = URL(string: override)
        {
            return url
        }
        #endif
        // swiftlint:disable:next force_unwrapping
        return URL(string: "https://tryluke.dev/api/auth")!
    }()

    /// The hosted service origin. The auth base lives under `/api/auth`,
    /// vault endpoints under `/api/vault`, and observe under `/api/observe`.
    public static let serviceURL: URL = {
        #if DEBUG
        if let override = ProcessInfo.processInfo.environment["LUKE_SERVICE_BASE_URL"],
           let url = URL(string: override)
        {
            return url
        }
        #endif
        // swiftlint:disable:next force_unwrapping
        return URL(string: "https://tryluke.dev")!
    }()

    public static let clientID = "luke-mobile"
    public static let redirectURI = "dev.tryluke.ios://oauth/callback"
    static let scopes = "openid profile email offline_access"
}
