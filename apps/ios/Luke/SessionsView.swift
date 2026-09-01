import LukeKit
import SwiftUI

/// Shows the signed-in user's active cloud sessions with pull-to-refresh.
struct SessionsView: View {
    @Environment(AccountSession.self) private var session

    @State private var sessions: [RosterSession] = []
    @State private var isLoading = false
    @State private var fetchError: String?
    @State private var searchQuery = ""

    private let client = RosterClient(serviceURL: AccountConstants.serviceURL)

    var body: some View {
        if #available(iOS 26.0, *) {
            // Minimized, the search is the magnifier button in the navigation
            // bar until pressed; earlier systems keep the field the bar draws
            // for a searchable list.
            searchableList.searchToolbarBehavior(.minimize)
        } else {
            searchableList
        }
    }

    /// The rows the query leaves: matched with the desktop's own search
    /// semantics, and everything when the query is blank.
    private var visibleSessions: [RosterSession] {
        let tokens = SessionSearch.tokens(from: searchQuery)
        if tokens.isEmpty { return sessions }
        return sessions.filter { SessionSearch.matches($0, tokens: tokens) }
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
            } else if visibleSessions.isEmpty {
                ContentUnavailableView.search(text: searchQuery)
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
        .refreshable { await refreshSessions() }
        .task { await refreshSessions() }
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
                Text(date, format: .relative(presentation: .numeric, unitsStyle: .abbreviated))
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

/// Three pulsing placeholder cards while the first fetch is in flight.
private struct SkeletonRow: View {
    @State private var opacity: Double = 0.55

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            RoundedRectangle(cornerRadius: 7)
                .fill(Color.ink.opacity(0.1))
                .frame(width: 30, height: 30)
            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.ink.opacity(0.1))
                    .frame(height: 12)
                    .frame(maxWidth: 160)
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.ink.opacity(0.07))
                    .frame(height: 10)
                    .frame(maxWidth: 220)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(Color(white: 1, opacity: 0.028))
        .overlay(
            RoundedRectangle(cornerRadius: 15)
                .strokeBorder(Color(white: 1, opacity: 0.08), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 15))
        .opacity(opacity)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true)) {
                opacity = 1.0
            }
        }
    }
}
