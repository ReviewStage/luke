import LukeKit
import Observation

/// Fetches and polls the signed-in user's cloud sessions for the watch surface.
///
/// Polling runs while the roster view is on screen — the `.task` modifier on
/// `WatchRosterView` cancels the loop when the view disappears (wrist dropped,
/// app backgrounded), so the watch does not fetch in the background.
@MainActor
@Observable
final class WatchRosterStore {
    private(set) var sessions: [RosterSession] = []
    private(set) var isLoading = false
    private(set) var loadError: String?

    private let session: WatchAccountSession
    private let client = RosterClient(serviceURL: AccountConstants.serviceURL)

    init(session: WatchAccountSession) {
        self.session = session
    }

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        loadError = nil
        defer { isLoading = false }
        do {
            let fetched = try await session.authorized { [client] token in
                try await client.observe(bearerToken: token)
            }
            sessions = fetched
        } catch is AccountSessionError {
            // Token expired or signed out — WatchAccountSession.state change
            // already drives the signed-out screen; nothing to do here.
        } catch {
            loadError = error.localizedDescription
        }
    }

    /// Polls every 15 seconds. Called from `.task` on `WatchRosterView` so
    /// cancellation is tied to the view's lifetime.
    func poll() async {
        await load()
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(15))
            guard !Task.isCancelled else { break }
            await load()
        }
    }
}
