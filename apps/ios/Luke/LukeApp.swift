import LukeKit
import SwiftUI

@main
struct LukeApp: App {
    @State private var session: AccountSession
    @State private var vault: VaultStore

    init() {
        let session = AccountSession(
            client: AccountClient(
                baseURL: AccountConstants.baseURL,
                clientID: AccountConstants.clientID
            )
        )
        _session = State(initialValue: session)
        _vault = State(initialValue: VaultStore(
            client: VaultClient(baseURL: AccountConstants.serviceURL),
            session: session
        ))
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(session)
                .environment(vault)
        }
    }
}
