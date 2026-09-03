import LukeKit
import SwiftUI
import UIKit

/// Shows the signed-in user's active cloud sessions with pull-to-refresh.
/// The roster, the narrowing, and the stack above the list live in the
/// shared store, because the voice screen can be asked for the same presses.
struct SessionsView: View {
    @Environment(AccountSession.self) private var session
    @Environment(ProductEventSender.self) private var events
    @Environment(SessionsStore.self) private var store

    @State private var optionsShown = false
    /// Sent bubbles per session, in memory alone for the app run — the
    /// developer's own words, never written to disk, surviving push and pop
    /// so a chat reopened mid-run still shows what was just sent.
    @State private var threads: [String: [OutgoingMessage]] = [:]
    @State private var spawningSession: RosterSession?
    @State private var renaming: RenameTarget?
    @State private var renameText = ""
    @State private var creatorShown = false
    @State private var actFailure: String?

    /// Which advertised rename a menu press opened: the session itself, or
    /// the workspace it runs in. One alert serves both; the flag picks the
    /// words, the count, and the endpoint.
    private struct RenameTarget: Identifiable {
        let session: RosterSession
        let isWorkspace: Bool

        var id: String { session.id }
        var title: String { isWorkspace ? "Rename Workspace" : "Rename Session" }
        var act: ProductSessionAct { isWorkspace ? .workspaceRename : .sessionRename }
    }

    private let actClient = ActClient(baseURL: AccountConstants.serviceURL)
    private let projectsClient = ProjectsClient(serviceURL: AccountConstants.serviceURL)
    private let conversationClient = ConversationClient(serviceURL: AccountConstants.serviceURL)

    var body: some View {
        Group {
            if #available(iOS 26.0, *) {
                // Minimized, the search is the magnifier button in the bar until
                // pressed; earlier systems keep the field the bar draws for a
                // searchable list.
                searchableList.searchToolbarBehavior(.minimize)
            } else {
                searchableList
            }
        }
        .navigationDestination(for: SessionsRoute.self) { route in
            switch route {
            case .voice:
                VoiceView()
            case .session(let opened):
                // The freshest observation of the opened session wins, so a
                // refresh behind the screen updates the words it draws; a
                // session the refresh no longer reports keeps its last
                // observed word.
                let current = store.sessions.first { $0.id == opened.id } ?? opened
                SessionDetailView(
                    session: current,
                    actClient: actClient,
                    conversationClient: conversationClient,
                    thread: Binding(
                        get: { threads[opened.id] ?? [] },
                        set: { threads[opened.id] = $0 }
                    ),
                    onDelivered: { await refreshSessions() },
                    sessionActions: { viewDetails in
                        AnyView(
                            rowMenu(
                                current,
                                viewDetails: viewDetails,
                                sendMessage: nil
                            )
                        )
                    }
                )
            }
        }
        .sheet(item: $spawningSession) { s in
            AgentSpawnerSheet(session: s, actClient: actClient) {
                spawningSession = nil
                Task { await refreshSessions() }
            }
        }
        .sheet(isPresented: $creatorShown) {
            WorkspaceCreatorSheet(actClient: actClient, projectsClient: projectsClient) {
                creatorShown = false
                Task { await refreshSessions() }
            }
        }
        .alert(
            renaming?.title ?? "",
            isPresented: Binding(presence: $renaming),
            presenting: renaming
        ) { target in
            TextField("Name", text: $renameText)
            Button("Rename") {
                let name = renameText
                Task {
                    await performAct(on: target.session, counting: target.act) { token in
                        let rename =
                            target.isWorkspace
                            ? actClient.renameWorkspace : actClient.renameSession
                        return try await rename(
                            token, target.session.providerId, target.session.sessionId, name)
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .failureAlert("Not Delivered", reason: $actFailure)
    }

    /// The rows the query leaves: matched with the desktop's own search
    /// semantics, and everything when the query is blank.
    private var searchMatchedSessions: [RosterSession] {
        let tokens = SessionSearch.tokens(from: store.searchQuery)
        if tokens.isEmpty { return store.sessions }
        return store.sessions.filter { SessionSearch.matches($0, tokens: tokens) }
    }

    private var searchableList: some View {
        @Bindable var store = store
        // Matched once per build: the empty check, the visible rows, and the
        // filtered-out count all read the same pass instead of re-running the
        // tokenized scan.
        let matched = searchMatchedSessions
        let visible = sortedSessions(
            matched.filter { matchesFilterSelection(store.filters, session: $0) },
            by: store.sort
        )
        return List {
            if store.awaitingFirstRoster && store.sessions.isEmpty && store.fetchError == nil {
                ForEach(0 ..< 3, id: \.self) { _ in
                    SkeletonRow()
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(rowInsets)
                }
            } else if store.sessions.isEmpty {
                emptyRow
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } else if matched.isEmpty {
                ContentUnavailableView.search(text: store.searchQuery)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } else if visible.isEmpty {
                filteredOutRow(hiddenCount: matched.count)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } else {
                ForEach(visible) { s in
                    sessionItem(s)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(rowInsets)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color.ground.ignoresSafeArea())
        .searchable(text: $store.searchQuery, isPresented: $store.searchPresented, prompt: "Search sessions")
        .toolbar {
            // Search and list options flank the primary voice action. Keeping
            // all three in the system bar gives each control native Liquid
            // Glass while Luke remains centered and easy to reach.
            if #available(iOS 26.0, *) {
                DefaultToolbarItem(kind: .search, placement: .bottomBar)
                ToolbarSpacer(.flexible, placement: .bottomBar)
                ToolbarItem(placement: .bottomBar) {
                    voiceButton
                }
                ToolbarSpacer(.flexible, placement: .bottomBar)
                ToolbarItem(placement: .bottomBar) {
                    optionsButton
                }
            } else {
                ToolbarItem(placement: .topBarTrailing) {
                    voiceButton
                }
                ToolbarItem(placement: .topBarTrailing) {
                    optionsButton
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                newWorkspaceButton
            }
        }
        .sheet(isPresented: $optionsShown) {
            SessionOptionsSheet(sessions: store.sessions, filters: $store.filters, sort: $store.sort)
                .presentationDetents([.medium, .large])
        }
        .refreshable { await refreshSessions() }
        .task { await refreshSessions() }
    }

    private var optionsButton: some View {
        Button {
            optionsShown = true
        } label: {
            Label("Filter & Sort", systemImage: "line.3.horizontal.decrease")
                .symbolVariant(store.filters.isEmpty ? .none : .circle.fill)
        }
        .tint(Color.ink)
    }

    @ViewBuilder
    private var voiceButton: some View {
        if #available(iOS 26.0, *) {
            NavigationLink(value: SessionsRoute.voice) {
                LukeMark()
                    .foregroundStyle(Color.ink)
                    .frame(width: 22, height: 20)
            }
            .accessibilityLabel("Talk to Luke")
        } else {
            NavigationLink(value: SessionsRoute.voice) {
                LukeMark()
                    .foregroundStyle(Color.ink)
                    .frame(width: 22, height: 20)
            }
            .accessibilityLabel("Talk to Luke")
        }
    }

    private var newWorkspaceButton: some View {
        Button {
            creatorShown = true
        } label: {
            Label("New Workspace", systemImage: "plus")
        }
        .tint(Color.ink)
    }

    private func filteredOutRow(hiddenCount: Int) -> some View {
        ContentUnavailableView {
            Label("No matching sessions", systemImage: "line.3.horizontal.decrease")
        } description: {
            Text("Filters hide ^[\(hiddenCount) sessions](inflect: true).")
        } actions: {
            Button("Clear Filters") { store.filters.removeAll() }
                .tint(Color.ink)
        }
        .padding(.top, 40)
    }

    private let rowInsets = EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16)

    /// Whether the row offers anything beyond what it draws. Every offer here
    /// is one the session's latest observation advertised — the row invents
    /// no fallback for a provider that advertised nothing.
    private func hasRowActs(_ s: RosterSession) -> Bool {
        s.canReceiveMessage || !s.controls.isEmpty || !s.spawnableAgents.isEmpty || s.canRename
            || s.canRenameWorkspace
    }

    @ViewBuilder
    private func sessionItem(_ s: RosterSession) -> some View {
        // The preview the long-press lifts must be the card's own rounded
        // shape, or the system snapshots the row's full rectangle and the
        // lift reads as a foreign overlay instead of the card rising.
        let core = rowCore(s)
            .contentShape(
                [.interaction, .contextMenuPreview], RoundedRectangle(cornerRadius: 15))
        Group {
            if hasRowActs(s) {
                core.contextMenu {
                    rowMenu(s, viewDetails: nil, sendMessage: { store.open(s) })
                } preview: {
                    SessionRowPreview(session: s)
                }
            } else {
                core
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            if let archive = archiveControl(s) {
                Button {
                    runControl(s, archive)
                } label: {
                    Label(archive.label, systemImage: "archivebox")
                }
                .tint(.indigo)
            }
        }
    }

    @ViewBuilder
    private func rowCore(_ s: RosterSession) -> some View {
        // Every row opens the session's own screen; whether that screen takes
        // a message is the observation's word, said there rather than by
        // making some rows dead to the touch.
        Button { store.open(s) } label: {
            SessionRow(session: s)
        }
        .buttonStyle(.plain)
    }

    /// The menu reads in the system's own order: what the session takes now,
    /// then the edits that open further UI, then the acts that end something
    /// — a stop wearing the destructive role, the archive closing the menu
    /// the way Mail's does. Every entry is still only an advertised act, and
    /// each section holds only the kinds the adapters themselves declared.
    @ViewBuilder
    private func rowMenu(
        _ s: RosterSession,
        viewDetails: (() -> Void)?,
        sendMessage: (() -> Void)?
    ) -> some View {
        Section {
            if let viewDetails {
                Button(action: viewDetails) {
                    Label("View Details", systemImage: "info.circle")
                }
            }
            if s.canReceiveMessage, let sendMessage {
                Button(action: sendMessage) {
                    Label("Send Message…", systemImage: "arrow.up.message")
                }
            }
            ForEach(s.controls.filter { $0.kind != .stop && $0.kind != .archive }) { control in
                Button {
                    runControl(s, control)
                } label: {
                    Label(control.label, systemImage: controlSymbol(control))
                }
            }
            if !s.spawnableAgents.isEmpty {
                Button {
                    spawningSession = s
                } label: {
                    Label("Add Agent…", systemImage: "plus.bubble")
                }
            }
        }
        Section {
            if s.canRename {
                Button {
                    renameText = s.title
                    renaming = RenameTarget(session: s, isWorkspace: false)
                } label: {
                    Label("Rename Session…", systemImage: "pencil")
                }
            }
            if s.canRenameWorkspace {
                Button {
                    renameText = s.workspace ?? ""
                    renaming = RenameTarget(session: s, isWorkspace: true)
                } label: {
                    Label("Rename Workspace…", systemImage: "pencil.line")
                }
            }
        }
        Section {
            ForEach(s.controls.filter { $0.kind == .stop }) { control in
                Button(role: .destructive) {
                    runControl(s, control)
                } label: {
                    Label(control.label, systemImage: controlSymbol(control))
                }
            }
            ForEach(s.controls.filter { $0.kind == .archive }) { control in
                Button {
                    runControl(s, control)
                } label: {
                    Label(control.label, systemImage: controlSymbol(control))
                }
            }
        }
    }

    private func archiveControl(_ s: RosterSession) -> RosterSessionControl? {
        s.controls.first { $0.kind == .archive }
    }

    private func runControl(_ s: RosterSession, _ control: RosterSessionControl) {
        // An archive's whole visible outcome is the row leaving, so the leave
        // happens at the press — the row slides out and the screen it opened
        // pops — with the act following behind rather than the press waiting
        // on two round trips.
        if control.kind == .archive { store.beginArchiving(s) }
        Task {
            let delivered = await performAct(on: s, counting: .controlRun) { token in
                try await actClient.executeControl(
                    accessToken: token,
                    providerId: s.providerId,
                    providerSessionId: s.sessionId,
                    controlId: control.id
                )
            }
            if control.kind == .archive {
                store.endArchiving(s, delivered: delivered)
                if !delivered { await refreshSessions() }
            }
        }
    }

    /// A glyph for a control by its declared kind alone. An id or a label is
    /// the provider's own words, and words are not a contract to draw from.
    private func controlSymbol(_ control: RosterSessionControl) -> String {
        switch control.kind {
        case .stop: "stop.circle"
        case .archive: "archivebox"
        case .action, nil: "circle"
        }
    }

    /// Runs one row act through the shared runner, then refreshes so the
    /// roster reflects what the act changed; a refusal is surfaced in the
    /// failure alert with the server's own reason.
    @discardableResult
    private func performAct(
        on s: RosterSession,
        counting act: ProductSessionAct,
        _ call: (String) async throws -> ActMessageAnswer
    ) async -> Bool {
        let outcome = await session.performAct(
            counting: act,
            provider: s.providerId,
            events: events,
            fallbackReason: "The act was not delivered.",
            call
        )
        switch outcome {
        case .delivered:
            await refreshSessions()
            return true
        case .refused(let reason):
            actFailure = reason
            return false
        case .signedOut:
            return false  // The state change redraws automatically.
        }
    }

    @ViewBuilder
    private var emptyRow: some View {
        Group {
            if let error = store.fetchError {
                ContentUnavailableView {
                    Label("Couldn't Load Sessions", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Try Again") {
                        Task { await refreshSessions() }
                    }
                    .tint(Color.ink)
                }
            } else {
                ContentUnavailableView {
                    Label("No Active Sessions", systemImage: "tray")
                } description: {
                    Text("Sessions from providers with stored keys appear here.")
                }
            }
        }
        .padding(.top, 40)
    }

    private func refreshSessions() async {
        await store.refresh(account: session, events: events)
    }
}

// MARK: - Options sheet

private func axisTitle(_ axis: SessionFilterAxis) -> String {
    switch axis {
    case .provider: "Provider"
    case .status: "Status"
    }
}

private func optionTitle(_ filter: SessionFilter) -> String {
    switch filter {
    case .provider(let providerId):
        VaultProviderID.displayLabel(forWireId: providerId)
    case .status(let status):
        status.capitalized
    }
}

/// The half sheet the search bar's filter button opens, in the system's own
/// grouped-sheet vocabulary (the profile sheet's): the sort as a checkmark
/// list, one drill-in page per filter axis with the selection named on its
/// row, and a clear action only while something is selected. The list behind
/// stays visible above the medium detent, so every choice shows its effect
/// as it is made. The accent stays the checkmarks' alone — every other
/// control here wears the panel's own ink.
private struct SessionOptionsSheet: View {
    let sessions: [RosterSession]
    @Binding var filters: Set<SessionFilter>
    @Binding var sort: SessionSort
    @Environment(\.dismiss) private var dismiss

    private var groups: [SessionFilterAxisOptions] {
        sessionFilterOptions(sessions: sessions, selection: filters)
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Sort by") {
                    sortRow(.urgency, label: "Urgent")
                    sortRow(.recency, label: "Recent")
                }
                if !groups.isEmpty {
                    Section("Filter by") {
                        ForEach(groups) { group in
                            NavigationLink {
                                AxisFilterPage(group: group, filters: $filters)
                            } label: {
                                LabeledContent(axisTitle(group.axis), value: selectionSummary(for: group))
                            }
                        }
                    }
                }
                if !filters.isEmpty {
                    Section {
                        Button("Clear Filters") { filters.removeAll() }
                            .frame(maxWidth: .infinity)
                            .tint(Color.ink)
                    }
                }
            }
            .navigationTitle("Filter & Sort")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .tint(Color.ink)
                }
            }
        }
    }

    private func sortRow(_ value: SessionSort, label: String) -> some View {
        Button {
            sort = value
        } label: {
            HStack {
                Text(label)
                    .foregroundStyle(Color.ink)
                Spacer()
                Image(systemName: "checkmark")
                    .fontWeight(.semibold)
                    .opacity(sort == value ? 1 : 0)
            }
        }
        .accessibilityAddTraits(sort == value ? .isSelected : [])
    }

    private func selectionSummary(for group: SessionFilterAxisOptions) -> String {
        let chosen = group.options
            .filter { filters.contains($0.filter) }
            .map { optionTitle($0.filter) }
        return chosen.isEmpty ? "All" : chosen.joined(separator: ", ")
    }
}

/// One axis's checklist page: every observed value with its session count,
/// toggled by row press. The checkmark keeps its slot when unchosen so rows
/// do not shift underfoot.
private struct AxisFilterPage: View {
    let group: SessionFilterAxisOptions
    @Binding var filters: Set<SessionFilter>

    var body: some View {
        List {
            ForEach(group.options) { option in
                Button {
                    if filters.contains(option.filter) {
                        filters.remove(option.filter)
                    } else {
                        filters.insert(option.filter)
                    }
                } label: {
                    HStack(spacing: 12) {
                        optionMark(option.filter)
                        Text(optionTitle(option.filter))
                            .foregroundStyle(Color.ink)
                        Spacer()
                        // .secondary here would resolve against the button's
                        // tint and read blue; the count wears the panel's own
                        // secondary ink instead.
                        Text(option.count, format: .number)
                            .foregroundStyle(Color.inkSecondary)
                        Image(systemName: "checkmark")
                            .fontWeight(.semibold)
                            .opacity(filters.contains(option.filter) ? 1 : 0)
                    }
                }
                .accessibilityAddTraits(filters.contains(option.filter) ? .isSelected : [])
            }
        }
        .navigationTitle(axisTitle(group.axis))
        .navigationBarTitleDisplayMode(.inline)
    }

    /// A provider row wears the same brand mark its sessions wear; a status
    /// row a glyph in the same 30pt slot, so the two pages read as one.
    @ViewBuilder
    private func optionMark(_ filter: SessionFilter) -> some View {
        switch filter {
        case .provider(let providerId):
            RosterProviderMark(providerId: providerId)
        case .status(let status):
            StatusMark(status: status)
        }
    }
}

/// A status's own glyph in the row-mark's slot, colored the way the session
/// rows already speak that status: waiting's orange, complete's green, an
/// error's red, and the neutral inks for working and anything unknown.
struct StatusMark: View {
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
        case "working": Color.inkSecondary
        case "waiting": Color(red: 1.0, green: 0.627, blue: 0.286)
        case "complete": Color.stateComplete
        case "error": Color.errorInk
        default: Color.inkTertiary
        }
    }
}

/// Opaque on purpose: the context-menu lift snapshots the card alone, and a
/// translucent fill reads as a ghost over the system's blur instead of a cell
/// rising. Compositing the overlay onto the ground it always sits on looks
/// identical in the list and solid in the lift.
private var rowCardFill: some View {
    ZStack {
        Color.ground
        Color(white: 1, opacity: 0.028)
    }
}

// MARK: - Row preview

/// The card the long-press lifts in place of the row's own snapshot: the same
/// mark and title, the place line, and the session's failure given the room
/// the row cannot spare — the full error instead of two truncated lines.
/// Everything here is already drawn on the row itself; the preview only lets
/// it breathe.
private struct SessionRowPreview: View {
    let session: RosterSession

    /// UIKit sizes a custom preview to the view's own ideal size, and when
    /// that ideal (plus the menu) outgrows the space beside it, the system
    /// clips the platter — the title first. So the card takes iMessage's
    /// posture instead: a fixed envelope proportional to the screen, most of
    /// its width and a generous share of its height, inside which the words
    /// truncate. The envelope is always whole; only the text ever gives.
    private var envelope: CGSize {
        let screen = UIScreen.main.bounds.size
        return CGSize(width: min(screen.width - 40, 420), height: screen.height * 0.42)
    }

    var body: some View {
        let size = envelope
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 10) {
                RosterProviderMark(providerId: session.providerId)
                VStack(alignment: .leading, spacing: 3) {
                    Text(session.title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.ink)
                        .lineLimit(2)
                    if let workspace = session.workspace {
                        PlaceLine(workspace: workspace, branch: session.branch)
                    }
                }
            }
            if let error = session.error {
                // Bounded in lines as well as by the envelope, so an error
                // that outgrows the card ends on an ellipsis rather than a
                // clipped line.
                Text(error)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.errorInk)
                    .lineSpacing(3)
                    .lineLimit(14)
            } else {
                Text(session.status.capitalized)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.inkTertiary)
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .background(rowCardFill)
    }
}

// MARK: - Session row

private struct SessionRow: View {
    let session: RosterSession

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RosterProviderMark(providerId: session.providerId)
            VStack(alignment: .leading, spacing: 3) {
                Text(session.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.ink)
                    .lineLimit(1)
                DoingLine(session: session)
                if let workspace = session.workspace {
                    PlaceLine(workspace: workspace, branch: session.branch)
                }
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 4) {
                if let date = session.lastActivityAt {
                    // The 30-second cadence is the desktop rows' own freshness tick:
                    // without it a minute-granularity label stales until something
                    // else happens to re-render the list.
                    TimelineView(.periodic(from: .distantPast, by: 30)) { context in
                        Text(lastActivityLabel(lastActivityAt: date, now: context.date))
                    }
                    .font(.system(size: 10))
                    .foregroundStyle(Color.inkTertiary)
                }
            }
            .padding(.top, 2)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(rowCardFill)
        .overlay(
            RoundedRectangle(cornerRadius: 15)
                .strokeBorder(
                    session.status == "waiting"
                        ? Color(red: 1.0, green: 0.627, blue: 0.286, opacity: 0.3)
                        : Color.cardStroke,
                    lineWidth: 1
                )
        )
        .clipShape(RoundedRectangle(cornerRadius: 15))
    }
}

// MARK: - Provider mark

/// Wraps the app's real ProviderMark (SVG brand art) inside the fixed 30pt slot
/// the desktop's row-mark uses. Falls back to a colored initial for provider IDs
/// not covered by VaultProviderID. Shared with the session detail screen,
/// whose title bar wears the same mark the row does.
struct RosterProviderMark: View {
    let providerId: String

    var body: some View {
        Group {
            if let provider = VaultProviderID(rawValue: providerId) {
                ProviderMark(provider: provider)
                    .frame(width: 20, height: 20)
            } else {
                Text(String(providerId.prefix(1).uppercased()))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.inkSecondary)
            }
        }
        .frame(width: 30, height: 30)
    }
}

// MARK: - Doing line

/// The status sentence: spinner or check prefix, then the error or the status word.
private struct DoingLine: View {
    let session: RosterSession

    @State private var spinnerRotation: Double = 0

    var body: some View {
        HStack(alignment: .center, spacing: 6) {
            statusGlyph
            doingText
        }
    }

    @ViewBuilder
    private var statusGlyph: some View {
        switch session.status {
        case "working":
            Circle()
                .trim(from: 0.15, to: 0.9)
                .stroke(Color.inkSecondary, style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                .frame(width: 10, height: 10)
                .rotationEffect(.degrees(spinnerRotation))
                .onAppear {
                    withAnimation(.linear(duration: 0.9).repeatForever(autoreverses: false)) {
                        spinnerRotation = 360
                    }
                }
        case "complete":
            Image(systemName: "checkmark")
                .font(.system(size: 8, weight: .semibold))
                .foregroundStyle(Color.stateComplete.opacity(0.85))
                .frame(width: 10, height: 10)
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    private var doingText: some View {
        if let error = session.error {
            Text(error)
                .font(.system(size: 11))
                .foregroundStyle(Color.errorInk)
                .lineLimit(2)
        } else {
            Text(session.status)
                .font(.system(size: 11))
                .foregroundStyle(Color.inkTertiary)
                .lineLimit(1)
        }
    }
}

// MARK: - Place line

/// Workspace and branch in monospaced tertiary text — matches the desktop's row-place.
private struct PlaceLine: View {
    let workspace: String
    let branch: String?

    var body: some View {
        HStack(spacing: 4) {
            Text(workspace)
                .lineLimit(1)
            if let branch {
                Text("·")
                    .foregroundStyle(Color.inkTertiary.opacity(0.7))
                Text(branch)
                    .lineLimit(1)
            }
        }
        .font(.system(size: 10, design: .monospaced))
        .foregroundStyle(Color.inkTertiary)
    }
}

// MARK: - Skeleton row

/// Pulsing placeholder cards while the first fetch is in flight: the real
/// SessionRow rendered under `.redacted(reason: .placeholder)`, so the
/// skeleton's geometry is the row's own rather than a copy kept by hand.
private struct SkeletonRow: View {
    @State private var opacity: Double = 0.55

    /// Synthetic content sized like a typical row. Redaction replaces every
    /// text and glyph with a block, so none of these words can draw; the
    /// status is `complete` because it is the one glyph-bearing status whose
    /// row neither animates nor tints its border.
    private static let placeholder = RosterSession(
        providerId: "placeholder",
        sessionId: "placeholder",
        title: "Placeholder session title",
        status: "complete",
        workspace: "workspace",
        branch: "branch-name",
        lastActivityAt: Date()
    )

    var body: some View {
        SessionRow(session: Self.placeholder)
            .redacted(reason: .placeholder)
            // Redaction only hides the synthetic words visually; VoiceOver
            // would still read them as three real sessions, so the row hides
            // itself the way the desktop skeleton's aria-hidden does.
            .accessibilityHidden(true)
            .opacity(opacity)
            .onAppear {
                withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true)) {
                    opacity = 1.0
                }
            }
    }
}
