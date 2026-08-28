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
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if sessions.isEmpty {
                emptyState
            } else {
                List(sessions) { s in
                    SessionRow(session: s)
                        .listRowBackground(Color(red: 0.12, green: 0.12, blue: 0.13))
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
        .background(Color(red: 0.09, green: 0.09, blue: 0.10).ignoresSafeArea())
        .refreshable { await refreshSessions() }
        .task { await refreshSessions() }
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
        } catch {
            fetchError = error.localizedDescription
        }
    }
}

// MARK: - Session row

private struct SessionRow: View {
    let session: RosterSession

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(session.title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color.white)
                    .lineLimit(1)
                Spacer()
                StatusBadge(status: session.status)
            }
            if let workspace = session.workspace {
                Text(workspace)
                    .font(.caption)
                    .foregroundStyle(Color(white: 1, opacity: 0.45))
            }
            if let recap = session.recap {
                Text(recap)
                    .font(.caption)
                    .foregroundStyle(Color(white: 1, opacity: 0.55))
                    .lineLimit(2)
            }
            if let error = session.error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(Color(red: 0.95, green: 0.4, blue: 0.4))
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 6)
    }
}

// MARK: - Status badge

private struct StatusBadge: View {
    let status: String

    private var color: Color {
        switch status {
        case "working": Color(red: 0.35, green: 0.65, blue: 1.0)
        case "waiting": Color(red: 1.0, green: 0.75, blue: 0.2)
        case "error": Color(red: 0.95, green: 0.4, blue: 0.4)
        case "complete": Color(red: 0.35, green: 0.85, blue: 0.55)
        default: Color(white: 1, opacity: 0.4)
        }
    }

    var body: some View {
        Text(status)
            .font(.system(size: 10, weight: .medium))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }
}
