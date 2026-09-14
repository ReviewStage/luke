#if canImport(Sentry)
import Foundation
import Sentry

/// The shared Sentry start for Luke's Apple apps. What is enabled here is the
/// same narrow crash/error posture the desktop keeps: no replay, no tracing,
/// no screenshots, and no default PII collection.
public enum MobileSentry {
    public static func start(
        platform: MobileSentryPlatform,
        appVersion: String,
        enabled: Bool,
        bundle: Bundle = .main,
        processInfo: ProcessInfo = .processInfo
    ) {
        guard enabled,
              let configuration = MobileSentryConfiguration.load(
                  platform: platform,
                  appVersion: appVersion,
                  bundle: bundle,
                  processInfo: processInfo
              )
        else {
            return
        }
        SentrySDK.start { options in
            options.attachScreenshot = false
            options.dsn = configuration.dsn
            options.dist = configuration.dist
            options.enableAutoSessionTracking = true
            options.environment = configuration.environment
            options.releaseName = configuration.releaseName
            options.enableAppHangTracking = false
            options.enableCrashHandler = configuration.enableCrashHandler
            options.enableMetricKit = false
            options.enableWatchdogTerminationTracking = false
            options.sendDefaultPii = false
            options.tracesSampleRate = 0
        }
    }
}
#else
import Foundation

public enum MobileSentry {
    public static func start(
        platform: MobileSentryPlatform,
        appVersion: String,
        enabled: Bool,
        bundle: Bundle = .main,
        processInfo: ProcessInfo = .processInfo
    ) {
        _ = platform
        _ = appVersion
        _ = enabled
        _ = bundle
        _ = processInfo
    }
}
#endif
