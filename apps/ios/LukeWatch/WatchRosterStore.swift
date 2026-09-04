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
    private(set) var hasLoaded = false
    private(set) var loadError: String?

    private let session: WatchAccountSession
    private let client = RosterClient(serviceURL: AccountConstants.serviceURL)
    private var reloadRequested = true
    private var loadGeneration = 0

    init(session: WatchAccountSession) {
        self.session = session
    }

    func load() async {
        reloadRequested = true
        guard !isLoading else { return }
        let generation = loadGeneration
        var completedRequest = false
        isLoading = true
        defer {
            if generation == loadGeneration {
                isLoading = false
                if completedRequest {
                    hasLoaded = true
                }
            }
        }

        while reloadRequested, !Task.isCancelled, generation == loadGeneration {
            reloadRequested = false
            loadError = nil
            do {
                let fetched = try await session.authorized { [client] token in
                    try await client.observe(bearerToken: token)
                }
                guard generation == loadGeneration else { return }
                sessions = fetched
                completedRequest = true
            } catch is AccountSessionError {
                guard generation == loadGeneration else { return }
                session.signOut()
                return
            } catch {
                guard generation == loadGeneration else { return }
                guard !Task.isCancelled else { return }
                loadError = error.localizedDescription
                completedRequest = true
            }
        }
    }

    /// Removes account-scoped data before a new account can draw the roster.
    /// The next signed-in view starts with placeholders until its first read.
    func reset() {
        loadGeneration += 1
        sessions = []
        loadError = nil
        reloadRequested = true
        hasLoaded = false
        isLoading = false
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
