import Foundation

/// One tool as the settings sheet's debug section reports it: what it does,
/// and why Luke cannot be asked for it right now, or nothing when he can.
public struct VoiceToolStanding: Equatable, Sendable, Identifiable {
    public let name: String
    public let summary: String
    public let unavailableReason: String?

    public var id: String { name }
    public var isAvailable: Bool { unavailableReason == nil }

    public init(name: String, summary: String, unavailableReason: String?) {
        self.name = name
        self.summary = summary
        self.unavailableReason = unavailableReason
    }
}

/// Every tool the desktop's conversation carries, judged for this phone and
/// this moment.
public struct VoiceToolReport: Equatable, Sendable {
    public let standings: [VoiceToolStanding]
    /// Whether the service's minted list has been read off a connected call.
    /// Until it has, a tool is judged on the phone's own terms alone.
    public let mintedKnown: Bool
}

/// Judges each tool the way the acts themselves are gated: a tool the
/// service did not mint for this call is not Luke's to call; a tool the phone
/// never carries says why the phone has no surface for it; and a tool the
/// phone carries is available only while the observed roster or projects
/// answer offers something for it to act on, the same rows the validator
/// refuses against. The reasons are read from observed state and fixed
/// prose, never from anything a model said.
public enum VoiceToolAvailability {
    /// The desktop's table, in its order, so the list reads row for row.
    static let desktopTools: [(name: String, summary: String, absence: String?)] = [
        (VoiceToolName.sendSessionMessage.rawValue, "Send the developer's words to a session.", nil),
        (VoiceToolName.runSessionControl.rawValue, "Run a control a session advertises.", nil),
        (VoiceToolName.openSession.rawValue, "Open a session's own screen.", nil),
        (
            "read_session_transcript", "Read a local session's transcript aloud.",
            "The phone observes no local sessions, and a cloud conversation is read only by its own screen."
        ),
        (VoiceToolName.createWorkspace.rawValue, "Create a workspace in a reported project.", nil),
        (VoiceToolName.addWorkspaceAgent.rawValue, "Start another agent in a session's workspace.", nil),
        (VoiceToolName.renameWorkspace.rawValue, "Rename the workspace a session runs in.", nil),
        (VoiceToolName.renameSession.rawValue, "Rename a session itself.", nil),
        (
            "update_issue_state", "Move a tracked issue to another state.",
            "No issue tracker is connected on the phone."
        ),
        ("comment_on_issue", "Comment on a tracked issue.", "No issue tracker is connected on the phone."),
        ("change_app_setting", "Change a Luke setting.", "Settings are changed by hand on the phone."),
        (VoiceToolName.showPanel.rawValue, "Show the session list, narrowed, sorted, or searched.", nil),
        (
            "open_feedback_composer", "Open the feedback composer.",
            "The phone draws no feedback composer."
        ),
        (
            "run_update_action", "Press the Updates row's button.",
            "The phone updates through the App Store and draws no Updates row."
        ),
        ("remember_fact", "Save a durable fact about the developer.", "Luke's memory lives on the Mac alone."),
        ("forget_fact", "Forget a remembered fact.", "Luke's memory lives on the Mac alone."),
    ]

    public static func report(
        mintedTools: [String]?,
        sessions: [RosterSession],
        projects: ProjectsAnswer?
    ) -> VoiceToolReport {
        let minted = mintedTools.map(Set.init)
        let standings = desktopTools.map { tool in
            VoiceToolStanding(
                name: tool.name,
                summary: tool.summary,
                unavailableReason: tool.absence
                    ?? unmintedReason(tool.name, minted: minted)
                    ?? rosterReason(tool.name, sessions: sessions, projects: projects)
            )
        }
        return VoiceToolReport(standings: standings, mintedKnown: minted != nil)
    }

    private static func unmintedReason(_ name: String, minted: Set<String>?) -> String? {
        guard let minted, !minted.contains(name) else { return nil }
        return "The service did not mint this tool for the current call; it may predate this build."
    }

    /// The same gates the validator holds an ask to, read once over the roster.
    private static func rosterReason(
        _ name: String,
        sessions: [RosterSession],
        projects: ProjectsAnswer?
    ) -> String? {
        guard let tool = VoiceToolName(rawValue: name) else { return nil }
        let noSessions = "No sessions are observed."
        switch tool {
        case .sendSessionMessage:
            if sessions.isEmpty { return noSessions }
            return sessions.contains { $0.canReceiveMessage }
                ? nil : "No observed session takes messages right now."
        case .runSessionControl:
            if sessions.isEmpty { return noSessions }
            return sessions.contains { !$0.controls.isEmpty }
                ? nil : "No observed session advertises a control."
        case .openSession, .showPanel:
            return sessions.isEmpty ? noSessions : nil
        case .createWorkspace:
            guard let projects else {
                return "The projects a workspace can be created in have not loaded."
            }
            return projects.projects.isEmpty ? "No provider reported a project to create in." : nil
        case .addWorkspaceAgent:
            if sessions.isEmpty { return noSessions }
            return sessions.contains { !$0.spawnableAgents.isEmpty }
                ? nil : "No observed session lists an agent to add."
        case .renameWorkspace:
            if sessions.isEmpty { return noSessions }
            return sessions.contains { $0.canRenameWorkspace }
                ? nil : "No observed session advertises renaming its workspace."
        case .renameSession:
            if sessions.isEmpty { return noSessions }
            return sessions.contains { $0.canRename }
                ? nil : "No observed session advertises renaming."
        }
    }
}
