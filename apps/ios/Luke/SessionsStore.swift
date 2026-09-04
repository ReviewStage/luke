import LukeKit
import Observation
import SwiftUI

/// The signed-in tab bar's destinations. `create` is a button wearing a
/// tab's clothes: selecting it presents the New Workspace sheet while the
/// selection stays on the tab already showing.
enum AppTab: Hashable {
    case sessions
    case luke
    case create
}

/// Where the sessions tab can stand beyond the list: on one session's own
/// screen. A route carries the observed row it was opened from, so a screen
/// whose session a later refresh no longer reports keeps its last observed
/// word rather than going blank.
enum SessionsRoute: Hashable {
    case session(RosterSession)
}

/// The list's state and the stack above it, shared between the list, the
/// session screens, and the voice screen, because Luke can be asked in
/// conversation for the same presses the list offers by hand: open a
/// session's screen, narrow or reorder the list, search it. Every act on
/// this store is a press the list itself draws a control for.
@MainActor
@Observable
final class SessionsStore {
    var sessions: [RosterSession] = []
    /// True until a fetched roster has actually landed, so every empty frame
    /// before one — the first paint racing its fetch, the first request in
    /// flight, and a retry running after a failed first load — shows the
    /// skeletons rather than claim "No active sessions" nothing has
    /// confirmed. Only that unknown may show them: a refresh that finds the
    /// list already empty (the last chat just archived) must not flash
    /// skeletons over an emptiness that is real, and a standing fetch error
    /// still outranks them.
    var awaitingFirstRoster = true
    var fetchError: String?
    var searchQuery = ""
    /// Whether the search field is up. Set when a spoken search lands, since
    /// a query nobody can see would narrow the list for no visible reason.
    var searchPresented = false
    var filters: Set<SessionFilter> = []
    var sort: SessionSort = .urgency
    /// Which tab the signed-in hierarchy shows; the conversation with Luke is
    /// where a launch lands.
    var tab: AppTab = .luke
    var path: [SessionsRoute] = []

    /// Counts refresh passes so a stale answer cannot outrank a newer one:
    /// a pass's roster lands only when no newer pass has landed one (an
    /// older roster written after a newer would bring an archived row back
    /// from the dead, but one written where a newer pass only failed still
    /// beats an error over nothing), and only the newest pass may claim
    /// failure, since an old outage says nothing about the request still
    /// running.
    private var refreshPass = 0
    /// The newest pass whose roster actually landed.
    private var landedPass = 0
    /// Sessions whose archive act is still in flight. The row leaves at the
    /// press, so every roster write filters these ids: a refresh whose roster
    /// was read before the archive landed would otherwise bring the row back.
    private var archivingIds: Set<String> = []

    private let rosterClient: RosterClient

    init(rosterClient: RosterClient) {
        self.rosterClient = rosterClient
    }

    /// Opens a session's own screen, the same press a row takes.
    func open(_ session: RosterSession) {
        path.append(.session(session))
    }

    /// Opens a session's screen in the conversation's place: an open asked of
    /// Luke leaves the Luke tab for the sessions tab the way the desktop's
    /// open leaves the panel for the provider's app, and the voice screen
    /// disappearing is what closes its call.
    func openLeavingConversation(_ session: RosterSession) {
        tab = .sessions
        path.append(.session(session))
    }

    /// A session that just left the roster has no screen to stand on any more.
    func closeScreen(of session: RosterSession) {
        path.removeAll { route in
            if case .session(let opened) = route { return opened.id == session.id }
            return false
        }
    }

    /// An archive's whole visible outcome is the row leaving, so the leave
    /// happens at the press — the row slides out and the screen it opened
    /// pops — with the act following behind rather than the press waiting on
    /// two round trips.
    func beginArchiving(_ session: RosterSession) {
        archivingIds.insert(session.id)
        closeScreen(of: session)
        withAnimation { sessions.removeAll { $0.id == session.id } }
    }

    /// Lifts the hold once the act has answered. A refusal restores the row
    /// locally before any refresh converges, because the outage that refused
    /// the act usually fails the refresh too, and a chat the server never
    /// archived must not stay gone on the refusal's word alone.
    func endArchiving(_ session: RosterSession, delivered: Bool) {
        archivingIds.remove(session.id)
        guard !delivered, !sessions.contains(where: { $0.id == session.id }) else { return }
        withAnimation { sessions.append(session) }
    }

    /// Shows the list as a spoken ask narrowed, ordered, or searched it, the
    /// way the filter sheet and the search field would have. The ask arrives
    /// validated against the roster; this only applies it and shows the list.
    func showList(_ ask: VoiceAsks.SessionListAsk) {
        if let filters = ask.filters { self.filters = filters }
        if let sort = ask.sort { self.sort = sort }
        if let query = ask.query {
            searchQuery = query
            searchPresented = true
        }
        tab = .sessions
        path.removeAll()
    }

    func refresh(account: AccountSession, events: ProductEventSender) async {
        refreshPass += 1
        let pass = refreshPass
        fetchError = nil
        guard case .signedIn = account.state else { return }
        do {
            let fetched = try await account.authorized { token in
                try await rosterClient.observe(bearerToken: token)
            }
            guard pass > landedPass else { return }
            landedPass = pass
            // Animated so a row an act just removed slides out the way a
            // deleted Mail row does, instead of blinking.
            withAnimation { sessions = fetched.filter { !archivingIds.contains($0.id) } }
            awaitingFirstRoster = false
            recordObservation(fetched, events: events)
        } catch is AccountSessionError {
            ()  // Signed out — the state change redraws automatically.
        } catch {
            guard pass == refreshPass else { return }
            fetchError = error.localizedDescription
        }
    }

    /// One count per provider per day, in buckets — refreshing is not using.
    /// A provider id the shared vocabulary has not answered for is left
    /// uncounted rather than sent to be refused.
    private func recordObservation(_ sessions: [RosterSession], events: ProductEventSender) {
        let rowsByProvider = Dictionary(grouping: sessions, by: \.providerId)
        for (providerId, rows) in rowsByProvider {
            guard let provider = ProductProviderID(rawValue: providerId) else { continue }
            events.recordOncePerDay(
                .sessionObserve(provider: provider, sessions: .bucket(for: rows.count)),
                discriminator: providerId
            )
        }
    }
}
