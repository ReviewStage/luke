import Foundation

/// Renders where a spoken creation ask may land, the way the desktop's
/// `workspaceProjectContextText` in `@sidecar/brain` does: each project
/// with the identity a tool call names it by, what it takes, and the agent
/// choices its provider's creation endpoint documents. The list is what a
/// creation ask is validated against on the phone, so an empty one is said in
/// words too — a conversation told nothing would otherwise be free to imagine
/// somewhere.
///
/// The defaults are this device's own last choices, the same ones the New
/// Workspace sheet preselects: a tie-break that settles an ask naming no
/// provider or no project, never a widening of where one can land.
public enum WorkspaceProjectsContext {
    /// How many projects one context item may offer creation in.
    public static let maximumProjects = 10

    /// Named like the desktop's item so the model reads both under one label.
    public static let contextItemId = "luke_ctx_workspace-projects_0"
    public static let contextLabel = "workspace projects, sent automatically"

    /// The conversation item the list travels as, labelled as data the way
    /// every observed value the conversation sees is.
    public static func item(
        answer: ProjectsAnswer,
        defaultProviderId: String?,
        defaultProjectIds: [String: String],
        defaultAgentDefaults: [String: WorkspaceAgentDefault] = [:]
    ) -> VoiceContextItem {
        VoiceContextItem(
            itemId: contextItemId,
            text: "[\(contextLabel)]\n"
                + text(
                    answer: answer, defaultProviderId: defaultProviderId,
                    defaultProjectIds: defaultProjectIds,
                    defaultAgentDefaults: defaultAgentDefaults)
        )
    }

    public static func text(
        answer: ProjectsAnswer,
        defaultProviderId: String?,
        defaultProjectIds: [String: String],
        defaultAgentDefaults: [String: WorkspaceAgentDefault] = [:]
    ) -> String {
        let projects = answer.projects
        if projects.isEmpty { return "No provider currently offers workspace creation." }
        let listed = listedProjects(projects, defaultProjectIds: defaultProjectIds)
        let chosenDefault = projects.first { $0.providerId == defaultProviderId }

        var lines = ["Projects a new workspace can be created in:"]
        for project in listed {
            var line =
                "- \(VaultProviderID.displayLabel(forWireId: project.providerId)) — \(project.repository)"
            if let target = project.targetName { line += " on \(target)" }
            line += " [provider_id=\(project.providerId) project_id=\(project.providerProjectId)]"
            line += "; \(taskSupportText(project.taskSupport))"
            if project.namesItself { line += "; names its own workspaces" }
            if defaultProjectIds[project.providerId] == project.providerProjectId {
                line += "; the provider's default project"
            }
            lines.append(line)
        }
        for providerId in answer.providerIds {
            let options = answer.agentModels.filter { $0.providerId == providerId }
            guard !options.isEmpty else { continue }
            let agents = options.map { option in
                let models = option.models.isEmpty
                    ? "no model choice"
                    : "models \(option.models.map { "\($0.label) (\($0.id))" }.joined(separator: ", "))"
                let efforts =
                    option.efforts.isEmpty
                    ? "" : "; efforts \(option.efforts.joined(separator: ", "))"
                return "\(option.agent) — \(models)\(efforts)"
            }
            let stored = validAgentDefault(defaultAgentDefaults[providerId], in: options).map {
                defaultAgentText($0, in: options)
            }
            let omitted =
                stored.map { "Omitted, the saved default agent selection starts: \($0)." }
                ?? "Omitted, the provider's own default agent starts."
            lines.append(
                "\(VaultProviderID.displayLabel(forWireId: providerId)) agents a new workspace can start, "
                    + "each with its model choices: \(agents.joined(separator: " | ")). \(omitted)"
            )
        }
        if let chosenDefault {
            lines.append(
                "An ask that names no provider creates in "
                    + "\(VaultProviderID.displayLabel(forWireId: chosenDefault.providerId)) "
                    + "[provider_id=\(chosenDefault.providerId)]; do not ask which provider unless the ask "
                    + "names a different one."
            )
        } else if defaultProviderId != nil {
            lines.append(
                "The chosen default provider is not currently offering; ask which project when more than "
                    + "one could take the ask."
            )
        } else {
            lines.append(
                "No default provider is chosen yet; ask which project when more than one could take the "
                    + "ask, and the first workspace created saves its provider as the default."
            )
        }
        return lines.joined(separator: "\n")
    }

    /// The bounded slice the conversation is shown, kept default-aware: a
    /// chosen default project past the cap rides past the cut, or the one
    /// project a nameless ask should land in would be unlisted.
    static func listedProjects(
        _ projects: [RosterProject],
        defaultProjectIds: [String: String]
    ) -> [RosterProject] {
        var listed = Array(projects.prefix(maximumProjects))
        for project in projects.dropFirst(maximumProjects)
        where defaultProjectIds[project.providerId] == project.providerProjectId {
            listed.append(project)
        }
        return listed
    }

    /// How each support level reads, said beside the identity so the ask and
    /// its validation share one vocabulary.
    static func taskSupportText(_ support: ProjectTaskSupport) -> String {
        switch support {
        case .none: "takes no task"
        case .optional: "takes an opening task"
        case .required: "needs an opening task"
        }
    }

    static func validAgentDefault(
        _ stored: WorkspaceAgentDefault?,
        in options: [WorkspaceAgentOption]
    ) -> WorkspaceAgentDefault? {
        guard let stored,
            let option = options.first(where: { $0.agent == stored.agent })
        else { return nil }
        if let model = stored.model {
            guard option.models.contains(where: { $0.id == model }) else { return nil }
        } else {
            guard option.models.isEmpty, stored.effort == nil else { return nil }
        }
        if let effort = stored.effort, !option.efforts.contains(effort) { return nil }
        return stored
    }

    private static func defaultAgentText(
        _ stored: WorkspaceAgentDefault,
        in options: [WorkspaceAgentOption]
    ) -> String {
        guard let storedModel = stored.model else { return stored.agent }
        let option = options.first { $0.agent == stored.agent }
        let model = option?.models.first { $0.id == storedModel }
        let modelText = model.map { "\($0.label) (\($0.id))" } ?? storedModel
        let effortText = stored.effort.map { ", effort \($0)" } ?? ""
        return "\(stored.agent) with \(modelText)\(effortText)"
    }
}
