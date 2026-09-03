import LukeKit
import SwiftUI

struct WatchRosterView: View {
    @Environment(WatchRosterStore.self) private var store

    var body: some View {
        List {
            if store.isLoading && store.sessions.isEmpty {
                ForEach(0 ..< 3, id: \.self) { _ in
                    WatchSessionRow(session: .placeholder)
                        .redacted(reason: .placeholder)
                }
            } else if store.sessions.isEmpty {
                ContentUnavailableView(
                    "No Active Sessions",
                    systemImage: "checkmark.circle"
                )
                .listRowBackground(Color.clear)
            } else {
                ForEach(store.sessions) { session in
                    NavigationLink(value: session) {
                        WatchSessionRow(session: session)
                    }
                }
            }
            if let error = store.loadError {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(.red)
                    .listRowBackground(Color.clear)
            }
        }
        .navigationTitle("Sessions")
        .navigationDestination(for: RosterSession.self) { session in
            WatchSessionDetailView(session: session)
        }
        .refreshable { await store.load() }
        .task { await store.poll() }
    }
}

// MARK: - Session row

private struct WatchSessionRow: View {
    let session: RosterSession

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Circle()
                .fill(session.statusColor)
                .frame(width: 8, height: 8)
                .padding(.top, 4)
            VStack(alignment: .leading, spacing: 2) {
                Text(session.title)
                    .font(.headline)
                    .lineLimit(1)
                if let error = session.error {
                    Text(error)
                        .font(.caption2)
                        .foregroundStyle(.red)
                        .lineLimit(2)
                } else if let place = session.branch ?? session.workspace {
                    Text(place)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .monospaced()
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Session detail

struct WatchSessionDetailView: View {
    let session: RosterSession

    @Environment(WatchAccountSession.self) private var account
    @State private var conversation: [ConversationMessage] = []
    @State private var forwardCursor: String?
    @State private var oldestOffset: Int?
    @State private var hasOlder = false
    @State private var loadingOlder = false
    @State private var openAttempted = false
    @State private var loadError: String?
    @State private var scrollIntent: ScrollIntent?
    @State private var infoShown = false

    private let conversationClient = ConversationClient(serviceURL: AccountConstants.serviceURL)

    private enum ScrollIntent: Equatable {
        case end
        case anchor(String)
    }

    private static let pollSeconds: UInt64 = 10
    private static let maximumPollReads = 5
    private static let conversationEndId = "watch-conversation-end"
    // Markdown layout is noticeably slower on the Watch than on iPhone. Give
    // the newest bubble a full render pass before pinning the end again.
    private static let layoutSettleNanoseconds: UInt64 = 1_000_000_000

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    if session.canReadConversation {
                        if hasOlder {
                            Button {
                                Task { await loadOlder() }
                            } label: {
                                if loadingOlder {
                                    ProgressView()
                                        .frame(maxWidth: .infinity)
                                } else {
                                    Label("Earlier Messages", systemImage: "arrow.up")
                                        .font(.caption2)
                                        .frame(maxWidth: .infinity)
                                }
                            }
                            .buttonStyle(.plain)
                            .disabled(loadingOlder)
                            .padding(.vertical, 4)
                        }

                        conversationContent
                    } else {
                        Text("Conversation unavailable for this session.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 6)
                    }

                    Color.clear
                        .frame(height: 1)
                        .id(Self.conversationEndId)
                }
                .padding(.horizontal, 4)
                .padding(.vertical, 6)
            }
            .refreshable { await refreshConversation() }
            .onChange(of: scrollIntent) {
                guard let intent = scrollIntent else { return }
                scrollIntent = nil
                switch intent {
                case .end:
                    let target = conversation.last?.id ?? Self.conversationEndId
                    proxy.scrollTo(target, anchor: .bottom)
                    Task {
                        try? await Task.sleep(nanoseconds: Self.layoutSettleNanoseconds)
                        guard !Task.isCancelled else { return }
                        let settledTarget = conversation.last?.id ?? Self.conversationEndId
                        proxy.scrollTo(settledTarget, anchor: .bottom)
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
        .navigationTitle(session.title)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    infoShown = true
                } label: {
                    Image(systemName: "ellipsis")
                }
                .accessibilityLabel("Session Info")
            }
        }
        .sheet(isPresented: $infoShown) {
            WatchSessionInfoView(session: session)
        }
    }

    @ViewBuilder
    private var conversationContent: some View {
        if conversation.isEmpty {
            if !openAttempted {
                ProgressView("Loading Messages")
                    .font(.caption2)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            } else if let loadError {
                VStack(spacing: 6) {
                    Text(loadError)
                        .font(.caption2)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                    Button("Retry") {
                        Task { await openConversation() }
                    }
                    .font(.caption2)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            } else {
                ContentUnavailableView(
                    "No Messages",
                    systemImage: "bubble.left.and.bubble.right"
                )
            }
        } else {
            ForEach(conversation) { message in
                WatchConversationBubble(message: message)
                    .id(message.id)
            }
            if let error = session.error {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(.red)
                    .padding(8)
                    .background(.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    private func openConversation() async {
        defer { openAttempted = true }
        do {
            let answer = try await read(.latest)
            conversation = answer.messages
            forwardCursor = answer.lastMessageId
            oldestOffset = answer.firstOffset
            hasOlder = answer.hasOlder
            loadError = nil
            scrollIntent = .end
        } catch is AccountSessionError {
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func refreshConversation() async {
        guard session.canReadConversation else { return }
        forwardCursor = nil
        openAttempted = false
        await openConversation()
    }

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
                loadError = nil
                guard answer.hasMore else { return }
            } catch {
                return
            }
        }
    }

    private func loadOlder() async {
        guard !loadingOlder, hasOlder, let offset = oldestOffset, offset > 0 else { return }
        loadingOlder = true
        defer { loadingOlder = false }
        do {
            let answer = try await read(.before(offset))
            let anchor = conversation.first?.id
            let known = Set(conversation.map(\.id))
            conversation.insert(contentsOf: answer.messages.filter { !known.contains($0.id) }, at: 0)
            if let first = answer.firstOffset {
                oldestOffset = first
            }
            hasOlder = answer.hasOlder
            if let anchor {
                scrollIntent = .anchor(anchor)
            }
        } catch {
            loadError = error.localizedDescription
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
}

private struct WatchSessionInfoView: View {
    let session: RosterSession

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(session.statusColor)
                        .frame(width: 8, height: 8)
                    Text(session.status.capitalized)
                        .font(.headline)
                }

                if let branch = session.branch {
                    infoValue("Branch", value: branch, monospaced: true)
                }
                if let workspace = session.workspace, workspace != session.branch {
                    infoValue("Workspace", value: workspace)
                }
                if let error = session.error {
                    Text(error)
                        .font(.caption2)
                        .foregroundStyle(.red)
                }

                Button("Done") { dismiss() }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
        }
        .navigationTitle("Session Info")
    }

    private func infoValue(_ label: String, value: String, monospaced: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption)
                .fontDesign(monospaced ? .monospaced : .default)
        }
    }
}

private struct WatchConversationBubble: View {
    let message: ConversationMessage

    private var isUser: Bool {
        if case .user = message.author { true } else { false }
    }

    var body: some View {
        WatchMarkdownText(message.text)
            .font(.caption2)
            .foregroundStyle(isUser ? Color.white : Color.primary)
            .multilineTextAlignment(isUser ? .trailing : .leading)
            .padding(.horizontal, 9)
            .padding(.vertical, 7)
            .background {
                RoundedRectangle(cornerRadius: 12)
                    .fill(isUser ? Color.accentColor : Color.secondary.opacity(0.18))
            }
            .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
            .accessibilityLabel("\(isUser ? "You" : "Agent"): \(message.text)")
    }
}

private struct WatchMarkdownText: View {
    let words: String

    init(_ words: String) {
        self.words = words
    }

    var body: some View {
        if let attributed = try? AttributedString(markdown: words) {
            Text(attributed)
        } else {
            Text(words)
        }
    }
}

// MARK: - Helpers

private extension RosterSession {
    var statusColor: Color {
        switch status {
        case "working": .accentColor
        case "waiting": .orange
        case "error": .red
        case "complete": .green
        default: Color(white: 0.5)
        }
    }

    static let placeholder = RosterSession(
        providerId: "placeholder",
        sessionId: "placeholder",
        title: "Session name placeholder",
        status: "working",
        branch: "feat/some-branch"
    )
}
