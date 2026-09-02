import LukeKit
import PostHog
import SwiftUI
import UIKit

/// One message the developer sent from this screen, held in memory alone for
/// the app run — the user's own words, never written to disk, drawn as the
/// sent bubble a chat says "delivered" with instead of a banner.
struct OutgoingMessage: Identifiable, Equatable {
    enum Delivery: Equatable {
        case sending
        case sent
        case failed(reason: String)
    }

    let id = UUID()
    let text: String
    /// When the developer pressed send, so a fetched copy of these words can
    /// prove it is this send and not an identical, older message: a
    /// conversation is allowed to repeat itself, and matching on the words
    /// alone would hand this bubble to history.
    let sentAt = Date()
    var delivery: Delivery
}

/// The session's own screen: the title at the top, the conversation as the
/// bubbles a chat draws, and a chat input at the bottom where — and only
/// where — the latest observation advertised taking a message. Where the
/// roster advertised the provider's documented conversation read, opening
/// this screen fetches the thread itself — the developer's sends and the
/// agent's own words, read on demand and kept only while the screen shows
/// them — and polls behind the cursor while the screen stays open. Where the
/// read is not advertised, or a fetch cannot answer, the screen keeps
/// exactly what it always drew: the provider's word on where the turn
/// stands as the one agent bubble, and the sent bubbles in memory for the
/// app run alone. Every bubble draws its words as Markdown, since an agent's
/// words and a developer's ask are both written in it; an error is a
/// provider's plain report and draws as the words it is.
struct SessionDetailView: View {
    let session: RosterSession
    let actClient: ActClient
    let conversationClient: ConversationClient
    @Binding var thread: [OutgoingMessage]
    /// Runs after a delivered send so the roster refreshes behind this screen.
    let onDelivered: () async -> Void

    @Environment(AccountSession.self) private var account
    @Environment(ProductEventSender.self) private var events
    @State private var text = ""
    @FocusState private var composing: Bool
    /// The fetched conversation, alive only while this screen is: state, not
    /// storage, so closing the screen is what forgetting means here.
    @State private var conversation: [ConversationMessage] = []
    /// The poll's position: the newest provider message id a read consumed,
    /// so each tick reads only what is newer. Nil until the opening read
    /// lands, which is also what makes a failed opening retry on the tick.
    @State private var forwardCursor: String?
    /// The scroll's position: the stored offset the oldest fetched page began
    /// at, and whether history stands before it.
    @State private var oldestOffset: Int?
    @State private var hasOlder = false
    /// One older page at a time: the sentinel can reappear while a load runs.
    @State private var loadingOlder = false
    /// Where the screen should land once the bubbles a read just handed it
    /// have been laid out. A `scrollTo` in the same turn as the state change
    /// would name rows the reader has not built yet, so the intent is state
    /// and the jump runs from its own `onChange`, after the update.
    @State private var scrollIntent: ScrollIntent?
    /// Set once the opening jump to the conversation's end has run, and the
    /// one thing that lets the history sentinel exist: before it, the first
    /// layout still sits at the top, where the sentinel would fire at once
    /// and drag the opened screen into history.
    @State private var openSettled = false

    private enum ScrollIntent: Equatable {
        /// The newest bubble, pending sends included: how a chat opens.
        case end
        /// The bubble that was topmost before older history was prepended.
        case anchor(String)
    }

    /// How long the poll rests between asks while the screen stays open, and
    /// how many pages one poll may chase while the server says newer messages
    /// remain.
    private static let pollSeconds: UInt64 = 10
    private static let maximumPollReads = 5

    var body: some View {
        // Anchored like Messages: the screen opens at the conversation's end,
        // and scrolling to the top reaches back into history one page at a
        // time.
        ScrollViewReader { proxy in
            ScrollView {
                // Lazy so the top sentinel appears — and fetches — only when
                // the scroll actually reaches it.
                LazyVStack(spacing: 14) {
                    metaHeader
                    if hasOlder && openSettled {
                        // The sentinel: reaching it is the ask for the page
                        // before the one on screen. A failed page leaves it
                        // standing, and scrolling away and back asks again.
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .onAppear { loadOlder() }
                    }
                    if conversation.isEmpty {
                        if let words = session.error ?? session.recap {
                            agentBubble(words, isError: session.error != nil)
                        }
                    } else {
                        // Masked from the recording the way the desktop
                        // blocks its History subtree: a session's own words
                        // do not leave the machine in a replay, where the
                        // recap always traveled and still does.
                        ForEach(conversation) { message in
                            conversationBubble(message)
                                .postHogMask()
                        }
                        // The provider's failure word outranks parting words
                        // here exactly as it does on the row.
                        if let error = session.error {
                            agentBubble(error, isError: true)
                        }
                    }
                    ForEach(thread) { message in
                        userBubble(message)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .onChange(of: thread.count) { previousCount, count in
                // Only growth is a send worth following: a handover shrinks
                // this thread from a poll, and a reader up in history must
                // not be dragged to the bottom by it.
                guard count > previousCount, let last = thread.last else { return }
                withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
            }
            // The keyboard rising must not cover the newest bubble: focus
            // scrolls back to it once the inset settles, like Messages.
            .onChange(of: composing) {
                guard composing, let last = thread.last else { return }
                withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
            }
            .onAppear {
                if let last = thread.last {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
            .onChange(of: scrollIntent) {
                guard let intent = scrollIntent else { return }
                scrollIntent = nil
                switch intent {
                case .end:
                    // Pending sends draw below the fetched thread, so a chat
                    // holding one opens on it rather than leaving it under
                    // the fold.
                    if let last = thread.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    } else if let last = conversation.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                    openSettled = true
                case .anchor(let id):
                    proxy.scrollTo(id, anchor: .top)
                }
            }
            .task(id: session.id) {
                guard session.canReadConversation else { return }
                while !Task.isCancelled {
                    if forwardCursor == nil {
                        await openConversation()
                    } else {
                        await pollNewer()
                    }
                    try? await Task.sleep(nanoseconds: Self.pollSeconds * 1_000_000_000)
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color.ground.ignoresSafeArea())
        .navigationTitle(session.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // The bar wears the same mark the session's row does, beside the
            // title — the way Messages puts who the chat is with in the bar.
            ToolbarItem(placement: .principal) {
                HStack(spacing: 8) {
                    RosterProviderMark(providerId: session.providerId)
                        .scaleEffect(24.0 / 30.0)
                        .frame(width: 24, height: 24)
                    Text(session.title)
                        .font(.headline)
                        .foregroundStyle(Color.ink)
                        .lineLimit(1)
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { inputBar }
    }

    /// The chat's own centered caption slot, where iMessage puts a timestamp:
    /// the place the session runs. The provider now stands in the bar itself.
    private var metaHeader: some View {
        Group {
            if let workspace = session.workspace {
                Text(session.branch.map { "\(workspace) · \($0)" } ?? workspace)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Color.inkTertiary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.bottom, 4)
    }

    private func agentBubble(_ words: String, isError: Bool) -> some View {
        HStack {
            Group {
                if isError {
                    Text(words)
                        .font(.subheadline)
                } else {
                    MarkdownMessageView(words)
                }
            }
            .foregroundStyle(isError ? Color.errorInk : Color.ink)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Color.cardFill, in: RoundedRectangle(cornerRadius: 18))
                .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: 18))
                .contextMenu { copyAction(for: words) }
            Spacer(minLength: 48)
        }
    }

    /// A held bubble answers with the system context menu, the way Messages
    /// does; its one action today puts the bubble's own words on the
    /// pasteboard, and the lifted preview keeps the bubble's shape.
    private func copyAction(for words: String) -> some View {
        Button {
            UIPasteboard.general.string = words
        } label: {
            Label("Copy", systemImage: "doc.on.doc")
        }
    }

    /// A fetched message wears the anatomy the screen already draws: the
    /// agent's words in the card bubble, the developer's in the accent one.
    @ViewBuilder
    private func conversationBubble(_ message: ConversationMessage) -> some View {
        switch message.author {
        case .agent:
            agentBubble(message.text, isError: false)
        case .user:
            HStack {
                Spacer(minLength: 48)
                Text(message.text)
                    .font(.system(size: 15))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 18))
                    .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: 18))
                    .contextMenu { copyAction(for: message.text) }
            }
        }
    }

    /// The opening read: the latest page of the conversation, drawn from its
    /// end the way Messages opens a chat. Its answer seeds both positions —
    /// the poll's forward cursor and the scroll's oldest offset. A failed
    /// opening changes nothing: the recap fallback stands, and the next tick
    /// tries again because the cursor is still unset.
    private func openConversation() async {
        do {
            let answer = try await read(.latest)
            conversation = answer.messages
            forwardCursor = answer.lastMessageId
            oldestOffset = answer.firstOffset
            hasOlder = answer.hasOlder
            handOverDeliveredSends()
            scrollIntent = .end
        } catch {}
    }

    /// The poll: everything newer than the cursor, chased while the server
    /// says more remain, to a bounded number of pages. New bubbles append
    /// without moving the scroll — a reader up in history stays where they
    /// are, like Messages.
    private func pollNewer() async {
        for _ in 0 ..< Self.maximumPollReads {
            guard !Task.isCancelled, let cursor = forwardCursor else { return }
            do {
                let answer = try await read(.after(cursor))
                let known = Set(conversation.map(\.id))
                conversation.append(contentsOf: answer.messages.filter { !known.contains($0.id) })
                if let last = answer.lastMessageId {
                    forwardCursor = last
                }
                handOverDeliveredSends()
                guard answer.hasMore else { return }
            } catch {
                return
            }
        }
    }

    /// A scroll to the top: the page of history just before what the screen
    /// holds, prepended with the viewport re-anchored to the bubble that was
    /// topmost, so the reader stays on the words they were looking at.
    private func loadOlder() {
        guard !loadingOlder, hasOlder, let offset = oldestOffset, offset > 0 else { return }
        loadingOlder = true
        Task {
            defer { loadingOlder = false }
            do {
                let answer = try await read(.before(offset))
                let anchor = conversation.first?.id
                let known = Set(conversation.map(\.id))
                conversation.insert(
                    contentsOf: answer.messages.filter { !known.contains($0.id) },
                    at: 0
                )
                if let first = answer.firstOffset {
                    oldestOffset = first
                }
                hasOlder = answer.hasOlder
                if let anchor {
                    scrollIntent = .anchor(anchor)
                }
            } catch {}
        }
    }

    private func read(_ position: ConversationPosition) async throws -> ConversationAnswer {
        try await account.authorized { token in
            try await conversationClient.read(
                accessToken: token,
                providerId: session.providerId,
                providerSessionId: session.sessionId,
                position: position
            )
        }
    }

    /// A send whose words now stand in the fetched thread hands its bubble
    /// over rather than standing beside it twice. The handover demands the
    /// fetched copy be recorded around this send's own moment — behind a
    /// tolerance for the two clocks involved — because the same words earlier
    /// in the history are a different message, and a page carrying them must
    /// not swallow the bubble of a send still in flight. A copy the provider
    /// gave no timestamp proves nothing, so the bubble stands beside it
    /// rather than vanishing on a guess.
    private static let sendClockTolerance: TimeInterval = 120

    /// A copy hands over one bubble and is spent: without the claim, a second
    /// identical quick send would match the first send's copy — the sweep
    /// runs on every poll — and both bubbles would vanish on one message.
    /// Claims live as long as the screen's own fetched thread does.
    @State private var claimedCopyIds: Set<String> = []

    /// Claims the oldest unspent fetched copy of this send's words recorded
    /// at or after its own moment, or answers that none stands yet.
    private func claimFetchedCopy(for outgoing: OutgoingMessage) -> Bool {
        let match = conversation.first { fetched in
            fetched.author == .user
                && !claimedCopyIds.contains(fetched.id)
                && fetched.text == outgoing.text
                && fetched.receivedAt.map {
                    $0 >= outgoing.sentAt.addingTimeInterval(-Self.sendClockTolerance)
                } == true
        }
        guard let match else { return false }
        claimedCopyIds.insert(match.id)
        return true
    }

    /// Runs against the whole fetched thread rather than one page, because a
    /// copy can land in a poll while its send is still in flight: the sweep
    /// here catches bubbles already delivered, and `send` checks once more at
    /// the moment a bubble turns delivered, so neither order leaves the same
    /// words standing twice. Oldest send first, so claims pair bubbles and
    /// copies in arrival order.
    private func handOverDeliveredSends() {
        let delivered = thread
            .filter { $0.delivery == .sent }
            .sorted { $0.sentAt < $1.sentAt }
        var handedOver: Set<UUID> = []
        for bubble in delivered where claimFetchedCopy(for: bubble) {
            handedOver.insert(bubble.id)
        }
        if !handedOver.isEmpty {
            thread.removeAll { handedOver.contains($0.id) }
        }
    }

    private func userBubble(_ message: OutgoingMessage) -> some View {
        HStack {
            Spacer(minLength: 48)
            VStack(alignment: .trailing, spacing: 3) {
                // Masked from the session recording: the bubble is the words
                // the developer just typed, and a field's masking would be
                // hollow if the same words traveled the moment they were
                // drawn back. The recap bubble stays visible — it already
                // travels on the roster rows the recording shows.
                MarkdownMessageView(message.text)
                    .postHogMask()
                    .foregroundStyle(.white)
                    .tint(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 18))
                    .opacity(message.delivery == .sending ? 0.55 : 1)
                    .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: 18))
                    .contextMenu { copyAction(for: message.text) }
                if case .failed(let reason) = message.delivery {
                    Text("Not Delivered — \(reason)")
                        .font(.caption2)
                        .foregroundStyle(Color.errorInk)
                        .multilineTextAlignment(.trailing)
                }
            }
        }
    }

    /// The input takes iMessage's own anatomy where a message is advertised —
    /// body-size text in a capsule, the send button inscribed at its trailing
    /// edge, popping in only once there is something to send. On systems that
    /// draw Liquid Glass the capsule is the system's own glass floating over
    /// the bubbles scrolling beneath; earlier systems keep an opaque bar on
    /// the chat's own ground. Where no message is advertised, the honest
    /// absence is said quietly instead of drawing a field that could only
    /// refuse.
    @ViewBuilder
    private var inputBar: some View {
        if session.canReceiveMessage {
            if #available(iOS 26.0, *) {
                composerField
                    .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
            } else {
                composerField
                    .background(
                        RoundedRectangle(cornerRadius: 22)
                            .fill(Color.cardFill)
                            .strokeBorder(Color.controlStroke, lineWidth: 1)
                    )
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    // Without glass to float on, the bar stands on the chat's
                    // own ground — a system material would resolve near-white
                    // over it in light mode.
                    .background(Color.ground)
            }
        } else {
            Text("This session isn't accepting messages right now.")
                .font(.footnote)
                .foregroundStyle(Color.inkTertiary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(Color.ground)
        }
    }

    private var composerField: some View {
        TextField("Message", text: $text, axis: .vertical)
            .focused($composing)
            .lineLimit(1 ... 5)
            .font(.body)
            .foregroundStyle(Color.ink)
            .padding(.leading, 14)
            .padding(.trailing, 42)
            .padding(.vertical, 9)
            .overlay(alignment: .bottomTrailing) {
                if canSend {
                    Button(action: send) {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 30, height: 30)
                            .background(Color.accentColor, in: Circle())
                    }
                    .padding(5)
                    .transition(.scale.combined(with: .opacity))
                }
            }
            .animation(.spring(duration: 0.25), value: canSend)
    }

    private var canSend: Bool {
        text.contains { !$0.isWhitespace }
    }

    private func send() {
        guard canSend else { return }
        let message = OutgoingMessage(
            text: text.trimmingCharacters(in: .whitespacesAndNewlines),
            delivery: .sending
        )
        withAnimation { thread.append(message) }
        text = ""
        Task {
            var delivery: OutgoingMessage.Delivery
            do {
                let answer = try await account.authorized { token in
                    try await actClient.sendMessage(
                        accessToken: token,
                        providerId: session.providerId,
                        providerSessionId: session.sessionId,
                        text: message.text
                    )
                }
                if answer.result == .accepted {
                    delivery = .sent
                    if let provider = ProductProviderID(rawValue: session.providerId) {
                        events.record(.sessionActSend(provider: provider, act: .messageSend))
                    }
                } else {
                    delivery = .failed(reason: answer.reason ?? "The message was not delivered.")
                }
            } catch is AccountSessionError {
                delivery = .failed(reason: "Signed out.")
            } catch {
                delivery = .failed(reason: error.localizedDescription)
            }
            if let index = thread.firstIndex(where: { $0.id == message.id }) {
                // A poll can fetch the send's copy while the bubble is still
                // in flight, and that page never comes again: the moment of
                // delivery re-checks, so the bubble hands over instead of
                // standing beside its own copy.
                if delivery == .sent, claimFetchedCopy(for: thread[index]) {
                    thread.remove(at: index)
                } else {
                    thread[index].delivery = delivery
                }
            }
            if delivery == .sent { await onDelivered() }
        }
    }
}
