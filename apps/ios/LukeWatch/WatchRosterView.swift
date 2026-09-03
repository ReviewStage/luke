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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(session.statusColor)
                        .frame(width: 8, height: 8)
                    Text(session.status.capitalized)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let error = session.error {
                    Text(error)
                        .font(.caption2)
                        .foregroundStyle(.red)
                }
                if let branch = session.branch {
                    Text(branch)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .monospaced()
                        .lineLimit(2)
                }
                if let workspace = session.workspace, workspace != session.branch {
                    Text(workspace)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
        }
        .navigationTitle(session.title)
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
