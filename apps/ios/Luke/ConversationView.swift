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
/// a reply's bubble. The screen polls the change signal while it stands in
/// the foreground and draws only what it holds in memory.
///
/// Every row here is masked from the session recording — the whole scroll
/// carries the recording library's mask, the way the desktop blocks its
/// Conversation subtree — so the conversation's words, the sessions named in
/// it, and a refusal's reason reach this phone and nothing else.
struct ConversationView: View {
    let conversation: ConversationStore

    @Environment(AccountSession.self) private var account
    @Environment(SessionsStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    /// The reader's presses on each turn's actions fold, by turn id.
    @State private var foldChoices: [String: ConversationFoldChoice] = [:]
    /// The instant the thread's dates are read against; moves when a poll
    /// lands, when the screen appears, and at midnight.
    @State private var now = Date()

    private static let endId = "conversation-end"

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
                    let turnRows = turns
                    ForEach(Array(turnRows.enumerated()), id: \.element.id) { index, turn in
                        if let opensAt = Self.firstInstant(of: turn),
                           ConversationTimeBreak.opens(
                               after: index == 0 ? nil : turnRows[index - 1].rows.compactMap(Self.instant).last,
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
                                openSession: { session in store.openLeavingConversation(session) }
                            )
                        }
                    }
                    if let failure = conversation.failure {
                        failureRow(failure)
                    }
                    Color.clear
                        .frame(height: 1)
                        .id(Self.endId)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            // Masked whole, the way the desktop blocks its Conversation
            // subtree: the recording sees the screen's frame and none of
            // its words.
            .postHogMask()
            .defaultScrollAnchor(.bottom)
            .onChange(of: conversation.groups.count) {
                now = Date()
                withAnimation { proxy.scrollTo(Self.endId, anchor: .bottom) }
            }
        }
        .background(Color.ground.ignoresSafeArea())
        .navigationTitle("Conversation")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { now = Date() }
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

    private func foldBinding(_ turnId: String) -> Binding<ConversationFoldChoice?> {
        Binding(
            get: { foldChoices[turnId] },
            set: { foldChoices[turnId] = $0 }
        )
    }

    private static func instant(_ row: ConversationRow) -> Date? {
        switch row {
        case .words(_, _, _, let at, _), .action(_, _, let at), .actionsFold(_, _, let at): at
        case .reasoning, .details: nil
        }
    }

    private static func firstInstant(of turn: ConversationTurnRows) -> Date? {
        turn.rows.compactMap(instant).first
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

    var body: some View {
        switch row {
        case .words(_, let speaker, let text, _, let unspoken):
            wordsRow(speaker: speaker, text: text, unspoken: unspoken)
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
    private func wordsRow(speaker: ConversationSpeaker, text: String, unspoken: Bool) -> some View {
        switch speaker {
        case .you:
            DeveloperMessageBubble(words: text)
        case .luke:
            VStack(alignment: .leading, spacing: 3) {
                AgentMessageBubble(words: text)
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
            OwnJudgmentRow {
                MarkdownMessageView(text)
                    .foregroundStyle(Color.inkSecondary)
            }
        }
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
