import LukeKit
import SwiftUI

/// Shows the signed-in user's active cloud sessions with pull-to-refresh.
struct SessionsView: View {
    @Environment(AccountSession.self) private var session

    @State private var sessions: [RosterSession] = []
    @State private var isLoading = false
    @State private var fetchError: String?

    private let client = RosterClient(serviceURL: AccountConstants.serviceURL)

    var body: some View {
        Group {
            if isLoading && sessions.isEmpty {
                loadingState
            } else if sessions.isEmpty {
                emptyState
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(sessions) { s in
                            SessionRow(session: s)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
            }
        }
        .background(Color(red: 0.07, green: 0.07, blue: 0.08).ignoresSafeArea())
        .navigationTitle("Sessions")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color(red: 0.07, green: 0.07, blue: 0.08), for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .refreshable { await refreshSessions() }
        .task { await refreshSessions() }
    }

    private var loadingState: some View {
        VStack(spacing: 12) {
            ForEach(0 ..< 3, id: \.self) { _ in
                SkeletonRow()
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            if let error = fetchError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(Color(red: 0.95, green: 0.4, blue: 0.4))
                    .multilineTextAlignment(.center)
            } else {
                Text("No active sessions")
                    .font(.subheadline)
                    .foregroundStyle(Color(white: 1, opacity: 0.5))
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
        HStack(alignment: .center, spacing: 12) {
            RosterProviderMark(providerId: session.providerId)
            VStack(alignment: .leading, spacing: 3) {
                Text(session.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                DoingLine(session: session)
                if let workspace = session.workspace {
                    PlaceLine(workspace: workspace, branch: session.branch)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(Color(white: 1, opacity: 0.028))
        .overlay(
            RoundedRectangle(cornerRadius: 15)
                .strokeBorder(
                    session.status == "waiting"
                        ? Color(red: 0.9, green: 0.65, blue: 0.2, opacity: 0.35)
                        : Color(white: 1, opacity: 0.08),
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
                .fill(Color(white: 1, opacity: 0.06))
                .frame(width: 30, height: 30)
            if let provider = VaultProviderID(rawValue: providerId) {
                ProviderMark(provider: provider)
                    .frame(width: 20, height: 20)
            } else {
                Text(String(providerId.prefix(1).uppercased()))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color(white: 1, opacity: 0.5))
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
                .stroke(Color(white: 1, opacity: 0.6), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
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
                .foregroundStyle(Color(red: 0.35, green: 0.85, blue: 0.55).opacity(0.85))
                .frame(width: 10, height: 10)
        case "waiting":
            Image(systemName: "checkmark")
                .font(.system(size: 8, weight: .semibold))
                .foregroundStyle(Color(red: 1.0, green: 0.75, blue: 0.2).opacity(0.85))
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
                .foregroundStyle(Color(red: 0.95, green: 0.4, blue: 0.4))
                .lineLimit(2)
        } else if let recap = session.recap {
            Text(recap)
                .font(.system(size: 11))
                .foregroundStyle(
                    session.status == "waiting"
                        ? Color(red: 0.9, green: 0.65, blue: 0.2)
                        : Color(white: 1, opacity: 0.55)
                )
                .lineLimit(2)
        } else {
            Text(session.status)
                .font(.system(size: 11))
                .foregroundStyle(Color(white: 1, opacity: 0.35))
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
                    .foregroundStyle(Color(white: 1, opacity: 0.25))
                Text(branch)
                    .lineLimit(1)
            }
        }
        .font(.system(size: 10, design: .monospaced))
        .foregroundStyle(Color(white: 1, opacity: 0.35))
    }
}

// MARK: - Skeleton row

/// Three pulsing placeholder cards while the first fetch is in flight.
private struct SkeletonRow: View {
    @State private var opacity: Double = 0.55

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            RoundedRectangle(cornerRadius: 7)
                .fill(Color(white: 1, opacity: 0.1))
                .frame(width: 30, height: 30)
            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(white: 1, opacity: 0.1))
                    .frame(height: 12)
                    .frame(maxWidth: 160)
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(white: 1, opacity: 0.07))
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
