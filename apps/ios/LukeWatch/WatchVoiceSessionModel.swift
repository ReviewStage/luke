import Foundation
import LukeKit
import Observation

/// Where a spoken act asked to take the developer once Luke has finished
/// saying so: a session's own screen, or the list narrowed as asked. Held
/// until the reply settles, because moving the page mid-sentence would close
/// the call that is still speaking.
enum WatchPendingNavigation {
    case open(RosterSession)
    case list(VoiceAsks.SessionListAsk)
}

/// Observable session state for the watch voice screen. Drives one
/// RealtimeSession carrying the same tools the phone's conversation does,
/// each call dispatched through the shared gauntlet in LukeKit against the
/// roster the watch list draws. The conversation itself is not here: it lives
/// in the app-scoped VoiceConversationThread this model records into, so the
/// words survive a swipe to the sessions page while the call does not.
///
/// The session is not minted until the developer presses the talk button
/// (beginTurn). prepare is called on view appear to store the credential
/// reference and the act context without opening any connection.
@Observable
@MainActor
final class WatchVoiceSessionModel {
    var status: RealtimeStatus = .idle
    var errorMessage: String?
    // Read at each mint, so the watch uses the latest local voice settings.
    var voice = RealtimeVoice.default
    var speed = RealtimeVoiceSpeed.default
    var pendingNavigation: WatchPendingNavigation?
    /// The tools the service minted the latest call with, as the server
    /// confirmed them at channel open; nil until a call has connected.
    private(set) var mintedTools: [String]?
    /// Where a workspace can be created, fetched beside the mint so the
    /// conversation is told it at channel open and a creation ask can be
    /// validated against it. Nil until an answer lands, and left nil when
    /// the fetch fails, so the conversation is told nothing rather than
    /// told there is nowhere.
    private(set) var projects: ProjectsAnswer?
    /// The New Workspace choices this watch remembers, read at the moment a
    /// call opens or an act lands.
    let defaults = WorkspaceCreationDefaults()

    private var accountSession: WatchAccountSession?
    private var thread: VoiceConversationThread?
    private var makeActContext: (@MainActor () -> VoiceActContext)?
    private var session: RealtimeSession?
    private var connectingForTurn = false
    private var endTurnAfterConnect = false
    private var connectTask: Task<Void, Never>?

    func prepare(
        accountSession: WatchAccountSession,
        thread: VoiceConversationThread,
        actContext: @escaping @MainActor () -> VoiceActContext
    ) {
        self.accountSession = accountSession
        self.thread = thread
        makeActContext = actContext
    }

    private func connect(startWithTurn: Bool) async {
        guard session == nil, let accountSession else { return }
        errorMessage = nil
        do {
            try await WatchVoiceAudioSession.activate()
        } catch {
            errorMessage = "Couldn't start audio on the watch."
            status = .idle
            return
        }
        // stop() may have run while activation was in flight: it has already
        // cleared the account and deactivated, and the activation that just
        // landed put the session back up. It goes down again here only if no
        // newer press is holding or opening a call, since the audio session
        // is shared and taking it down would refuse that call's socket.
        guard !Task.isCancelled, self.accountSession != nil, session == nil else {
            if session == nil, !connectingForTurn {
                WatchVoiceAudioSession.deactivate()
            }
            return
        }
        let mintVoice = voice.rawValue
        let mintSpeed = speed.multiplier

        let opts = RealtimeSessionOptions(
            requestConnection: { [weak accountSession, weak self] in
                guard let accountSession else { throw AccountSessionError.signedOut }
                let token = try await accountSession.validAccessToken()
                // Fetched beside the mint rather than after it: the projects
                // item is sent at channel open, and the ephemeral key's
                // minute is not to be spent waiting on a second round trip.
                async let projects = try? ProjectsClient(
                    serviceURL: AccountConstants.serviceURL, http: WatchNetwork.session
                )
                .projects(bearerToken: token)
                let connection: VoiceConnection
                do {
                    connection = try await VoiceMintClient(
                        baseURL: AccountConstants.serviceURL, http: WatchNetwork.session
                    )
                    .mint(
                        accessToken: token,
                        voice: mintVoice,
                        speed: mintSpeed
                    )
                } catch let error as URLError {
                    throw WatchNetworkFailure(error)
                }
                if let answer = await projects {
                    await MainActor.run { [weak self] in self?.projects = answer }
                }
                return connection
            },
            onStatus: { [weak self] newStatus in
                self?.status = newStatus
                // An idle timeout releases the socket so the next button press
                // remints rather than sending on a stale connection. A mint
                // that failed publishes idle without closing, leaving the
                // capturer the press started still running, so the session is
                // closed here first: closing one already closed changes
                // nothing, and the audio session goes down only once the
                // engines have stopped.
                if newStatus == .idle {
                    self?.session?.close()
                    self?.session = nil
                    WatchVoiceAudioSession.deactivate()
                }
            },
            onCaption: { [weak self] text in self?.thread?.recordCaption(text) },
            onSpokenAsk: { [weak self] text in self?.thread?.recordSpokenAsk(text) },
            onError: { [weak self, weak accountSession] message in
                guard let self else { return }
                // Surface a credential failure as an actionable prompt rather
                // than a generic error: the watch can't refresh tokens itself.
                if accountSession?.state == .signedOut {
                    self.errorMessage = "Open Luke on your iPhone"
                } else {
                    self.errorMessage = message ?? "Connection error"
                }
            },
            onRecoverableError: { [weak self] message in self?.errorMessage = message },
            onSessionTools: { [weak self] names in self?.mintedTools = names },
            dispatchToolCall: { [weak self] name, arguments, _ in
                guard let self, let makeActContext = self.makeActContext else {
                    return #"{"error":"not authorized"}"#
                }
                return await dispatchVoiceToolCall(
                    name: name,
                    arguments: arguments,
                    context: makeActContext()
                )
            },
            contextItems: { [weak self] in
                guard let self else { return [] }
                var items: [VoiceContextItem] = []
                // Conversation before projects, the desktop's flush order.
                if let thread = self.thread,
                   let conversation = ConversationContext.item(messages: thread.messages)
                {
                    items.append(conversation)
                }
                if let projects = self.projects {
                    items.append(
                        WorkspaceProjectsContext.item(
                            answer: projects,
                            defaultProviderId: self.defaults.lastProviderId,
                            defaultProjectIds: self.defaults.lastProjectIds
                        )
                    )
                }
                return items
            },
            makeWebSocket: { url, ephemeralKey in
                WatchWebSocketChannel(url: url, ephemeralKey: ephemeralKey)
            },
            makeAudioCapturer: { WatchAudioCapturer() },
            makeAudioPlayer: { WatchAudioPlayer() }
        )
        let s = RealtimeSession(options: opts)
        session = s
        await s.connect(startWithTurn: startWithTurn)
    }

    func stop() {
        connectTask?.cancel()
        connectTask = nil
        connectingForTurn = false
        endTurnAfterConnect = false
        accountSession = nil
        thread = nil
        makeActContext = nil
        // The pending navigation is left standing: closing publishes the idle
        // edge the screen performs it on, so an open accepted mid-reply still
        // lands when the developer swipes away before Luke finishes saying
        // so. Only a new press supersedes it.
        session?.close()
        session = nil
        WatchVoiceAudioSession.deactivate()
    }

    func beginTurn() {
        errorMessage = nil
        // A new press supersedes what the last reply was about to do: an open
        // the developer talked over is an open they no longer want taken.
        pendingNavigation = nil
        thread?.beginTurn()
        if let session {
            session.beginTurn()
            return
        }
        if connectingForTurn {
            // A re-press while the mint is in flight retracts the earlier release
            // so the turn is not immediately ended when the connection lands.
            endTurnAfterConnect = false
            return
        }
        // No existing session: mint a new one and begin the turn once connected.
        guard accountSession != nil else { return }
        connectingForTurn = true
        endTurnAfterConnect = false
        status = .connecting
        connectTask = Task { [weak self] in
            await self?.connect(startWithTurn: true)
            guard let self, !Task.isCancelled, self.connectingForTurn else { return }
            self.connectingForTurn = false
            self.connectTask = nil
            if self.endTurnAfterConnect {
                self.endTurnAfterConnect = false
                self.session?.endTurn()
            }
        }
    }

    func endTurn() {
        if connectingForTurn {
            endTurnAfterConnect = true
            session?.endTurn()
        } else {
            session?.endTurn()
        }
    }

    /// Voice is fixed at mint time. The watch opens sockets only when the
    /// developer presses, so a changed voice closes the current one and lets
    /// the next press mint with the new choice.
    func changeVoice(_ newVoice: RealtimeVoice) {
        guard newVoice != voice else { return }
        voice = newVoice
        guard session != nil || connectTask != nil else { return }
        connectTask?.cancel()
        connectTask = nil
        connectingForTurn = false
        endTurnAfterConnect = false
        session?.close()
        session = nil
        WatchVoiceAudioSession.deactivate()
        status = .idle
    }

    func changeSpeed(_ newSpeed: RealtimeVoiceSpeed) {
        guard newSpeed != speed else { return }
        speed = newSpeed
        session?.applySpeed(newSpeed.multiplier)
    }
}
