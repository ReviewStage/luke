import LukeKit
import SwiftUI

/// Shows the signed-in user's active cloud sessions with pull-to-refresh.
struct SessionsView: View {
    @Environment(AccountSession.self) private var session

    @State private var sessions: [RosterSession] = []
    @State private var isLoading = false
    @State private var fetchError: String?
    @State private var searchQuery = ""
    @State private var filters: Set<SessionFilter> = []
    @State private var sort: SessionSort = .urgency
    @State private var optionsShown = false

    private let client = RosterClient(serviceURL: AccountConstants.serviceURL)

    var body: some View {
        if #available(iOS 26.0, *) {
            // Minimized, the search is the magnifier button in the bar until
            // pressed; earlier systems keep the field the bar draws for a
            // searchable list.
            searchableList.searchToolbarBehavior(.minimize)
        } else {
            searchableList
        }
    }

    /// The rows the query leaves: matched with the desktop's own search
    /// semantics, and everything when the query is blank.
    private var searchMatchedSessions: [RosterSession] {
        let tokens = SessionSearch.tokens(from: searchQuery)
        if tokens.isEmpty { return sessions }
        return sessions.filter { SessionSearch.matches($0, tokens: tokens) }
    }

    /// What the list draws: the query's rows, narrowed by the filter
    /// selection, in the order the chosen sort names.
    private var visibleSessions: [RosterSession] {
        sortedSessions(
            searchMatchedSessions.filter { matchesFilterSelection(filters, session: $0) },
            by: sort
        )
    }

    private var searchableList: some View {
        List {
            if isLoading && sessions.isEmpty {
                ForEach(0 ..< 3, id: \.self) { _ in
                    SkeletonRow()
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(rowInsets)
                }
            } else if sessions.isEmpty {
                emptyRow
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } else if searchMatchedSessions.isEmpty {
                ContentUnavailableView.search(text: searchQuery)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } else if visibleSessions.isEmpty {
                filteredOutRow
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } else {
                ForEach(visibleSessions) { s in
                    SessionRow(session: s)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(rowInsets)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color.ground.ignoresSafeArea())
        .toolbarBackground(Color.ground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .searchable(text: $searchQuery, prompt: "Search sessions")
        .toolbar {
            // The filter rides with the search the way Notion docks one in
            // its search pill: on iOS 26 the system search moves into the
            // bottom bar and the button stands beside it; earlier systems
            // keep the bar's own search presentation, so the button keeps
            // the trailing slot above it.
            if #available(iOS 26.0, *) {
                DefaultToolbarItem(kind: .search, placement: .bottomBar)
                ToolbarSpacer(.flexible, placement: .bottomBar)
                ToolbarItem(placement: .bottomBar) {
                    optionsButton
                }
            } else {
                ToolbarItem(placement: .topBarTrailing) {
                    optionsButton
                }
            }
        }
        .sheet(isPresented: $optionsShown) {
            SessionOptionsSheet(sessions: sessions, filters: $filters, sort: $sort)
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
                .symbolVariant(filters.isEmpty ? .none : .circle.fill)
        }
    }

    private var filteredOutRow: some View {
        ContentUnavailableView {
            Label("No matching sessions", systemImage: "line.3.horizontal.decrease")
        } description: {
            Text("Filters hide ^[\(searchMatchedSessions.count) sessions](inflect: true).")
        } actions: {
            Button("Clear Filters") { filters.removeAll() }
        }
        .padding(.top, 40)
    }

    private let rowInsets = EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16)

    private var emptyRow: some View {
        VStack(spacing: 8) {
            if let error = fetchError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(Color.errorInk)
                    .multilineTextAlignment(.center)
            } else {
                Text("No active sessions")
                    .font(.subheadline)
                    .foregroundStyle(Color.inkSecondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    private func refreshSessions() async {
        guard let token = session.currentAccessToken() else { return }
        isLoading = true
        fetchError = nil
        defer { isLoading = false }
        do {
            sessions = try await client.observe(bearerToken: token)
        } catch RosterClientError.serverError(let status) where status == 401 {
            // The stored token has expired or been revoked. Sign out so the user
            // is prompted to sign in again rather than stuck seeing a silent error.
            // On rebase with #570, this will become a refresh-and-retry via
            // validAccessToken() instead.
            await session.signOut()
        } catch {
            fetchError = error.localizedDescription
        }
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
        VaultProviderID(rawValue: providerId)?.displayName ?? providerId.capitalized
    case .status(let status):
        status.capitalized
    }
}

/// The half sheet the search bar's filter button opens, in the system's own
/// grouped-sheet vocabulary (the profile sheet's): the sort as a checkmark
/// list, one drill-in page per filter axis with the selection named on its
/// row, and a clear action only while something is selected. The list behind
/// stays visible above the medium detent, so every choice shows its effect
/// as it is made.
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
                    sortRow(.urgency, label: "Urgent", detail: "Most urgent first")
                    sortRow(.recency, label: "Recent", detail: "Most recently observed first")
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
                    }
                }
            }
            .navigationTitle("Filter & Sort")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func sortRow(_ value: SessionSort, label: String, detail: String) -> some View {
        Button {
            sort = value
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                        .foregroundStyle(Color.ink)
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
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
                    HStack {
                        Text(optionTitle(option.filter))
                            .foregroundStyle(Color.ink)
                        Spacer()
                        Text(option.count, format: .number)
                            .foregroundStyle(.secondary)
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
            if let date = session.observedAt {
                // The 30-second cadence is the desktop rows' own freshness tick:
                // without it a minute-granularity label stales until something
                // else happens to re-render the list.
                TimelineView(.periodic(from: .distantPast, by: 30)) { context in
                    Text(observedAgoLabel(observedAt: date, now: context.date))
                }
                .font(.system(size: 10))
                .foregroundStyle(Color.inkTertiary)
                .padding(.top, 2)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(Color(white: 1, opacity: 0.028))
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
/// not covered by VaultProviderID.
private struct RosterProviderMark: View {
    let providerId: String

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 7)
                .fill(Color.pressedFill)
                .frame(width: 30, height: 30)
            if let provider = VaultProviderID(rawValue: providerId) {
                ProviderMark(provider: provider)
                    .frame(width: 20, height: 20)
            } else {
                Text(String(providerId.prefix(1).uppercased()))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.inkSecondary)
            }
        }
    }
}

// MARK: - Doing line

/// The status sentence: spinner or check prefix, then the recap or error text.
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
        } else if let recap = session.recap {
            Text(recap)
                .font(.system(size: 11))
                .foregroundStyle(
                    session.status == "waiting"
                        ? Color(red: 1.0, green: 0.627, blue: 0.286)
                        : Color.ink.opacity(0.55)
                )
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
        recap: "Placeholder recap sized like a settled turn's parting words",
        observedAt: Date()
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
