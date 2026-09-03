import LukeKit
import SwiftUI

@main
struct LukeApp: App {
    @State private var session: AccountSession
    @State private var vault: VaultStore
    @State private var events: ProductEventSender
    @Environment(\.scenePhase) private var scenePhase
    // Held for its lifetime — the WCSessionDelegate must not be deallocated.
    private let phoneRelay: PhoneSessionRelay

    init() {
        let session = AccountSession(
            client: AccountClient(
                baseURL: AccountConstants.baseURL,
                clientID: AccountConstants.clientID
            )
        )
        _session = State(initialValue: session)
        phoneRelay = PhoneSessionRelay(accountSession: session)
        _vault = State(initialValue: VaultStore(
            client: VaultClient(baseURL: AccountConstants.serviceURL),
            session: session
        ))
        // XCTest launches this app as its suites' host, and a test run's
        // counts and recording would be a test's, not a developer's — the
        // desktop's fixture and evidence gate, at this app's one seam.
        let testing = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
        let events = ProductEventSender(
            serviceURL: AccountConstants.serviceURL,
            appVersion: Self.appVersion,
            sends: !testing,
            session: session
        )
        _events = State(initialValue: events)
        events.arm()
        events.record(.appLaunch)
        events.markDayActive()
        events.start()
        if !testing {
            SessionReplay.start()
            // A launch restored from the keychain is already the account's;
            // a signed-out launch records anonymously until the sign-in edge.
            if case .signedIn(let identity) = session.state, let accountId = identity.id {
                SessionReplay.identify(accountId: accountId)
            }
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(session)
                .environment(vault)
                .environment(events)
                .onChange(of: session.state) { previous, current in
                    accountEdge(from: previous, to: current)
                    switch current {
                    case .signedIn: phoneRelay.push()
                    case .signedOut: phoneRelay.pushSignOut()
                    }
                }
        }
        .onChange(of: scenePhase) { _, phase in
            // iOS suspends rather than quits, so backgrounding is the moment
            // the desktop's timed flush cannot be counted on to arrive.
            if phase == .background { events.flush() }
        }
    }

    /// The account edges analytics reacts to. Restores never pass here — the
    /// keychain read lands before this view observes — so a sign-in edge is
    /// always the developer's own act, the transition the desktop counts.
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
        default:
            break
        }
    }

    private static var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }
}
