import LukeKit
import SwiftUI

struct WatchRosterView: View {
    @Environment(WatchRosterStore.self) private var store
    @Environment(WatchAccountSession.self) private var account
    @Environment(ProductEventSender.self) private var events
    @State private var archiveFailure: String?

    private let actClient = ActClient(
        baseURL: AccountConstants.serviceURL, http: WatchNetwork.session
    )

    var body: some View {
        List {
            if !store.hasLoaded && store.sessions.isEmpty {
                ForEach(0 ..< 3, id: \.self) { _ in
                    WatchSessionRow(session: .placeholder)
                        .redacted(reason: .placeholder)
                }
            } else {
                if store.isNarrowed {
                    narrowingRow
                }
                ForEach(store.visibleSessions) { session in
                    NavigationLink(value: session) {
                        WatchSessionRow(session: session)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        if let archive = archiveControl(session) {
                            Button {
                                archiveSession(session, control: archive)
                            } label: {
                                Label(archive.label, systemImage: "archivebox")
                            }
                        }
                    }
                }
            }
            if let error = store.loadError, !store.sessions.isEmpty {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(.red)
                    .listRowBackground(Color.clear)
            }
        }
        .overlay {
            if store.hasLoaded && store.sessions.isEmpty {
                ContentUnavailableView(
                    "No Active Sessions",
                    systemImage: "checkmark.circle",
                    description: store.loadError.map(Text.init)
                )
            }
        }
        .navigationTitle("Sessions")
        .navigationDestination(for: RosterSession.self) { session in
            WatchSessionDetailView(session: session)
        }
        .refreshable { await store.load() }
        .task { await store.poll() }
        .alert(
            "Not Archived",
            isPresented: Binding(
                get: { archiveFailure != nil },
                set: { if !$0 { archiveFailure = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(archiveFailure ?? "")
        }
    }

    /// The narrowing a list ask left standing, said in the words the rows
    /// draw, with the one press that lifts it. Drawn above the rows it leaves
    /// so a list Luke narrowed never hides a session without saying so.
    private var narrowingRow: some View {
        Button {
            store.showAll()
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text(narrowingLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                Label("Show All", systemImage: "line.3.horizontal.decrease.circle.fill")
                    .font(.caption)
                    .foregroundStyle(Color.accentColor)
                if store.visibleSessions.isEmpty {
                    Text("No sessions match.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityLabel("Show all sessions")
        .accessibilityHint("Filtered to \(narrowingLabel)")
    }

    private var narrowingLabel: String {
        var parts = store.filters
            .map { filter -> String in
                switch filter {
                case .provider(let providerId): VaultProviderID.displayLabel(forWireId: providerId)
                case .status(let status): status.capitalized
                }
            }
            .sorted()
        let query = store.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if !query.isEmpty { parts.append("\u{201C}\(query)\u{201D}") }
        return parts.joined(separator: " \u{00B7} ")
    }

    private func archiveControl(_ session: RosterSession) -> RosterSessionControl? {
        session.controls.first { $0.kind == .archive }
    }

    private func archiveSession(_ session: RosterSession, control: RosterSessionControl) {
        Task {
            let outcome = await account.performAct(
                counting: .controlRun,
                provider: session.providerId,
                events: events,
                fallbackReason: "The session was not archived."
            ) { token in
                try await actClient.executeControl(
                    accessToken: token,
                    providerId: session.providerId,
                    providerSessionId: session.sessionId,
                    controlId: control.id
                )
            }
            switch outcome {
            case .delivered:
                await store.load()
            case .refused(let reason):
                archiveFailure = reason
            case .signedOut:
                break
            }
        }
    }
}

// MARK: - Session row

private struct WatchSessionRow: View {
    let session: RosterSession

    var body: some View {
        VStack(alignment: .leading) {
            HStack(alignment: .top) {
                Text(session.title)
                    .font(.headline)
                    .lineLimit(2)
                Spacer(minLength: 0)
                if session.status == "waiting" {
                    Circle()
                        .fill(.orange)
                        .frame(width: 8, height: 8)
                        .padding(.top, 4)
                }
            }
            HStack(alignment: .firstTextBaseline) {
                Text(session.error ?? session.status.capitalized)
                    .font(.caption2)
                    .foregroundStyle(session.error == nil ? Color.secondary : Color.red)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if let date = session.lastActivityAt {
                    TimelineView(.periodic(from: .distantPast, by: 30)) { context in
                        Text(lastActivityLabel(lastActivityAt: date, now: context.date))
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                }
            }
        }
    }
}

// MARK: - Session detail

struct WatchSessionDetailView: View {
    private let openedSession: RosterSession

    @Environment(WatchAccountSession.self) private var account
    @Environment(WatchRosterStore.self) private var store
    @Environment(ProductEventSender.self) private var events
    @Environment(\.dismiss) private var dismiss
    @State private var conversation: [ConversationMessage] = []
    @State private var forwardCursor: String?
    @State private var oldestOffset: Int?
    @State private var hasOlder = false
    @State private var loadingOlder = false
    @State private var openAttempted = false
    @State private var loadError: String?
    @State private var scrollIntent: ScrollIntent?
    @State private var infoShown = false
    @State private var outgoing: [WatchOutgoingMessage] = []
    @State private var claimedCopyIds: Set<String> = []
    @State private var conversationGeneration = 0

    private let conversationClient = ConversationClient(
        serviceURL: AccountConstants.serviceURL, http: WatchNetwork.session
    )
    private let actClient = ActClient(
        baseURL: AccountConstants.serviceURL, http: WatchNetwork.session
    )

    private enum ScrollIntent: Equatable {
        case end
        case anchor(String)
    }

    private static let pollSeconds: UInt64 = 10
    private static let maximumPollReads = 5
    private static let conversationEndId = "watch-conversation-end"
    private static let composerId = "watch-message-composer"
    private static let sendClockTolerance: TimeInterval = 120
    // Markdown layout is noticeably slower on the Watch than on iPhone. Give
    // the newest bubble a full render pass before pinning the end again.
    private static let layoutSettleNanoseconds: UInt64 = 1_000_000_000

    init(session: RosterSession) {
        openedSession = session
    }

    private var session: RosterSession {
        store.sessions.first { $0.id == openedSession.id } ?? openedSession
    }

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

                        if !centersConversationState {
                            conversationContent
                        }

                    } else {
                        Text("Conversation unavailable for this session.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 6)
                    }

                    ForEach(outgoing) { message in
                        WatchOutgoingBubble(message: message)
                            .id(message.id)
                    }

                    if session.canReceiveMessage {
                        composer
                            .id(Self.composerId)
                    } else {
                        Color.clear
                            .frame(height: 1)
                            .id(Self.conversationEndId)
                    }
                }
                .padding(.horizontal, 4)
                .padding(.top, 6)
            }
            .defaultScrollAnchor(.bottom)
            .overlay {
                if centersConversationState {
                    conversationContent
                        .padding(.horizontal, 4)
                        // Empty/loading states are visual only, so they must not
                        // intercept the native composer beneath them. An error
                        // keeps hit testing for its compact Retry button.
                        .allowsHitTesting(loadError != nil)
                }
            }
            .refreshable { await refreshConversation() }
            .onChange(of: scrollIntent) {
                guard let intent = scrollIntent else { return }
                scrollIntent = nil
                switch intent {
                case .end:
                    let target = session.canReceiveMessage
                        ? Self.composerId
                        : (outgoing.last?.id ?? conversation.last?.id ?? Self.conversationEndId)
                    proxy.scrollTo(target, anchor: .bottom)
                    Task {
                        try? await Task.sleep(nanoseconds: Self.layoutSettleNanoseconds)
                        guard !Task.isCancelled else { return }
                        let settledTarget = session.canReceiveMessage
                            ? Self.composerId
                            : (outgoing.last?.id ?? conversation.last?.id ?? Self.conversationEndId)
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
            WatchSessionInfoView(session: session) {
                infoShown = false
                dismiss()
            }
        }
    }

    private var centersConversationState: Bool {
        session.canReadConversation && conversation.isEmpty && outgoing.isEmpty
    }

    @ViewBuilder
    private var conversationContent: some View {
        if conversation.isEmpty {
            if !openAttempted {
                ProgressView()
                    .accessibilityLabel("Loading Messages")
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
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption2)
                    .foregroundStyle(.red)
            }
        }
    }

    private func openConversation() async {
        let generation = conversationGeneration
        defer {
            if generation == conversationGeneration {
                openAttempted = true
            }
        }
        do {
            let answer = try await read(.latest)
            guard generation == conversationGeneration else { return }
            conversation = answer.messages
            forwardCursor = answer.lastMessageId
            oldestOffset = answer.firstOffset
            hasOlder = answer.hasOlder
            loadError = nil
            handOverDeliveredSends()
        } catch is AccountSessionError {
            guard !Task.isCancelled, generation == conversationGeneration else { return }
            account.signOut()
        } catch {
            guard generation == conversationGeneration else { return }
            loadError = WatchNetwork.describe(error)
        }
    }

    private func refreshConversation() async {
        guard session.canReadConversation else { return }
        conversationGeneration += 1
        forwardCursor = nil
        openAttempted = false
        await openConversation()
    }

    private func pollNewer() async {
        let generation = conversationGeneration
        for _ in 0 ..< Self.maximumPollReads {
            guard !Task.isCancelled, let cursor = forwardCursor else { return }
            do {
                let answer = try await read(.after(cursor))
                guard generation == conversationGeneration else { return }
                let known = Set(conversation.map(\.id))
                conversation.append(contentsOf: answer.messages.filter { !known.contains($0.id) })
                if let last = answer.lastMessageId {
                    forwardCursor = last
                }
                loadError = nil
                handOverDeliveredSends()
                guard answer.hasMore else { return }
            } catch {
                return
            }
        }
    }

    private func loadOlder() async {
        guard !loadingOlder, hasOlder, let offset = oldestOffset, offset > 0 else { return }
        let generation = conversationGeneration
        loadingOlder = true
        defer { loadingOlder = false }
        do {
            let answer = try await read(.before(offset))
            guard generation == conversationGeneration else { return }
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
            guard generation == conversationGeneration else { return }
            loadError = WatchNetwork.describe(error)
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

    @ViewBuilder
    private var composer: some View {
        if #available(watchOS 26.0, *) {
            composerLink
                .glassEffect(.regular.interactive())
        } else {
            composerLink
                .background(.ultraThinMaterial, in: Capsule())
        }
    }

    private var composerLink: some View {
        TextFieldLink(prompt: Text("Message")) {
            Text("Message")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 9)
        } onSubmit: { submittedText in
            send(submittedText)
        }
        .submitLabel(.send)
        .buttonStyle(.plain)
    }

    private func send(_ submittedText: String) {
        let text = submittedText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let message = WatchOutgoingMessage(
            text: text,
            delivery: .sending
        )
        outgoing.append(message)
        scrollIntent = .end
        Task {
            let outcome = await account.performAct(
                counting: .messageSend,
                provider: session.providerId,
                events: events,
                fallbackReason: "The message was not delivered."
            ) { token in
                try await actClient.sendMessage(
                    accessToken: token,
                    providerId: session.providerId,
                    providerSessionId: session.sessionId,
                    text: message.text
                )
            }
            let delivery: WatchOutgoingMessage.Delivery
            switch outcome {
            case .delivered: delivery = .sent
            case .refused(let reason): delivery = .failed(reason: reason)
            case .signedOut: delivery = .failed(reason: "Signed out.")
            }

            guard let index = outgoing.firstIndex(where: { $0.id == message.id }) else { return }
            outgoing[index].delivery = delivery
            if delivery == .sent {
                if forwardCursor == nil {
                    await openConversation()
                } else {
                    await pollNewer()
                }
                if let refreshedIndex = outgoing.firstIndex(where: { $0.id == message.id }),
                   claimFetchedCopy(for: outgoing[refreshedIndex])
                {
                    outgoing.remove(at: refreshedIndex)
                }
            }
        }
    }

    private func claimFetchedCopy(for pending: WatchOutgoingMessage) -> Bool {
        let match = conversation.first { fetched in
            fetched.author == .user
                && !claimedCopyIds.contains(fetched.id)
                && fetched.text == pending.text
                && fetched.receivedAt.map {
                    $0 >= pending.sentAt.addingTimeInterval(-Self.sendClockTolerance)
                } == true
        }
        guard let match else { return false }
        claimedCopyIds.insert(match.id)
        return true
    }

    private func handOverDeliveredSends() {
        let delivered = outgoing
            .filter { $0.delivery == .sent }
            .sorted { $0.sentAt < $1.sentAt }
        var handedOver: Set<String> = []
        for message in delivered where claimFetchedCopy(for: message) {
            handedOver.insert(message.id)
        }
        outgoing.removeAll { handedOver.contains($0.id) }
    }
}

private struct WatchSessionInfoView: View {
    let session: RosterSession
    let onArchived: () -> Void

    @Environment(WatchAccountSession.self) private var account
    @Environment(WatchRosterStore.self) private var store
    @Environment(ProductEventSender.self) private var events
    @Environment(\.openURL) private var openURL
    @State private var runningControl: String?
    @State private var renameTarget: RenameTarget?
    @State private var renameText = ""
    @State private var agentShown = false
    @State private var actFailure: String?

    private let actClient = ActClient(
        baseURL: AccountConstants.serviceURL, http: WatchNetwork.session
    )

    private enum RenameTarget: String, Identifiable {
        case session
        case workspace

        var id: String { rawValue }
        var title: String { self == .session ? "Rename Session" : "Rename Workspace" }
    }

    var body: some View {
        List {
            Section {
                infoField("Title") {
                    Text(session.title)
                }
                infoField("Provider") {
                    HStack(spacing: 8) {
                        WatchProviderMark(providerId: session.providerId)
                        Text(VaultProviderID.displayLabel(forWireId: session.providerId))
                    }
                }
                infoField("Status") {
                    HStack(spacing: 8) {
                        WatchStatusMark(status: session.status)
                        Text(session.status.capitalized)
                    }
                }
            } header: {
                sectionHeader("Details")
            }

            if session.workspace != nil || session.branch != nil {
                Section {
                    if let workspace = session.workspace {
                        infoField("Repository") {
                            Text(workspace)
                        }
                    }
                    if let branch = session.branch {
                        infoField("Branch") {
                            Text(branch)
                                .monospaced()
                        }
                    }
                } header: {
                    sectionHeader("Location")
                }
            }

            if session.lastActivityAt != nil || session.error != nil {
                Section {
                    if let lastActivityAt = session.lastActivityAt {
                        infoField("Last activity") {
                            Text(lastActivityAt.formatted(date: .abbreviated, time: .shortened))
                        }
                    }
                    if let error = session.error {
                        infoField("Error") {
                            Text(error)
                                .foregroundStyle(.red)
                        }
                    }
                } header: {
                    sectionHeader("Activity")
                }
            }

            if let change = session.change {
                Section {
                    actionButton(changeLabel(change), systemImage: "arrow.up.right.square") {
                        openURL(change)
                    }
                } header: {
                    sectionHeader("Links")
                }
            }

            if hasSessionActions {
                Section {
                    ForEach(session.controls.filter { $0.kind != .stop && $0.kind != .archive }) {
                        controlButton($0)
                    }
                    if !session.spawnableAgents.isEmpty {
                        actionButton("Add Agent…", systemImage: "plus.bubble") {
                            agentShown = true
                        }
                    }
                    if session.canRename {
                        actionButton("Rename Session…", systemImage: "pencil") {
                            beginRename(.session)
                        }
                    }
                    if session.canRenameWorkspace {
                        actionButton("Rename Workspace…", systemImage: "pencil.line") {
                            beginRename(.workspace)
                        }
                    }
                    ForEach(session.controls.filter { $0.kind == .archive }) { control in
                        controlButton(control)
                    }
                    ForEach(session.controls.filter { $0.kind == .stop }) { control in
                        controlButton(control, destructive: true)
                    }
                } header: {
                    sectionHeader("Actions")
                }
            }
        }
        .navigationTitle("Session Info")
        .sheet(isPresented: $agentShown) {
            WatchAgentSpawnerView(session: session, actClient: actClient) {
                agentShown = false
                await store.load()
            }
        }
        .alert(
            renameTarget?.title ?? "",
            isPresented: Binding(
                get: { renameTarget != nil },
                set: { if !$0 { renameTarget = nil } }
            )
        ) {
            TextField("Name", text: $renameText)
            Button("Rename") { rename() }
            Button("Cancel", role: .cancel) {}
        }
        .alert(
            "Action Not Delivered",
            isPresented: Binding(
                get: { actFailure != nil },
                set: { if !$0 { actFailure = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(actFailure ?? "")
        }
    }

    private var hasSessionActions: Bool {
        !session.controls.isEmpty || !session.spawnableAgents.isEmpty || session.canRename
            || session.canRenameWorkspace
    }

    private func infoField<Value: View>(
        _ label: String,
        @ViewBuilder value: () -> Value
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            value()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .foregroundStyle(Color.accentColor)
    }

    private func actionButton(
        _ label: String,
        systemImage: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(label, systemImage: systemImage)
        }
    }

    private func controlButton(
        _ control: RosterSessionControl,
        destructive: Bool = false
    ) -> some View {
        Button(role: destructive ? .destructive : nil) {
            runControl(control)
        } label: {
            HStack {
                if runningControl == control.id {
                    ProgressView()
                } else {
                    Image(systemName: controlSymbol(control))
                }
                Text(control.label)
            }
        }
        .disabled(runningControl != nil)
    }

    private func controlSymbol(_ control: RosterSessionControl) -> String {
        switch control.kind {
        case .stop: "stop.circle"
        case .archive: "archivebox"
        case .action, nil: "circle"
        }
    }

    private func changeLabel(_ url: URL) -> String {
        url.host?.lowercased() == "github.com" ? "View PR" : "Open Published Change"
    }

    private func beginRename(_ target: RenameTarget) {
        renameText = target == .session ? session.title : (session.workspace ?? "")
        renameTarget = target
    }

    private func rename() {
        guard let target = renameTarget else { return }
        let name = renameText
        renameTarget = nil
        Task {
            await performAct(counting: target == .session ? .sessionRename : .workspaceRename) {
                switch target {
                case .session:
                    try await actClient.renameSession(
                        accessToken: $0,
                        providerId: session.providerId,
                        providerSessionId: session.sessionId,
                        name: name
                    )
                case .workspace:
                    try await actClient.renameWorkspace(
                        accessToken: $0,
                        providerId: session.providerId,
                        providerSessionId: session.sessionId,
                        name: name
                    )
                }
            }
        }
    }

    private func runControl(_ control: RosterSessionControl) {
        runningControl = control.id
        Task {
            let delivered = await performAct(counting: .controlRun) {
                try await actClient.executeControl(
                    accessToken: $0,
                    providerId: session.providerId,
                    providerSessionId: session.sessionId,
                    controlId: control.id
                )
            }
            runningControl = nil
            if delivered, control.kind == .archive {
                onArchived()
            }
        }
    }

    @discardableResult
    private func performAct<Answer: ActAnswer>(
        counting act: ProductSessionAct,
        _ call: (String) async throws -> Answer
    ) async -> Bool {
        let outcome = await account.performAct(
            counting: act,
            provider: session.providerId,
            events: events,
            fallbackReason: "The action was not delivered.",
            call
        )
        switch outcome {
        case .delivered:
            await store.load()
            return true
        case .refused(let reason):
            actFailure = reason
            return false
        case .signedOut:
            return false
        }
    }
}

private struct WatchAgentSpawnerView: View {
    let session: RosterSession
    let actClient: ActClient
    let onDone: () async -> Void

    @Environment(WatchAccountSession.self) private var account
    @Environment(ProductEventSender.self) private var events
    @Environment(\.dismiss) private var dismiss
    @State private var agent: String
    @State private var name = ""
    @State private var task = ""
    @State private var spawning = false
    @State private var failure: String?

    init(
        session: RosterSession,
        actClient: ActClient,
        onDone: @escaping () async -> Void
    ) {
        self.session = session
        self.actClient = actClient
        self.onDone = onDone
        _agent = State(initialValue: session.spawnableAgents.first ?? "")
    }

    var body: some View {
        Form {
            Picker("Agent", selection: $agent) {
                ForEach(session.spawnableAgents, id: \.self) { kind in
                    Text(kind.capitalized).tag(kind)
                }
            }
            TextField("Name (optional)", text: $name)
            TextField("Task (optional)", text: $task)
            Button {
                spawn()
            } label: {
                if spawning {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Start Agent")
                        .frame(maxWidth: .infinity)
                }
            }
            .disabled(spawning || agent.isEmpty)
        }
        .navigationTitle("Add Agent")
        .alert(
            "Not Started",
            isPresented: Binding(
                get: { failure != nil },
                set: { if !$0 { failure = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
    }

    private func spawn() {
        let agentKind = agent
        let nameValue = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let taskValue = task.trimmingCharacters(in: .whitespacesAndNewlines)
        spawning = true
        Task {
            defer { spawning = false }
            let outcome = await account.performAct(
                counting: .agentAdd,
                provider: session.providerId,
                events: events,
                fallbackReason: "The agent was not started."
            ) { token in
                try await actClient.spawnAgent(
                    accessToken: token,
                    providerId: session.providerId,
                    providerSessionId: session.sessionId,
                    agent: agentKind,
                    name: nameValue.isEmpty ? nil : nameValue,
                    task: taskValue.isEmpty ? nil : taskValue
                )
            }
            switch outcome {
            case .delivered:
                await onDone()
                dismiss()
            case .refused(let reason):
                failure = reason
            case .signedOut:
                dismiss()
            }
        }
    }
}

private struct WatchProviderMark: View {
    let providerId: String

    var body: some View {
        Group {
            if providerId == VaultProviderID.conductor.rawValue {
                Image("ConductorMark")
                    .resizable()
                    .scaledToFit()
                    .scaleEffect(0.93)
                    .frame(width: 20, height: 20)
            } else {
                Text(String(providerId.prefix(1).uppercased()))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: 30, height: 30)
    }
}

/// Matches the glyph, size, and dark-appearance colors of iOS's StatusMark.
private struct WatchStatusMark: View {
    let status: String

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(color)
            .frame(width: 30, height: 30)
    }

    private var symbol: String {
        switch status {
        case "working": "circle.dashed"
        case "waiting": "exclamationmark.circle"
        case "complete": "checkmark.circle"
        case "error": "xmark.circle"
        default: "questionmark.circle"
        }
    }

    private var color: Color {
        switch status {
        case "working": Color(white: 1, opacity: 0.5)
        case "waiting": Color(red: 1, green: 0.627, blue: 0.286)
        case "complete": Color(red: 0x6F / 255, green: 0xDC / 255, blue: 0xA4 / 255)
        case "error": Color(red: 0.95, green: 0.4, blue: 0.4)
        default: Color(white: 1, opacity: 0.3)
        }
    }
}

private struct WatchConversationBubble: View {
    let message: ConversationMessage

    private var isUser: Bool {
        if case .user = message.author { true } else { false }
    }

    var body: some View {
        MarkdownMessageView(message.text)
            .foregroundStyle(isUser ? Color.white : Color.primary)
            .multilineTextAlignment(.leading)
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

private struct WatchOutgoingMessage: Identifiable, Equatable {
    enum Delivery: Equatable {
        case sending
        case sent
        case failed(reason: String)
    }

    let id = UUID().uuidString
    let text: String
    let sentAt = Date()
    var delivery: Delivery
}

private struct WatchOutgoingBubble: View {
    let message: WatchOutgoingMessage

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            MarkdownMessageView(message.text)
                .foregroundStyle(.white)
                .multilineTextAlignment(.leading)
                .padding(.horizontal, 9)
                .padding(.vertical, 7)
                .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 12))
                .opacity(message.delivery == .sending ? 0.55 : 1)
            if case .failed(let reason) = message.delivery {
                Text("Not Delivered — \(reason)")
                    .font(.caption2)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.trailing)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

// MARK: - Helpers

private extension RosterSession {
    static let placeholder = RosterSession(
        providerId: "placeholder",
        sessionId: "placeholder",
        title: "Session name placeholder",
        status: "working",
        branch: "feat/some-branch"
    )
}
