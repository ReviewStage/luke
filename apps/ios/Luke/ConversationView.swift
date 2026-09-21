import LukeKit
import PostHog
import SwiftUI

/// The one long Conversation the account holds, read from the service's
/// stored messages: the same thread the Mac's Conversation tab draws, as the
/// per-resource reads answer it, grouped by turn. The developer's asks are
/// sent bubbles and Luke's replies received ones; a briefing is his words in
/// his own bubble, marked when nobody heard it; an action is a row composed
/// on this phone from the call's arguments and its envelope, the session it
/// reached a chip that opens that session's screen while the roster still
/// holds it; a turn Luke opened himself leads with his face and never wears
/// a reply's bubble. Behind a press and hold on each of Luke's messages, a
/// reply's bubble or his own judgment's row alike, stand two thumbs, the one
/// write this screen makes: a verdict on that message, or the withdrawal of
/// the one standing, sent to the service under the account's fence and drawn
/// back from the latest rating event as the filled thumb in that menu and
/// nowhere on the message itself, so a verdict given on the Mac shows here
/// and one given or taken back here shows there.
/// The screen polls the change signal while it stands in the foreground and
/// draws only what it holds in memory.
///
/// The thread opens at its end on the tail the store read, and follows new
/// rows only while the reader is there: one who has scrolled up into what
/// was said before is left where they are, with a control floating over the
/// thread that returns them to the latest message. Reaching the top of the
/// thread while older turns stand is the ask for the page before it, one at
/// a time and never twice for one page; the page lands under the reader's
/// place, the row that was topmost held where it was, so the words they were
/// looking at do not move. A page that could not be read leaves the ask
/// standing as a press to try again, and once nothing older stands the top
/// of the thread is simply its beginning.
///
/// A briefing's notification tapped opens this screen at that briefing: the
/// store resolves the tapped message to its row, the screen scrolls there and
/// lifts the row for a moment, and where the message is not in the thread —
/// cleared, past the view's window, or another account's — the screen opens
/// at its end and says so under the last row rather than scrolling nowhere.
///
/// Every row here is masked from the session recording — the whole scroll
/// carries the recording library's mask, the way the desktop blocks its
/// Conversation subtree — so the conversation's words, the sessions named in
/// it, a refusal's reason, and the lifted row and the missing-briefing line a
/// tap draws reach this phone and nothing else.
struct ConversationView: View {
    let conversation: ConversationStore
    /// Room left under the last row for controls floating over the thread; nothing when the screen stands alone.
    var bottomInset: CGFloat = 0

    @Environment(AccountSession.self) private var account
    @Environment(SessionsStore.self) private var store
    @Environment(ProductEventSender.self) private var events
    @Environment(\.scenePhase) private var scenePhase
    /// The reader's presses on each turn's actions fold, by turn id.
    @State private var foldChoices: [String: ConversationFoldChoice] = [:]
    /// The instant the thread's dates are read against; moves when a poll
    /// lands, when the screen appears, and at midnight.
    @State private var now = Date()
    /// The row a tap opened the screen at, lifted while the developer finds it.
    @State private var liftedRow: String?
    /// Whether the thread's end stands in view: what new rows may pull the
    /// scroll toward, and what the return control stands in for when not.
    @State private var atEnd = true
    /// Whether the rows that last landed were aimed at the end: the settle
    /// pass finishes that jump even where the rows, taking their heights,
    /// pushed the end marker out of view in between.
    @State private var followingTail = false
    /// Set once the opening jump to the thread's end has settled, and the one
    /// thing that lets the history sentinel exist: before it, the first
    /// layout still sits at the top, where the sentinel would fire at once
    /// and drag the opened screen into history.
    @State private var openSettled = false
    /// Whether the last ask for older turns did not land, for the sentinel
    /// to offer again as a press rather than asking on its own.
    @State private var olderRefused = false
    /// Where the screen should land once the rows a read just handed it have
    /// been laid out: a `scrollTo` in the same turn as the state change would
    /// name rows the reader has not built yet.
    @State private var scrollIntent: ScrollIntent?

    private enum ScrollIntent: Equatable {
        /// The row that was topmost before older turns were prepended.
        case anchor(String)
    }

    private static let endId = "conversation-end"
    /// How long the row a tap opened at stays lifted.
    private static let liftDuration: Duration = .seconds(2)
    private static let layoutSettle: Duration = .milliseconds(300)
    /// How long the top sentinel must stay in view before its ask counts: a
    /// lazy row can flash realized while a tall thread's layout churns.
    private static let sentinelDwell: Duration = .milliseconds(450)
    /// The row count the end was last re-aimed at, so the thread coming
    /// back on screen with nothing new leaves the reader's place alone.
    @State private var settledCount: Int?

    private var turns: [ConversationTurnRows] {
        conversation.groups.map { ConversationTurnRows(group: $0, roster: store.sessions) }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 14) {
                    if !conversation.opened && conversation.failure == nil {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 24)
                    } else if conversation.groups.isEmpty && conversation.failure == nil {
                        Text("Nothing has been said yet.")
                            .font(.footnote)
                            .foregroundStyle(Color.inkTertiary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                    }
                    if conversation.hasOlder && openSettled {
                        olderSentinel
                    }
                    let turnRows = turns
                    ForEach(Array(turnRows.enumerated()), id: \.element.id) { index, turn in
                        if let opensAt = turn.opensAt,
                           ConversationTimeBreak.opens(
                               after: index == 0 ? nil : turnRows[index - 1].closesAt,
                               recordedAt: opensAt
                           )
                        {
                            timeBreak(opensAt)
                        }
                        ForEach(turn.rows) { row in
                            ConversationRowView(
                                row: row,
                                judgment: turn.judgment,
                                pending: turn.pending,
                                foldChoice: foldBinding(turn.turnId),
                                openSession: { session in store.openLeavingConversation(session) },
                                ratings: conversation.ratings,
                                canRate: conversation.canRate,
                                rate: rate
                            )
                            .background {
                                if liftedRow == row.id {
                                    RoundedRectangle(cornerRadius: 12)
                                        .fill(Color.ink.opacity(0.08))
                                        .padding(-6)
                                }
                            }
                        }
                    }
                    if let failure = conversation.failure {
                        failureRow(failure)
                    }
                    if conversation.opening == .missing {
                        missingBriefingRow
                    }
                    Color.clear
                        .frame(height: 1)
                        .id(Self.endId)
                        .onAppear { atEnd = true }
                        .onDisappear { atEnd = false }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .safeAreaPadding(.bottom, bottomInset)
            .overlay(alignment: .bottomTrailing) {
                if !atEnd && conversation.opened {
                    latestControl(proxy)
                        .padding(.trailing, 16)
                        .padding(.bottom, bottomInset + 12)
                        .transition(.opacity.combined(with: .scale(scale: 0.9)))
                }
            }
            .animation(.easeOut(duration: 0.2), value: atEnd)
            // Masked whole, the way the desktop blocks its Conversation
            // subtree: the recording sees the screen's frame and none of
            // its words.
            .postHogMask()
            .defaultScrollAnchor(.bottom)
            .animation(.easeOut(duration: 0.5), value: liftedRow)
            .onChange(of: conversation.groups.count) {
                now = Date()
                // Rows landing re-aim the scroll at the row a tap opened at,
                // never past it to the end; a tap still seeking holds the
                // screen where it is, and so does a reader who scrolled up
                // into the thread, whether the rows landed under or over them.
                switch conversation.opening {
                case .seeking: return
                case .found(let rowId): scroll(proxy, to: rowId)
                case .missing, nil:
                    guard atEnd else { return }
                    followingTail = true
                    scroll(proxy, to: Self.endId)
                }
            }
            // Lazy rows take their real heights after they land, so a page
            // aimed at the end while the screen is up settles short of it;
            // once the layout stands, the end is aimed at again — while the
            // reader is there — and only then may the history sentinel exist.
            .task(id: conversation.groups.count) {
                let count = conversation.groups.count
                guard settledCount != count else { return }
                try? await Task.sleep(for: Self.layoutSettle)
                guard !Task.isCancelled else { return }
                let opening = settledCount == nil
                settledCount = count
                switch conversation.opening {
                case .seeking, .found: break
                case .missing, nil: if atEnd || opening || followingTail { scroll(proxy, to: Self.endId) }
                }
                followingTail = false
                if conversation.opened { openSettled = true }
            }
            .onChange(of: scrollIntent) {
                guard let intent = scrollIntent else { return }
                scrollIntent = nil
                switch intent {
                case .anchor(let id): proxy.scrollTo(id, anchor: .top)
                }
            }
            .onChange(of: conversation.opening) { _, opening in follow(opening, proxy) }
            // A row found before the screen was pushed is scrolled to once the
            // lazy stack has laid out, on the run loop turn after appearing,
            // rather than at appearance, when the row's id is not yet placed.
            .onAppear { DispatchQueue.main.async { follow(conversation.opening, proxy) } }
            .task(id: liftedRow) {
                guard liftedRow != nil else { return }
                try? await Task.sleep(for: Self.liftDuration)
                guard !Task.isCancelled else { return }
                liftedRow = nil
                conversation.openingSettled()
            }
        }
        .background(Color.ground.ignoresSafeArea())
        .onAppear { now = Date() }
        // The missing-briefing line stands while the screen does; leaving
        // settles it, so the next opening starts clean.
        .onDisappear { conversation.openingSettled() }
        .onReceive(NotificationCenter.default.publisher(for: .NSCalendarDayChanged)) { _ in
            now = Date()
        }
        // Keyed by the scene phase so the loop restarts as the app comes to
        // the foreground and ends as it leaves: the poll runs only while the
        // screen stands and the app is active.
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await conversation.poll(account: account)
                try? await Task.sleep(for: ConversationStore.pollInterval)
            }
        }
    }

    /// The developer's thumb on one of Luke's messages, or the press that
    /// takes it back: written to the service, and counted as the word and the
    /// message's kind alone once the service has recorded it.
    private func rate(_ message: RateableMessage, _ word: RatingWord) {
        Task {
            guard await conversation.rate(message, word, account: account) else { return }
            events.record(.conversationRated(rating: word, kind: message.kind))
        }
    }

    private func foldBinding(_ turnId: String) -> Binding<ConversationFoldChoice?> {
        Binding(
            get: { foldChoices[turnId] },
            set: { foldChoices[turnId] = $0 }
        )
    }

    /// The top of the thread while older turns stand: reaching it is the ask
    /// for the page before what is on screen, made once the reader has held
    /// the top for a moment, and never while a page is on its way. A page
    /// that did not land leaves the ask as a press, so a service that could
    /// not be reached is not asked again and again on every layout pass.
    @ViewBuilder
    private var olderSentinel: some View {
        if conversation.loadingOlder {
            HStack(spacing: 8) {
                ProgressView()
                Text("Loading earlier messages…")
            }
            .font(.footnote)
            .foregroundStyle(Color.inkTertiary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
        } else if olderRefused {
            Button {
                askForOlder()
            } label: {
                Label("Earlier messages could not be loaded. Try again", systemImage: "arrow.clockwise")
                    .font(.footnote)
                    .foregroundStyle(Color.inkSecondary)
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
        } else {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .accessibilityLabel("Loading earlier messages")
                .task {
                    try? await Task.sleep(for: Self.sentinelDwell)
                    guard !Task.isCancelled else { return }
                    askForOlder()
                }
        }
    }

    /// One page of older turns, prepended with the viewport held on the row
    /// that was topmost, so the reader stays on the words they were looking
    /// at; a thread short enough for its end to be in view too has no place
    /// to hold and is left as it lands.
    private func askForOlder() {
        guard conversation.hasOlder, !conversation.loadingOlder else { return }
        olderRefused = false
        let anchor = atEnd ? nil : turns.first?.rows.first?.id
        Task {
            let landed = await conversation.loadOlder(account: account)
            if landed {
                if let anchor { scrollIntent = .anchor(anchor) }
            } else {
                olderRefused = conversation.hasOlder
            }
        }
    }

    /// The way back to the latest message for a reader up in the thread,
    /// floating over the rows the way a chat's own does.
    private func latestControl(_ proxy: ScrollViewProxy) -> some View {
        Button {
            scroll(proxy, to: Self.endId)
        } label: {
            Image(systemName: "arrow.down")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.ink)
                .frame(width: 40, height: 40)
                .background(Circle().fill(Color.ground))
                .overlay(Circle().strokeBorder(Color.ink.opacity(0.12)))
                .shadow(color: Color.ink.opacity(0.12), radius: 6, y: 2)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Scroll to the latest message")
    }

    private func timeBreak(_ at: Date) -> some View {
        let label = ConversationTimeBreak.label(recordedAt: at, now: now)
        return (Text(label.day).fontWeight(.semibold) + Text(" \(label.time)"))
            .font(.caption2)
            .monospacedDigit()
            .foregroundStyle(Color.inkTertiary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.top, 4)
            .accessibilityElement(children: .combine)
    }

    private func follow(_ opening: ConversationStore.Opening?, _ proxy: ScrollViewProxy) {
        switch opening {
        case .found(let rowId):
            scroll(proxy, to: rowId)
            liftedRow = rowId
        case .missing:
            scroll(proxy, to: Self.endId)
        case .seeking, nil:
            break
        }
    }

    private func scroll(_ proxy: ScrollViewProxy, to id: String) {
        withAnimation { proxy.scrollTo(id, anchor: id == Self.endId ? .bottom : .center) }
    }

    /// What stands where a tapped briefing would have: the thread has moved
    /// past it, or it was never this account's. Drawn in the dates' quiet
    /// voice, and inside the masked scroll like every other row.
    private var missingBriefingRow: some View {
        Text("The briefing you tapped is no longer in the conversation.")
            .font(.footnote)
            .foregroundStyle(Color.inkTertiary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
    }

    /// Why the thread is not being read, in the quiet voice the dates use.
    /// An unreadable row names itself so the developer can report it; it is
    /// never drawn as an empty thread.
    private func failureRow(_ failure: ConversationStore.Failure) -> some View {
        let words: String =
            switch failure {
            case .unreadableRow(let row):
                "The service could not read message \(row.seq) of conversation \(row.conversationId)."
            case .unavailable:
                "The conversation could not be reached right now."
            }
        return Text(words)
            .font(.footnote)
            .foregroundStyle(Color.errorInk)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
    }
}

// MARK: - Rows

/// One row of a turn, drawn as what it is.
private struct ConversationRowView: View {
    let row: ConversationRow
    let judgment: ConversationJudgment
    let pending: Bool
    @Binding var foldChoice: ConversationFoldChoice?
    let openSession: (RosterSession) -> Void
    let ratings: [String: MessageRating]
    let canRate: Bool
    let rate: (RateableMessage, RatingWord) -> Void

    var body: some View {
        switch row {
        case .words(_, let speaker, let text, _, let unspoken, let rateable):
            wordsRow(speaker: speaker, text: text, unspoken: unspoken, rateable: rateable)
        case .reasoning(_, let text):
            ReasoningRow(text: text)
        case .action(_, let toolRow, _):
            ActionRow(row: toolRow, judgment: judgment, openSession: openSession)
        case .actionsFold(_, let rows, _):
            ActionsFoldRow(
                rows: rows,
                judgment: judgment,
                pending: pending,
                choice: $foldChoice,
                openSession: openSession
            )
        case .details(_, let items):
            DetailsRow(items: items, judgment: judgment, openSession: openSession)
        }
    }

    @ViewBuilder
    private func wordsRow(
        speaker: ConversationSpeaker,
        text: String,
        unspoken: Bool,
        rateable: RateableMessage?
    ) -> some View {
        switch speaker {
        case .you:
            DeveloperMessageBubble(words: text)
        case .luke:
            VStack(alignment: .leading, spacing: 3) {
                AgentMessageBubble(words: text) { ratingItems(rateable) }
                if unspoken {
                    Text("Not spoken")
                        .font(.caption2)
                        .foregroundStyle(Color.inkTertiary)
                        .padding(.leading, 14)
                }
            }
        case .note:
            Text(text)
                .font(.footnote)
                .foregroundStyle(Color.inkTertiary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 4)
        case .own:
            // Luke's own words are his message all the same: the same menu a
            // reply's bubble opens, on the row that wears none.
            OwnJudgmentRow {
                MarkdownMessageView(text)
                    .foregroundStyle(Color.inkSecondary)
            }
            .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: 12))
            .contextMenu {
                ratingItems(rateable)
                MessageCopyAction(words: text)
            }
        }
    }

    /// The two thumbs, where the message takes a verdict; nothing otherwise.
    @ViewBuilder
    private func ratingItems(_ rateable: RateableMessage?) -> some View {
        if let rateable {
            RatingMenuItems(
                rating: ratings[rateable.messageId],
                enabled: canRate,
                rate: { rate(rateable, $0) }
            )
        }
    }
}

/// Two thumbs in the press-and-hold menu of one of Luke's messages, the way
/// a chat rates a reply: the verdict standing is drawn filled and its item
/// offers to remove it, a press on the other moves the verdict, and a press
/// on the filled one takes the verdict back, leaving the message unrated.
/// Each press is one more fact stated and never an edit: the withdrawal is a
/// rating event of its own that says so. The menu is the only place the
/// verdict shows; the message itself wears no mark of it. Both items stand
/// above Copy, and both are disabled rather than hidden while this
/// installation has no device row to rate as.
private struct RatingMenuItems: View {
    let rating: MessageRating?
    let enabled: Bool
    let rate: (RatingWord) -> Void

    var body: some View {
        thumb(.up)
        thumb(.down)
        Divider()
    }

    private func thumb(_ verdict: MessageRating) -> some View {
        let chosen = rating == verdict
        return Button {
            rate(chosen ? .withdrawn : RatingWord(verdict))
        } label: {
            Label(
                chosen ? verdict.removeTitle : verdict.menuTitle,
                systemImage: verdict.symbol(filled: chosen)
            )
        }
        .disabled(!enabled)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}

extension MessageRating {
    fileprivate var menuTitle: String {
        switch self {
        case .up: "Thumbs Up"
        case .down: "Thumbs Down"
        }
    }

    /// What the filled thumb's item says, since pressing it takes the verdict back.
    fileprivate var removeTitle: String {
        switch self {
        case .up: "Remove Thumbs Up"
        case .down: "Remove Thumbs Down"
        }
    }

    fileprivate func symbol(filled: Bool) -> String {
        let base: String =
            switch self {
            case .up: "hand.thumbsup"
            case .down: "hand.thumbsdown"
            }
        return filled ? "\(base).fill" : base
    }
}

/// Luke's own judgment leads with his face, in the quiet voice, and never
/// wears a reply's bubble: a bubble would read as an answer to something the
/// developer said.
private struct OwnJudgmentRow<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            LukeMark()
                .foregroundStyle(Color.inkSecondary)
                .frame(width: 18, height: 18)
                .padding(.top, 2)
                .accessibilityLabel("Luke, on his own judgment")
            content
            Spacer(minLength: 24)
        }
    }
}

/// Luke's thought before what followed it, folded to a line that opens on its words.
private struct ReasoningRow: View {
    let text: String
    @State private var open = false

    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            Text(text)
                .font(.footnote)
                .foregroundStyle(Color.inkSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 4)
        } label: {
            Text("Thought")
                .font(.footnote)
                .foregroundStyle(Color.inkTertiary)
        }
        .tint(Color.inkTertiary)
        .padding(.horizontal, 4)
    }
}

/// An action Luke carried, as a row rather than a bubble: what was done, in
/// one wrapping sentence led by a mark for the kind of thing it was — his
/// face, under his own judgment — and ended on the mark of the provider it
/// reached. The session's name is set inside the sentence, and while the
/// roster still holds the session the sentence is a press onto its screen. A
/// refused or unknown outcome says why under the words; an accepted one shows
/// the carrier's own note where it wrote one.
private struct ActionRow: View {
    let row: ConversationToolRow
    let judgment: ConversationJudgment
    let openSession: (RosterSession) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Group {
                if judgment == .own {
                    LukeMark().foregroundStyle(Color.inkSecondary)
                } else {
                    Image(systemName: Self.symbol(for: row))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.inkSecondary)
                }
            }
            .frame(width: 18, height: 18)
            .padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    words
                    if row.outcome == .pending {
                        ProgressView()
                            .controlSize(.mini)
                            .accessibilityLabel("Under way")
                    }
                }
                if let reason = row.reason {
                    Text(reason)
                        .font(.caption2)
                        .foregroundStyle(row.outcome == .refused ? Color.errorInk : Color.warningInk)
                }
                if let note = row.note {
                    Text(note).font(.caption2).foregroundStyle(Color.inkTertiary)
                }
                if let warning = row.warning {
                    Text(warning).font(.caption2).foregroundStyle(Color.warningInk)
                }
            }
            Spacer(minLength: 8)
            if let providerId = row.providerId {
                RosterProviderMark(providerId: providerId)
                    .scaleEffect(20.0 / 30.0)
                    .frame(width: 20, height: 20)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            judgment == .own ? "Luke, on his own judgment: \(row.sentence)" : "Action: \(row.sentence)"
        )
    }

    /// The runs as one `Text`, so the sentence wraps like any other line;
    /// the session's name is set in the link's colour while its screen can
    /// be opened, and the sentence is that press.
    @ViewBuilder
    private var words: some View {
        if let session = row.chip?.session {
            Button {
                openSession(session)
            } label: {
                sentence
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open \(session.title)")
        } else {
            sentence
        }
    }

    private var sentence: Text {
        row.runs.reduce(Text("")) { sentence, run in
            switch run {
            case .text(let text):
                sentence + Text(text).foregroundStyle(Color.inkSecondary)
            case .chip(let chip):
                sentence
                    + Text(chip.text)
                    .fontWeight(.medium)
                    .foregroundStyle(chip.openable ? Color.inkLink : Color.ink)
            }
        }
        .font(.subheadline)
    }

    private static func symbol(for row: ConversationToolRow) -> String {
        switch row.controlKind {
        case .archive: return "archivebox"
        case .stop: return "stop.circle"
        case .action, nil: break
        }
        switch row.kind {
        case .message: return "paperplane"
        case .control: return "bolt"
        case .open: return "arrow.up.right.square"
        case .createWorkspace, .addAgent: return "plus"
        case .renameWorkspace, .renameSession: return "pencil"
        }
    }
}

/// Every action a turn carried, under one line that counts them: open while
/// the turn still runs, closed once it has settled, the reader's press
/// holding under the state it was made in.
private struct ActionsFoldRow: View {
    let rows: [ConversationToolRow]
    let judgment: ConversationJudgment
    let pending: Bool
    @Binding var choice: ConversationFoldChoice?
    let openSession: (RosterSession) -> Void

    var body: some View {
        DisclosureGroup(
            isExpanded: Binding(
                get: { ConversationTurnRows.foldOpen(choice: choice, pending: pending) },
                set: { choice = ConversationFoldChoice(pending: pending, open: $0) }
            )
        ) {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    ActionRow(row: row, judgment: judgment, openSession: openSession)
                }
            }
            .padding(.top, 8)
        } label: {
            HStack(spacing: 8) {
                if judgment == .own {
                    LukeMark()
                        .foregroundStyle(Color.inkSecondary)
                        .frame(width: 18, height: 18)
                }
                Text("\(rows.count) actions")
                    .font(.subheadline)
                    .foregroundStyle(Color.inkSecondary)
            }
        }
        .tint(Color.inkTertiary)
        .padding(.horizontal, 4)
    }
}

/// The turn's working under a count: closed by default, a native disclosure
/// rather than a control of Luke's own.
private struct DetailsRow: View {
    let items: [ConversationDetail]
    let judgment: ConversationJudgment
    let openSession: (RosterSession) -> Void
    @State private var open = false

    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(items) { item in
                    switch item {
                    case .tool(let part):
                        detail(part)
                    case .refusedAction(_, let row):
                        ActionRow(row: row, judgment: judgment, openSession: openSession)
                    }
                }
            }
            .padding(.top, 8)
        } label: {
            Text(items.count == 1 ? "1 detail" : "\(items.count) details")
                .font(.footnote)
                .foregroundStyle(Color.inkTertiary)
        }
        .tint(Color.inkTertiary)
        .padding(.horizontal, 4)
    }

    /// A call the view classed as a detail: the turn's working, named by its
    /// tool and its state and nothing of what it read or wrote.
    private func detail(_ part: ToolPart) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(part.toolName.replacingOccurrences(of: "_", with: " "))
                    .font(.footnote)
                    .foregroundStyle(Color.inkSecondary)
                Text(Self.stateLabel(part.state))
                    .font(.caption2)
                    .foregroundStyle(Color.inkTertiary)
            }
            if part.state == .outputError, let errorText = part.errorText {
                Text(errorText)
                    .font(.caption2)
                    .foregroundStyle(Color.errorInk)
            }
        }
    }

    private static func stateLabel(_ state: ToolPartState) -> String {
        switch state {
        case .inputStreaming, .inputAvailable: "Under way"
        case .outputAvailable: "Done"
        case .outputError: "Failed"
        }
    }
}
