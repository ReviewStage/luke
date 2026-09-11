import LukeKit
import Observation
import UIKit
import UserNotifications

/// The app's one door to Apple's push machinery: the application delegate
/// that receives the token, the notification-center delegate that hears a
/// tap, and the two asks of the system, the permission dialog and the token
/// registration. It draws nothing and decides nothing about a notification's
/// words, which are the service's and already on the record; of a payload it
/// reads the one key `BriefingPushTap` names.
@MainActor
@Observable
final class PushCoordinator: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    /// The tap not yet answered by the signed-in screen, if any.
    var pendingOpen: BriefingPushTap?
    /// Where a token or its withdrawal goes: the registrar the latest ask
    /// named, set before the system is asked so the answer has somewhere to land.
    @ObservationIgnored private var registrar: DeviceRegistrar?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    /// The system's own dialog, asking to show alerts, at the app's first
    /// launch: the dialog appears once and the system remembers the answer,
    /// so every later launch passes straight through to the reconcile that
    /// registers or withdraws under the answer given. The ask runs before any
    /// account exists, so a token it earns is held by the registrar until a
    /// sign-in lands and travels with that registration.
    func requestPermission(registering registrar: DeviceRegistrar) {
        self.registrar = registrar
        Task {
            _ = try? await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .sound])
            reconcileRegistration(registering: registrar)
        }
    }

    /// Registers for a token where alerts are already allowed, raising no
    /// dialog, and withdraws the token from the row where they no longer
    /// are. Run at every signed-in launch and foreground: Apple may issue a
    /// new token at any launch, and the developer may withdraw permission in
    /// Settings between two, after which a push would settle to a phone that
    /// shows nothing. A permission never asked registers nothing.
    func reconcileRegistration(registering registrar: DeviceRegistrar) {
        self.registrar = registrar
        Task {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            switch settings.authorizationStatus {
            case .authorized:
                UIApplication.shared.registerForRemoteNotifications()
            case .denied:
                registrar.pushTokenWithdrawn()
            case .notDetermined, .provisional, .ephemeral:
                break
            @unknown default:
                break
            }
        }
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        registrar?.pushTokenDidArrive(deviceToken, environment: Self.pushEnvironment)
    }

    func application(
        _ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // A device offline, or a build without the entitlement: the row keeps
        // whatever token it had, and the next foreground asks again.
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // Shown in the foreground as it would be on the lock screen: the
        // Conversation screen may not be the one up, and the banner is what
        // says a briefing just arrived.
        completionHandler([.banner, .list, .sound])
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        // The default action is the tap; a dismissal asks for nothing.
        let tap = response.actionIdentifier == UNNotificationDefaultActionIdentifier
            ? BriefingPushTap(userInfo: response.notification.request.content.userInfo)
            : nil
        Task { @MainActor in
            if let tap { self.pendingOpen = tap }
            completionHandler()
        }
    }

    /// Which gateway issued this build's tokens: the simulator's are sandbox
    /// tokens, and a device's are named by the embedded provisioning profile.
    private static var pushEnvironment: PushEnvironment {
        #if targetEnvironment(simulator)
            return .sandbox
        #else
            let profile = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision")
                .flatMap { try? Data(contentsOf: $0) }
            return PushEnvironment.fromProvisioningProfile(profile)
        #endif
    }
}
