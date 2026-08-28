import LukeKit
import SwiftUI

@main
struct LukeApp: App {
    @State private var session = AccountSession(
        client: AccountClient(baseURL: AccountConstants.baseURL, clientID: AccountConstants.clientID)
    )

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(session)
        }
    }
}
