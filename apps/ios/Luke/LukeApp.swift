import LukeKit
import SwiftUI

@main
struct LukeApp: App {
    @State private var session: AccountSession
    @State private var vault: VaultStore
    @State private var events: ProductEventSender
    @State private var conversation = VoiceConversationThread()
    @UIApplicationDelegateAdaptor(PushCoordinator.self) private var push
    @Environment(\.scenePhase) private var scenePhase
    // Held for its lifetime — the WCSessionDelegate must not be deallocated.
    private let phoneRelay: PhoneSessionRelay
    private let accountPreferences: AccountPreferencesSync
    private let accountPreferencesEnabled: Bool
    private let devices: DeviceRegistrar

    init() {
        let session = AccountSession(
            client: AccountClient(
                baseURL: AccountConstants.baseURL,
                clientID: AccountConstants.clientID
            )
        )
        _session = State(initialValue: session)
        phoneRelay = PhoneSessionRelay(accountSession: session)
        accountPreferences = AccountPreferencesSync(
            client: AccountPreferencesClient(baseURL: AccountConstants.serviceURL),
            session: session
        )
        _vault = State(initialValue: VaultStore(
            client: VaultClient(baseURL: AccountConstants.serviceURL),
            session: session
        ))
        let devices = DeviceRegistrar(
            client: DeviceClient(baseURL: AccountConstants.serviceURL),
            session: session,
            platform: .iOS
        )
        self.devices = devices
        // The row is forgotten on the account's own way out, while its token
        // still stands: the state change below arrives after the token is gone.
        session.onSignOut = { token in await devices.forget(accessToken: token).value }
        // XCTest launches this app as its suites' host, and a test run's
        // counts and recording would be a test's, not a developer's — the
        // desktop's fixture and evidence gate, at this app's one seam.
        let testing = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
        accountPreferencesEnabled = !testing
        let events = ProductEventSender(
            serviceURL: AccountConstants.serviceURL,
            appVersion: Self.appVersion,
            client: .iOS,
            sends: !testing,
            session: session
        )
        _events = State(initialValue: events)
        events.arm()
        events.record(.appLaunch)
        events.markDayActive()
        events.start()
        if accountPreferencesEnabled {
            accountPreferences.start()
            accountPreferences.reconcile()
            SessionReplay.start()
            // A launch restored from the keychain is already the account's;
            // a signed-out launch records anonymously until the sign-in edge.
            if case .signedIn(let identity) = session.state, let accountId = identity.id {
                SessionReplay.identify(accountId: accountId)
            }
            if case .signedIn = session.state { devices.register() }
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(session)
                .environment(vault)
                .environment(events)
                .environment(conversation)
                .environment(push)
                // Notification permission is asked at the first launch, over
                // the sign-in card and before any account: the phone runs no
                // introduction, so no spoken beat is there to interrupt. Every
                // later launch, a keychain restore included, passes through to
                // the reconcile without a dialog.
                .task {
                    if accountPreferencesEnabled { push.requestPermission(registering: devices) }
                }
                .onChange(of: session.state) { previous, current in
                    accountEdge(from: previous, to: current)
                    switch current {
                    case .signedIn:
                        if accountPreferencesEnabled {
                            accountPreferences.reconcile()
                            devices.register()
                            push.reconcileRegistration(registering: devices)
                        }
                        phoneRelay.push()
                    case .signedOut:
                        if accountPreferencesEnabled { accountPreferences.clearAccountPreferences() }
                        phoneRelay.pushSignOut()
                    }
                }
        }
        .onChange(of: scenePhase) { _, phase in
            // iOS suspends rather than quits, so backgrounding is the moment
            // the desktop's timed flush cannot be counted on to arrive.
            if phase == .background { events.flush() }
            if phase == .active && accountPreferencesEnabled {
                accountPreferences.reconcile()
                devices.heartbeat()
                // Every foreground, so a token Apple reissued reaches the row
                // and a permission withdrawn in Settings clears it.
                if case .signedIn = session.state { push.reconcileRegistration(registering: devices) }
            }
        }
    }

    /// The account edges analytics reacts to. Restores never pass here — the
    /// keychain read lands before this view observes — so a sign-in edge is
    /// always the developer's own action, the transition the desktop counts.
    private func accountEdge(from previous: AuthState, to current: AuthState) {
        switch (previous, current) {
        case (.signedOut, .signedIn(let identity)):
            events.record(.accountSignIn)
            if let accountId = identity.id {
                SessionReplay.identify(accountId: accountId)
            }
        case (.signedIn(let restored), .signedIn(let resolved)):
            // A restore whose keychain never held the account id resolves it
            // from userinfo after first paint; the id arriving is the moment
            // the running recording can be joined to its account.
            if restored.id == nil, let accountId = resolved.id {
                SessionReplay.identify(accountId: accountId)
            }
        case (.signedIn, .signedOut):
            SessionReplay.resetPerson()
            conversation.clear()
        default:
            break
        }
    }

    private static var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }
}
