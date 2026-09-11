import Foundation
import Observation

/// The Conversation screen's state: one device's reading of the stored
/// thread, kept in memory for the app run and filled by polling the change
/// signal while the screen stands in the foreground. Each poll asks where
/// every resource stands, reads only the ones whose head differs from the
/// cursor this device holds, and merges what came back under
/// `ConversationThread`'s rules; a first poll seeds the turns and events
/// cursors from the signal's heads, since the messages answer already folds
/// both up to the moment it was read. A device with no registered row yet
/// has no signal to ask and reads the messages alone. Nothing here writes
/// anything anywhere: the reads are GETs and the signal is the same
/// heartbeat the devices route already takes.
@Observable
@MainActor
public final class ConversationStore {
    /// Why the thread is not being read, for the screen to say.
    public enum Failure: Equatable, Sendable {
        /// A page refused over one row the service could not read back; the thread stands as it was.
        case unreadableRow(UnreadableRow)
        /// The service refused or could not be reached; the thread stands as it was.
        case unavailable
    }

    public private(set) var thread = ConversationThread()
    /// The turn groups in the view's order, recomputed after every page
    /// applied, so the screen never reads a thread that has opened as one
    /// with nothing in it while a catch-up is still paging.
    public private(set) var groups: [ConversationReadTurnGroup] = []
    public private(set) var failure: Failure?

    /// How long the screen rests between polls while it stays in the foreground.
    public static let pollInterval: Duration = .seconds(5)
    /// How long a poll says this device's presence holds, comfortably past the next poll.
    public static let presenceHorizon: TimeInterval = 30
    /// How many pages one poll may chase while the service says more stands.
    public static let maximumPagesPerPoll = 5

    private let client: ConversationReadClient
    private let deviceId: @MainActor () -> String?
    private let now: @Sendable () -> Date

    /// `deviceId` answers the row this installation registered under, or nil
    /// before a registration has landed.
    public init(
        client: ConversationReadClient,
        deviceId: @escaping @MainActor () -> String?,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.client = client
        self.deviceId = deviceId
        self.now = now
    }

    /// Whether a messages read has answered at all, empty or not: what retires
    /// the screen's skeleton.
    public var opened: Bool { thread.opened }

    /// One poll: the signal, then whatever moved. Every answer is applied
    /// only while the account that asked still holds the session: a tick
    /// spans several requests, and one landing after a sign-out and another
    /// sign-in would otherwise fill this reading with the wrong account's
    /// thread, or the right thread under the wrong account's cursor.
    public func poll(account: any AccountTokenProviding) async {
        guard let holder = account.accountEmail else { return }
        let fenced = Fenced(account: account, holder: holder)
        do {
            if let deviceId = deviceId() {
                let horizon = now().addingTimeInterval(Self.presenceHorizon)
                let changes = try await fenced.call {
                    try await self.client.changes(deviceId: deviceId, activeUntil: horizon, accessToken: $0)
                }
                let readMessages = thread.messagesCursor != changes.messages
                thread.adoptHeads(from: changes)
                let readTurns = changes.turns != nil && thread.turnsCursor != changes.turns
                let readEvents = thread.eventsCursor != changes.events
                if readMessages { try await readMessagePages(fenced) }
                if readTurns { try await readTurnPages(fenced) }
                if readEvents { try await readEventPages(fenced) }
            } else {
                try await readMessagePages(fenced)
            }
            failure = nil
        } catch is AccountSessionError {
            return
        } catch ConversationReadError.unreadableRow(let row) {
            failure = .unreadableRow(row)
        } catch {
            failure = .unavailable
        }
    }


    /// The account's authorized call, answered only while the holder who
    /// opened the tick still holds the session; an answer that lands after
    /// the holder moved is the first account's sign-out, never applied.
    @MainActor
    private struct Fenced {
        let account: any AccountTokenProviding
        let holder: String

        func call<Answer>(_ request: (String) async throws -> Answer) async throws -> Answer {
            let answer = try await account.authorized(request)
            guard account.accountEmail == holder else { throw AccountSessionError.signedOut }
            return answer
        }
    }

    private func readMessagePages(_ fenced: Fenced) async throws {
        for _ in 0 ..< Self.maximumPagesPerPoll {
            let cursor = thread.messagesCursor
            let answer = try await fenced.call { try await self.client.messages(after: cursor, accessToken: $0) }
            thread.apply(answer)
            groups = thread.turnGroups
            guard answer.hasMore else { return }
        }
    }

    private func readTurnPages(_ fenced: Fenced) async throws {
        for _ in 0 ..< Self.maximumPagesPerPoll {
            let cursor = thread.turnsCursor
            let answer = try await fenced.call { try await self.client.turns(after: cursor, accessToken: $0) }
            thread.apply(answer)
            groups = thread.turnGroups
            guard answer.hasMore else { return }
        }
    }

    private func readEventPages(_ fenced: Fenced) async throws {
        for _ in 0 ..< Self.maximumPagesPerPoll {
            let cursor = thread.eventsCursor
            let answer = try await fenced.call { try await self.client.events(after: cursor, accessToken: $0) }
            thread.apply(answer)
            groups = thread.turnGroups
            guard answer.hasMore else { return }
        }
    }
}
