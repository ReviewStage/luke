import LukeKit
import SwiftUI

/// The Conversation as the watch draws it: the same stored thread the phone
/// and the Mac read, through the same per-resource routes and the same
/// change signal, over the one URLSession the wrist waits for a path on. The
/// list only reads. A rating the developer gave a message is shown under
/// its turn and offered nowhere; the phone draws the control. The developer's
/// asks are sent bubbles and Luke's replies received ones, an action is one
/// wrapping sentence that opens its session's screen while the roster still
/// holds it, and a turn Luke opened himself leads with his face. The poll
/// runs only while the app is active: the wrist dropping or the app leaving
/// cancels it, and a poll cut short that way is not the service unreachable.
struct WatchConversationView: View {
    let conversation: ConversationStore

    @Environment(WatchAccountSession.self) private var account
    @Environment(WatchRosterStore.self) private var store
    @Environment(WatchNavigation.self) private var navigation
    @Environment(\.scenePhase) private var scenePhase
    /// The reader's presses on each turn's actions fold, by turn id.
    @State private var foldChoices: [String: ConversationFoldChoice] = [:]
    /// The instant the thread's dates are read against; moves when a poll
    /// lands, when the page appears, and at midnight.
    @State private var now = Date()

    private static let endId = "conversation-end"

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 6) {
                    if !conversation.opened && conversation.failure == nil {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 24)
                    } else if conversation.groups.isEmpty && conversation.failure == nil {
                        LukeMark()
                            .foregroundStyle(.secondary)
                            .frame(width: 44, height: 40)
                            .frame(maxWidth: .infinity, minHeight: 80, alignment: .center)
                    }
                    let ratings = conversation.ratings
                    let turns = conversation.groups.map { group in
                        (group: group, rows: ConversationTurnRows(group: group, roster: store.sessions))
                    }
                    ForEach(Array(turns.enumerated()), id: \.element.rows.id) { index, turn in
                        if let opensAt = turn.rows.opensAt,
                           ConversationTimeBreak.opens(
                               after: index == 0 ? nil : turns[index - 1].rows.closesAt,
                               recordedAt: opensAt
                           )
                        {
                            WatchTimeBreakLabel(recordedAt: opensAt, now: now)
                        }
                        ForEach(turn.rows.rows) { row in
                            WatchConversationRow(
                                row: row,
                                judgment: turn.rows.judgment,
                                pending: turn.rows.pending,
                                foldChoice: foldBinding(turn.rows.turnId),
                                openSession: { session in navigation.open(session) }
                            )
                        }
                        ForEach(turn.group.messages, id: \.message.id) { message in
                            if let rating = ratings[message.message.id] {
                                WatchRatingLabel(rating: rating)
                            }
                        }
                    }
                    if let failure = conversation.failure {
                        failureRow(failure)
                    }
                    Color.clear
                        .frame(height: 1)
                        .id(Self.endId)
                }
                .padding(.horizontal, 4)
                .padding(.top, 8)
                // Bottom padding so the newest row clears the floating controls
                // while still being reachable by scroll.
                .padding(.bottom, 88)
                .frame(maxWidth: .infinity)
            }
            .defaultScrollAnchor(.bottom)
            .onChange(of: conversation.groups.count) {
                now = Date()
                withAnimation { proxy.scrollTo(Self.endId, anchor: .bottom) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { now = Date() }
        .onReceive(NotificationCenter.default.publisher(for: .NSCalendarDayChanged)) { _ in
            now = Date()
        }
        // Keyed by the scene phase so the loop restarts as the app comes to
        // the foreground and ends as it leaves: a watch backgrounds at every
        // wrist drop, and the poll runs only while the app is active.
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

    /// Why the thread is not being read, in the quiet voice the dates use. An
    /// unreadable row names its sequence so the developer can report it; it is
    /// never drawn as an empty thread.
    private func failureRow(_ failure: ConversationStore.Failure) -> some View {
        let words: String =
            switch failure {
            case .unreadableRow(let row): "Message \(row.seq) could not be read."
            case .unavailable: WatchNetwork.unreachable
            }
        return Text(words)
            .font(.system(size: 10))
            .foregroundStyle(.red)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
    }
}

// MARK: - Rows

/// One row of a turn, drawn as what it is.
private struct WatchConversationRow: View {
    let row: ConversationRow
    let judgment: ConversationJudgment
    let pending: Bool
    @Binding var foldChoice: ConversationFoldChoice?
    let openSession: (RosterSession) -> Void

    var body: some View {
        switch row {
        case .words(_, let speaker, let text, _, let unspoken, _):
            wordsRow(speaker: speaker, text: text, unspoken: unspoken)
        case .reasoning(_, let text):
            WatchFoldRow(label: "Thought") {
                Text(text)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        case .action(_, let toolRow, _):
            WatchActionRow(row: toolRow, judgment: judgment, openSession: openSession)
        case .actionsFold(_, let rows, _):
            WatchFold(
                isExpanded: Binding(
                    get: { ConversationTurnRows.foldOpen(choice: foldChoice, pending: pending) },
                    set: { foldChoice = ConversationFoldChoice(pending: pending, open: $0) }
                )
            ) {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        WatchActionRow(row: row, judgment: judgment, openSession: openSession)
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    if judgment == .own {
                        LukeMark().foregroundStyle(.secondary).frame(width: 14, height: 14)
                    }
                    Text("\(rows.count) actions")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }
            }
        case .details(_, let items):
            WatchFoldRow(label: items.count == 1 ? "1 detail" : "\(items.count) details") {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(items) { item in
                        switch item {
                        case .tool(let part):
                            detail(part)
                        case .refusedAction(_, let row):
                            WatchActionRow(row: row, judgment: judgment, openSession: openSession)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func wordsRow(speaker: ConversationSpeaker, text: String, unspoken: Bool) -> some View {
        switch speaker {
        case .you:
            WatchWordsBubble(words: text, sent: true)
        case .luke:
            VStack(alignment: .leading, spacing: 2) {
                WatchWordsBubble(words: text, sent: false)
                if unspoken {
                    Text("Not spoken")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .padding(.leading, 9)
                }
            }
        case .note:
            Text(text)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 4)
        case .own:
            HStack(alignment: .top, spacing: 6) {
                LukeMark()
                    .foregroundStyle(.secondary)
                    .frame(width: 14, height: 14)
                    .padding(.top, 2)
                    .accessibilityLabel("Luke, on his own judgment")
                Text(text)
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 4)
        }
    }

    /// A call the view classed as a detail: the turn's working, named by its
    /// tool and its state and nothing of what it read or wrote.
    private func detail(_ part: ToolPart) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Text(part.toolName.replacingOccurrences(of: "_", with: " "))
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                Text(Self.stateLabel(part.state))
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
            }
            if part.state == .outputError, let errorText = part.errorText {
                Text(errorText)
                    .font(.system(size: 10))
                    .foregroundStyle(.red)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private static func stateLabel(_ state: ToolPartState) -> String {
        switch state {
        case .inputStreaming, .inputAvailable: "Under way"
        case .outputAvailable: "Done"
        case .outputError: "Failed"
        }
    }
}

/// One line of the thread as a bubble: the developer's words sent, Luke's
/// received. The watch's screen is too narrow for a bubble to keep room
/// spare beside it, so each takes the width its words need and no more.
private struct WatchWordsBubble: View {
    let words: String
    let sent: Bool

    var body: some View {
        Text(words)
            .font(.system(size: 13))
            .foregroundStyle(sent ? Color.white : Color.primary)
            .multilineTextAlignment(.leading)
            .padding(.horizontal, 9)
            .padding(.vertical, 7)
            .background {
                RoundedRectangle(cornerRadius: 12)
                    .fill(sent ? Color.accentColor : Color.secondary.opacity(0.18))
            }
            .frame(maxWidth: .infinity, alignment: sent ? .trailing : .leading)
    }
}

/// An action Luke carried, as one wrapping sentence led by a mark for the kind
/// of thing it was — his face, under his own judgment — with the session's
/// name set inside it; while the roster still holds the session the sentence
/// is a press onto its screen. A refused or unknown outcome says why under
/// the words; an accepted one shows the carrier's own note where it wrote one.
private struct WatchActionRow: View {
    let row: ConversationToolRow
    let judgment: ConversationJudgment
    let openSession: (RosterSession) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Group {
                if judgment == .own {
                    LukeMark().foregroundStyle(.secondary)
                } else {
                    Image(systemName: Self.symbol(for: row))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 14, height: 14)
            .padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    words
                    if row.outcome == .pending {
                        ProgressView()
                            .controlSize(.mini)
                            .accessibilityLabel("Under way")
                    }
                }
                if let reason = row.reason {
                    Text(reason)
                        .font(.system(size: 10))
                        .foregroundStyle(row.outcome == .refused ? Color.red : Color.orange)
                }
                if let note = row.note {
                    Text(note).font(.system(size: 10)).foregroundStyle(.secondary)
                }
                if let warning = row.warning {
                    Text(warning).font(.system(size: 10)).foregroundStyle(.orange)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            judgment == .own ? "Luke, on his own judgment: \(row.sentence)" : "Action: \(row.sentence)"
        )
    }

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

    /// The runs as one `Text`, so the sentence wraps like any other line; the
    /// session's name is set in the accent while its screen can be opened.
    private var sentence: Text {
        row.runs.reduce(Text("")) { sentence, run in
            switch run {
            case .text(let text):
                sentence + Text(text).foregroundStyle(.secondary)
            case .chip(let chip):
                sentence
                    + Text(chip.text)
                    .fontWeight(.medium)
                    .foregroundStyle(chip.openable ? Color.accentColor : Color.primary)
            }
        }
        .font(.system(size: 12))
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

/// A fold the watch draws for itself, because `DisclosureGroup` does not
/// exist on watchOS: one plain button whose label is the fold's own line, a
/// chevron turned for its state, and the content under it only while open.
/// The press moves the binding it was handed and nothing else, so the fold
/// is presentation alone and the watch stays read-only.
private struct WatchFold<Content: View, Label: View>: View {
    @Binding var isExpanded: Bool
    @ViewBuilder let content: Content
    @ViewBuilder let label: Label

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                withAnimation { isExpanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    label
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                        .accessibilityHidden(true)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
            if isExpanded {
                content
            }
        }
    }
}

/// A fold closed by default, holding only its own open state: the watch's
/// stand-in for a native disclosure, and still no control of Luke's own.
private struct WatchFoldRow<Content: View>: View {
    let label: String
    @ViewBuilder let content: Content
    @State private var open = false

    var body: some View {
        WatchFold(isExpanded: $open) {
            content
        } label: {
            Text(label)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 4)
    }
}

/// The developer's verdict on a message, shown and not offered: the glyph
/// and the word, in the quiet voice, with nothing to press.
private struct WatchRatingLabel: View {
    let rating: MessageRating

    var body: some View {
        Label(rating == .up ? "Rated up" : "Rated down", systemImage: rating == .up ? "hand.thumbsup" : "hand.thumbsdown")
            .font(.system(size: 10))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 6)
    }
}

/// The moment a turn opened, set over it the way iMessage dates a message
/// that followed a long silence, worded by the rule the phone and the desktop
/// share: centered, in the quiet voice of the status label.
private struct WatchTimeBreakLabel: View {
    let recordedAt: Date
    let now: Date

    var body: some View {
        let label = ConversationTimeBreak.label(recordedAt: recordedAt, now: now)
        return (Text(label.day).fontWeight(.semibold) + Text(" \(label.time)"))
            .font(.system(size: 10))
            .monospacedDigit()
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.top, 4)
            .accessibilityElement(children: .combine)
    }
}
