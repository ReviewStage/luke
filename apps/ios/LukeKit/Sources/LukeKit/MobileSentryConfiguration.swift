import Foundation

/// The Apple apps' shared Sentry posture: one DSN gate, one release naming
/// scheme, and the one platform difference Sentry's own support matrix keeps
/// today — native crash capture on iPhone, but not on watchOS.
public enum MobileSentryPlatform: String, Equatable, Sendable {
    case iOS = "ios"
    case watchOS = "watchos"

    var supportsNativeCrashReports: Bool {
        switch self {
        case .iOS:
            true
        case .watchOS:
            false
        }
    }
}

public struct MobileSentryConfiguration: Equatable, Sendable {
    public static let dsnEnvironmentKey = "LUKE_SENTRY_DSN"
    public static let dsnInfoDictionaryKey = "LukeSentryDSN"

    public let dsn: String
    public let dist: String?
    public let enableCrashHandler: Bool
    public let environment: String
    public let releaseName: String

    public static func load(
        platform: MobileSentryPlatform,
        appVersion: String,
        bundle: Bundle = .main,
        processInfo: ProcessInfo = .processInfo
    ) -> MobileSentryConfiguration? {
        resolve(
            platform: platform,
            appVersion: appVersion,
            infoDictionary: bundle.infoDictionary ?? [:],
            environment: processInfo.environment
        )
    }

    static func resolve(
        platform: MobileSentryPlatform,
        appVersion: String,
        infoDictionary: [String: Any],
        environment: [String: String]
    ) -> MobileSentryConfiguration? {
        guard let dsn = sentryDSN(infoDictionary: infoDictionary, environment: environment) else {
            return nil
        }
        return MobileSentryConfiguration(
            dsn: dsn,
            dist: trimmed(infoDictionary["CFBundleVersion"] as? String),
            enableCrashHandler: platform.supportsNativeCrashReports,
            environment: buildEnvironment,
            releaseName: "Luke@\(appVersion)"
        )
    }

    private static func sentryDSN(
        infoDictionary: [String: Any],
        environment: [String: String]
    ) -> String? {
        #if DEBUG
        if let override = trimmed(environment[dsnEnvironmentKey]) {
            return override
        }
        #endif
        return trimmed(infoDictionary[dsnInfoDictionaryKey] as? String)
    }

    private static func trimmed(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static var buildEnvironment: String {
        #if DEBUG
        "development"
        #else
        "production"
        #endif
    }
}
