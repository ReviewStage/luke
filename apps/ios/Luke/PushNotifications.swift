import LukeKit
import Observation
import UIKit
import UserNotifications

/// A notification's tap, as the payload named it: the session to open.
/// Mirrors `WATCH_PAYLOAD_KEY` in `apps/web/server/hosted/watch.ts`.
struct PushOpen: Equatable {
    let providerId: String
    let sessionId: String

    init?(userInfo: [AnyHashable: Any]) {
        guard let providerId = userInfo["providerId"] as? String, !providerId.isEmpty,
              let sessionId = userInfo["sessionId"] as? String, !sessionId.isEmpty
        else { return nil }
        self.providerId = providerId
        self.sessionId = sessionId
    }
}

/// The app's one door to Apple's push machinery. It asks the system for
/// notification permission once the account is signed in — being signed in
/// on this phone is what asks for notifications; there is no switch — hands
/// the token Apple issues to the registrar, and turns a tapped notification
/// into a pending open the signed-in hierarchy consumes. It shows nothing and
/// decides nothing about a notification's words: those are the service's,
/// composed from what a provider wrote about a session.
@MainActor
@Observable
final class PushCoordinator: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    /// The tap not yet answered by a screen, if any.
    var pendingOpen: PushOpen?
    @ObservationIgnored var registrar: PushRegistrar?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    /// Asks for permission and a token. Safe to call on every signed-in edge:
    /// the system's dialog appears once, and re-registering only refreshes
    /// the token Apple already issued.
    func enable() {
        Task {
            let center = UNUserNotificationCenter.current()
            let granted = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
            guard granted == true else { return }
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = DeviceToken.hex(from: deviceToken)
        let environment = Self.pushEnvironment
        Task { await registrar?.tokenArrived(token, environment: environment) }
    }

    func application(
        _ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // A simulator without push entitlement, or a device offline: the
        // roster still shows every session, and the next launch asks again.
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // Shown in the foreground too: the row already says the state, but
        // the banner is what says it just changed.
        completionHandler([.banner, .sound])
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let open = PushOpen(userInfo: response.notification.request.content.userInfo)
        Task { @MainActor in
            if let open { self.pendingOpen = open }
            completionHandler()
        }
    }

    /// Which gateway issued this build's tokens. A build signed for
    /// development carries `aps-environment: development` in its embedded
    /// provisioning profile; TestFlight and App Store builds carry
    /// `production`, and the App Store strips the profile altogether, which
    /// reads as production too. The simulator's tokens are sandbox tokens.
    static var pushEnvironment: PushEnvironment {
        #if targetEnvironment(simulator)
            return .sandbox
        #else
            guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
                  let raw = try? Data(contentsOf: url),
                  let text = String(data: raw, encoding: .isoLatin1),
                  let start = text.range(of: "<?xml"),
                  let end = text.range(of: "</plist>")
            else { return .production }
            let plist = String(text[start.lowerBound ..< end.upperBound])
            guard let data = plist.data(using: .isoLatin1),
                  let object = try? PropertyListSerialization.propertyList(from: data, format: nil),
                  let profile = object as? [String: Any],
                  let entitlements = profile["Entitlements"] as? [String: Any],
                  let environment = entitlements["aps-environment"] as? String
            else { return .production }
            return environment == "development" ? .sandbox : .production
        #endif
    }
}
