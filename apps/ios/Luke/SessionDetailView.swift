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

/// The shared left-side bubble used for words coming back from Luke or one of
/// the observed agents. Voice history reuses this exact shape.
struct AgentMessageBubble: View {
    let words: String
    var isError = false

    var body: some View {
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
                .contextMenu { MessageCopyAction(words: words) }
            Spacer(minLength: 48)
        }
    }
}

/// The shared right-side developer bubble. Developer words stay masked from
/// session replay whether they were typed in a session or transcribed from a
/// voice turn.
struct DeveloperMessageBubble: View {
    let words: String
    var delivery: OutgoingMessage.Delivery = .sent

    var body: some View {
        HStack {
            Spacer(minLength: 48)
            VStack(alignment: .trailing, spacing: 3) {
                MarkdownMessageView(words)
                    .postHogMask()
                    .foregroundStyle(.white)
                    .tint(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 18))
                    .opacity(delivery == .sending ? 0.55 : 1)
                    .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: 18))
                    .contextMenu { MessageCopyAction(words: words) }
                if case .failed(let reason) = delivery {
                    Text("Not Delivered — \(reason)")
                        .font(.caption2)
                        .foregroundStyle(Color.errorInk)
                        .multilineTextAlignment(.trailing)
                }
            }
        }
    }
}

private struct MessageCopyAction: View {
    let words: String

    var body: some View {
        Button {
            UIPasteboard.general.string = words
        } label: {
            Label("Copy", systemImage: "doc.on.doc")
        }
    }
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
    /// The roster row's own advertised actions, redrawn in this screen's menu.
    /// Messaging is already present as the composer, so the shared menu omits
    /// that roster-only navigation entry here.
    let sessionActions: (@escaping () -> Void) -> AnyView

    @Environment(AccountSession.self) private var account
    @Environment(ProductEventSender.self) private var events
    @Environment(\.openURL) private var openURL
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
    /// Whether the opening read has answered at all — success or refusal —
    /// which is what retires the skeleton: until then the screen holds the
    /// thread's place, and after a refusal the recap stands as the fallback.
    @State private var openAttempted = false
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
    /// The repository and the rest of the session's stable context belong in
    /// a place the chat cannot scroll away. The shared session menu opens the
    /// sheet at the system's half-height detent.
    @State private var infoShown = false

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
    private static let conversationEndId = "conversation-end"
    /// How long the opening layout gets to settle before the end is pinned a
    /// second time, and how long the top sentinel must stay visible before
    /// its ask counts — both measured against the churn of a tall thread
    /// realizing its rows, which is over well inside half a second.
    private static let layoutSettleNanoseconds: UInt64 = 300_000_000
    private static let sentinelDwellNanoseconds: UInt64 = 450_000_000

    var body: some View {
        // Anchored like Messages: the screen opens at the conversation's end,
        // and scrolling to the top reaches back into history one page at a
        // time.
        ScrollViewReader { proxy in
            ScrollView {
                // Lazy so the top sentinel appears — and fetches — only when
                // the scroll actually reaches it.
                LazyVStack(spacing: 14) {
                    if hasOlder && openSettled {
                        // The sentinel: reaching it is the ask for the page
                        // before the one on screen. A failed page leaves it
                        // standing, and scrolling away and back asks again.
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            // A dwell, not a glance: a lazy row can flash
                            // realized while a tall thread's layout churns,
                            // and a page loaded off that flash re-anchors the
                            // opened screen into history. Scrolling away
                            // cancels the wait, so only a reader actually
                            // holding the top asks for more.
                            .task {
                                try? await Task.sleep(
                                    nanoseconds: Self.sentinelDwellNanoseconds)
                                guard !Task.isCancelled else { return }
                                loadOlder()
                            }
                    }
                    if conversation.isEmpty {
                        // While the opening read is in flight the screen says
                        // "a thread is coming" rather than flashing the recap
                        // it would only replace; the recap is the answer once
                        // the read cannot give one, or was never advertised.
                        if session.canReadConversation && !openAttempted {
                            ConversationSkeleton()
                        } else if let words = session.error ?? session.recap {
                            AgentMessageBubble(words: words, isError: session.error != nil)
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
                            AgentMessageBubble(words: error, isError: true)
                        }
                    }
                    ForEach(thread) { message in
                        DeveloperMessageBubble(words: message.text, delivery: message.delivery)
                            .id(message.id)
                    }
                    // The end of the chat as a scroll target of its own:
                    // aiming a jump at the last bubble is unreliable in a
                    // lazy stack whose Markdown is still sizing, where this
                    // marker is always laid out and always last.
                    Color.clear
                        .frame(height: 1)
                        .id(Self.conversationEndId)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            // A conversation opens at its end and follows new messages while
            // the reader is already there — the system's own chat anchoring.
            // A screen that will only ever draw the recap keeps the top
            // anchor its short content has always had.
            .defaultScrollAnchor(session.canReadConversation ? .bottom : .top)
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
                guard composing else { return }
                // The newest bubble may be a fetched one once every send has
                // handed over, so the fallback mirrors the opening jump.
                if let last = thread.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                } else if let last = conversation.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
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
                    // The marker sits below pending sends and fetched thread
                    // alike, so the open lands on whichever is newest. A very
                    // long newest message can finish sizing after this jump,
                    // growing the content below the landed offset, so one
                    // late second jump pins the end once layout has settled —
                    // and only then may the history sentinel exist.
                    proxy.scrollTo(Self.conversationEndId, anchor: .bottom)
                    Task {
                        try? await Task.sleep(nanoseconds: Self.layoutSettleNanoseconds)
                        proxy.scrollTo(Self.conversationEndId, anchor: .bottom)
                        openSettled = true
                    }
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
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if let link = session.link {
                        Section {
                            openInProviderButton(link)
                        }
                    }
                    sessionActions { infoShown = true }
                } label: {
                    Label("Session Actions", systemImage: "ellipsis")
                }
                .tint(Color.ink)
            }
        }
        .sheet(isPresented: $infoShown) {
            SessionInfoSheet(session: session, openLink: openSessionLink)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { inputBar }
    }

    /// Opening is not a write: the address the observation reported is handed
    /// to the operating system, and nothing reaches the provider.
    private func openSessionLink(_ link: URL) {
        openURL(link)
        if let provider = ProductProviderID(rawValue: session.providerId) {
            events.record(.sessionActSend(provider: provider, act: .sessionOpen))
        }
    }

    private func openInProviderButton(_ link: URL) -> some View {
        Button {
            openSessionLink(link)
        } label: {
            if let provider = VaultProviderID(rawValue: session.providerId) {
                Label {
                    Text("Open")
                } icon: {
                    Image(uiImage: ProviderMark.menuIcon(for: provider))
                }
            } else {
                Label("Open", systemImage: "arrow.up.right.square")
            }
        }
    }

    /// A fetched message wears the anatomy the screen already draws: the
    /// agent's words in the card bubble, the developer's in the accent one.
    @ViewBuilder
    private func conversationBubble(_ message: ConversationMessage) -> some View {
        switch message.author {
        case .agent:
            AgentMessageBubble(words: message.text)
        case .user:
            DeveloperMessageBubble(words: message.text)
        }
    }

    /// The opening read: the latest page of the conversation, drawn from its
    /// end the way Messages opens a chat. Its answer seeds both positions —
    /// the poll's forward cursor and the scroll's oldest offset. A failed
    /// opening changes nothing: the recap fallback stands, and the next tick
    /// tries again because the cursor is still unset.
    private func openConversation() async {
        defer { openAttempted = true }
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

/// Session context that must remain reachable after the opening messages have
/// scrolled away. The roster's act advertisements stay out: they decide which
/// controls exist, while this sheet is the provider's descriptive report.
private struct SessionInfoSheet: View {
    let session: RosterSession
    /// The detail screen's own open press, so the sheet's row and the menu's
    /// entry are one act — opened and counted in one place.
    let openLink: (URL) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Title", value: session.title)
                    LabeledContent {
                        HStack(spacing: 10) {
                            RosterProviderMark(providerId: session.providerId)
                            Text(VaultProviderID.displayLabel(forWireId: session.providerId))
                        }
                    } label: {
                        Text("Provider")
                    }
                    LabeledContent {
                        HStack(spacing: 10) {
                            StatusMark(status: session.status)
                            Text(session.status.capitalized)
                        }
                    } label: {
                        Text("Status")
                    }
                }

                if session.workspace != nil || session.branch != nil {
                    Section("Location") {
                        if let workspace = session.workspace {
                            LabeledContent("Repository", value: workspace)
                        }
                        if let branch = session.branch {
                            LabeledContent("Branch", value: branch)
                        }
                    }
                }

                if let observedAt = session.observedAt {
                    Section {
                        LabeledContent {
                            Text(observedAt.formatted(date: .abbreviated, time: .shortened))
                        } label: {
                            Text("Last activity")
                        }
                    }
                }

                if let link = session.link {
                    Section {
                        Button {
                            openLink(link)
                        } label: {
                            HStack(spacing: 12) {
                                if let provider = VaultProviderID(rawValue: session.providerId) {
                                    ProviderMark(provider: provider)
                                        .frame(width: 20, height: 20)
                                } else {
                                    Image(systemName: "arrow.up.right.square")
                                        .frame(width: 20, height: 20)
                                }
                                Text(
                                    "Open in \(VaultProviderID.displayLabel(forWireId: session.providerId))"
                                )
                            }
                        }
                        .tint(Color.ink)
                    }
                }

                if let destination = changeDestination {
                    Section {
                        Button {
                            openURL(destination.url)
                        } label: {
                            HStack(spacing: 12) {
                                if destination.showsGitHubMark {
                                    GitHubMark()
                                        .frame(width: 20, height: 20)
                                } else {
                                    Image(systemName: "arrow.up.right.square")
                                        .frame(width: 20, height: 20)
                                }
                                Text(destination.label)
                            }
                        }
                        .tint(Color.ink)
                    }
                }
            }
            .navigationTitle("Session Info")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .tint(Color.ink)
                }
            }
        }
    }

    private func changeButtonLabel(for url: URL) -> String {
        url.host?.lowercased() == "github.com"
            ? "View PR"
            : "Open Published Change"
    }

    private var changeDestination: (url: URL, label: String, showsGitHubMark: Bool)? {
        guard let change = session.change else { return nil }
        return (
            change,
            changeButtonLabel(for: change),
            change.host?.lowercased() == "github.com"
        )
    }
}

/// Pulsing placeholder bubbles while the opening read is in flight, shaped
/// like the short exchange they stand for — the roster list's SkeletonRow at
/// this screen's scale. Placeholder blocks carry no words, no copy menu, and
/// no read-path ring: there is nothing to copy and no path has answered yet.
private struct ConversationSkeleton: View {
    @State private var opacity: Double = 0.55

    var body: some View {
        VStack(spacing: 14) {
            skeletonBubble(agent: true, characters: 64)
            skeletonBubble(agent: false, characters: 26)
            skeletonBubble(agent: true, characters: 96)
        }
        .accessibilityHidden(true)
        .opacity(opacity)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true)) {
                opacity = 1.0
            }
        }
    }

    /// Neutral on both sides: an accent-filled placeholder would read as a
    /// send nobody made, where a gray block only says a bubble belongs here.
    private func skeletonBubble(agent: Bool, characters: Int) -> some View {
        HStack {
            if !agent { Spacer(minLength: 48) }
            Text(String(repeating: "x", count: characters))
                .font(.system(size: 15))
                .redacted(reason: .placeholder)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Color.cardFill, in: RoundedRectangle(cornerRadius: 18))
            if agent { Spacer(minLength: 48) }
        }
    }
}
