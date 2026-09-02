import LukeKit
import SwiftUI

/// The New Workspace sheet, in the system's own sheet vocabulary like the
/// vault key editor: inline title, toolbar Cancel and Create, grouped form.
/// The choice runs provider first, then that provider's projects — each one a
/// project its provider itself reported on a fresh observation pass — then
/// the agent, model, and effort where the provider's creation endpoint takes
/// them, from the same build-fixed table the desktop offers. The last choices
/// are remembered on this device and preselected only while the latest answer
/// still lists them.
struct WorkspaceCreatorSheet: View {
    let actClient: ActClient
    let projectsClient: ProjectsClient
    /// Called after a successful creation so the presenter can dismiss and refresh.
    let onCreated: () -> Void

    @Environment(AccountSession.self) private var session
    @Environment(ProductEventSender.self) private var events
    @Environment(\.dismiss) private var dismiss

    private let defaults = WorkspaceCreationDefaults()

    /// nil while the first load is in flight; the loaded answer afterwards.
    @State private var answer: ProjectsAnswer?
    @State private var loadError: String?
    @State private var providerId = ""
    @State private var projectId = ""
    /// nil is the provider's own default; nothing is sent then.
    @State private var agentKind: String?
    @State private var modelId = ""
    @State private var effort: String?
    @State private var name = ""
    @State private var task = ""
    @State private var creating = false
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            Group {
                if let answer {
                    if answer.projects.isEmpty {
                        emptyState
                    } else {
                        creatorForm
                    }
                } else if let loadError {
                    errorState(loadError)
                } else {
                    ProgressView("Loading projects…")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemGroupedBackground))
            .navigationTitle("New Workspace")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(creating)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if creating {
                        ProgressView()
                    } else {
                        Button("Create") { create() }
                            .disabled(!canCreate)
                    }
                }
            }
            .task { await loadProjects() }
        }
        .interactiveDismissDisabled(creating)
        .failureAlert("Not Created", reason: $failure)
    }

    // MARK: - Form

    private var creatorForm: some View {
        Form {
            Section {
                Picker("Provider", selection: providerBinding) {
                    ForEach(providerIds, id: \.self) { id in
                        Text(VaultProviderID.displayLabel(forWireId: id)).tag(id)
                    }
                }
                Picker("Project", selection: $projectId) {
                    ForEach(providerProjects) { project in
                        Text(projectLabel(project)).tag(project.providerProjectId)
                    }
                }
            }

            if !agentOptions.isEmpty {
                Section("Agent") {
                    Picker("Agent", selection: agentBinding) {
                        Text("Provider default").tag(String?.none)
                        ForEach(agentOptions) { option in
                            Text(option.agent.capitalized).tag(String?.some(option.agent))
                        }
                    }
                    if let option = agentOption {
                        Picker("Model", selection: $modelId) {
                            ForEach(option.models) { model in
                                Text(model.label).tag(model.id)
                            }
                        }
                        if !option.efforts.isEmpty {
                            Picker("Effort", selection: $effort) {
                                Text("Default").tag(String?.none)
                                ForEach(option.efforts, id: \.self) { level in
                                    Text(level.capitalized).tag(String?.some(level))
                                }
                            }
                        }
                    }
                }
            }

            if project?.namesItself != true {
                Section {
                    TextField("Name", text: $name)
                } footer: {
                    Text("Optional — the provider names the workspace otherwise.")
                }
            }

            if project?.taskSupport != ProjectTaskSupport.none {
                Section {
                    TextField("Describe what the agent should start on…", text: $task, axis: .vertical)
                        .lineLimit(4 ... 10)
                } header: {
                    Text("Task")
                } footer: {
                    if project?.taskSupport == .required {
                        Text("This project needs an opening task.")
                    }
                }
            }
        }
        .disabled(creating)
    }

    private var emptyState: some View {
        ContentUnavailableView(
            "No Projects",
            systemImage: "folder",
            description: Text(
                "No provider reported a project to create in. Store a key for a provider that hosts workspaces, and its projects appear here."
            )
        )
    }

    private func errorState(_ message: String) -> some View {
        ContentUnavailableView {
            Label("Couldn't Load Projects", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button("Try Again") {
                loadError = nil
                Task { await loadProjects() }
            }
        }
    }

    // MARK: - Choices

    private var providerIds: [String] {
        answer?.providerIds ?? []
    }

    private var providerProjects: [RosterProject] {
        answer?.projects.filter { $0.providerId == providerId } ?? []
    }

    private var project: RosterProject? {
        providerProjects.first { $0.providerProjectId == projectId }
    }

    private var agentOptions: [WorkspaceAgentOption] {
        answer?.agentModels.filter { $0.providerId == providerId } ?? []
    }

    private var agentOption: WorkspaceAgentOption? {
        agentOptions.first { $0.agent == agentKind }
    }

    private var providerBinding: Binding<String> {
        Binding(get: { providerId }, set: { selectProvider($0) })
    }

    private var agentBinding: Binding<String?> {
        Binding(
            get: { agentKind },
            set: { kind in
                agentKind = kind
                modelId = agentOptions.first { $0.agent == kind }?.models.first?.id ?? ""
                effort = nil
            }
        )
    }

    /// Choosing a provider re-seats the project and agent from what is
    /// remembered for it, falling back to the answer's own first offer.
    private func selectProvider(_ id: String) {
        providerId = id
        let storedProject = defaults.lastProjectId(for: id)
        projectId =
            providerProjects.first { $0.providerProjectId == storedProject }?.providerProjectId
            ?? providerProjects.first?.providerProjectId ?? ""

        if let stored = defaults.agentDefault(for: id),
            let option = agentOptions.first(where: { $0.agent == stored.agent }),
            option.models.contains(where: { $0.id == stored.model }),
            stored.effort == nil || option.efforts.contains(stored.effort ?? "")
        {
            agentKind = stored.agent
            modelId = stored.model
            effort = stored.effort
        } else {
            agentKind = nil
            modelId = ""
            effort = nil
        }
    }

    private func projectLabel(_ project: RosterProject) -> String {
        let target = project.targetName.map { " (\($0))" } ?? ""
        return "\(project.repository)\(target)"
    }

    // MARK: - Acts

    private var canCreate: Bool {
        guard !creating, let project else { return false }
        if project.taskSupport == .required, !task.contains(where: { !$0.isWhitespace }) {
            return false
        }
        // An agent choice needs a model beside it; the two only mean anything together.
        if agentKind != nil, modelId.isEmpty { return false }
        return true
    }

    private func loadProjects() async {
        do {
            let fetched = try await session.authorized { token in
                try await projectsClient.projects(bearerToken: token)
            }
            answer = fetched
            let ids = fetched.providerIds
            let stored = defaults.lastProviderId
            let initial = stored.flatMap { ids.contains($0) ? $0 : nil } ?? ids.first
            if let initial { selectProvider(initial) }
        } catch is AccountSessionError {
            ()  // Signed out — the state change redraws automatically.
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func create() {
        guard let project else { return }
        creating = true
        failure = nil
        let chosenName = project.namesItself ? "" : name.trimmingCharacters(in: .whitespacesAndNewlines)
        let chosenTask =
            project.taskSupport == ProjectTaskSupport.none
            ? "" : task.trimmingCharacters(in: .whitespacesAndNewlines)
        let chosenAgent = agentKind
        let chosenModel = chosenAgent != nil ? modelId : nil
        let chosenEffort = chosenAgent != nil ? effort : nil
        Task {
            defer { creating = false }
            do {
                let created = try await session.authorized { token in
                    try await actClient.createWorkspace(
                        accessToken: token,
                        providerId: project.providerId,
                        providerProjectId: project.providerProjectId,
                        name: chosenName.isEmpty ? nil : chosenName,
                        task: chosenTask.isEmpty ? nil : chosenTask,
                        agent: chosenAgent,
                        model: chosenModel,
                        effort: chosenEffort
                    )
                }
                if created.result == .accepted {
                    if let provider = ProductProviderID(rawValue: project.providerId) {
                        events.record(.sessionActSend(provider: provider, act: .workspaceCreate))
                    }
                    rememberChoices()
                    onCreated()
                } else {
                    failure = created.reason ?? "The workspace was not created."
                }
            } catch is AccountSessionError {
                ()  // Signed out — the state change redraws automatically.
            } catch {
                failure = error.localizedDescription
            }
        }
    }

    private func rememberChoices() {
        defaults.lastProviderId = providerId
        defaults.setLastProjectId(projectId, for: providerId)
        defaults.setAgentDefault(
            agentKind.map { WorkspaceAgentDefault(agent: $0, model: modelId, effort: effort) },
            for: providerId
        )
    }
}

/// The Add Agent sheet: starts another agent in the workspace an observed
/// session runs in, as one of the kinds that session's latest observation
/// listed. The server re-observes and validates the kind against its own
/// fresh advertisement before anything starts.
struct AgentSpawnerSheet: View {
    let session: RosterSession
    let actClient: ActClient
    /// Called after a successful spawn so the presenter can dismiss and refresh.
    let onDone: () -> Void

    @Environment(AccountSession.self) private var account
    @Environment(ProductEventSender.self) private var events
    @State private var agent: String
    @State private var name = ""
    @State private var task = ""
    @State private var spawning = false
    @State private var failure: String?

    init(session: RosterSession, actClient: ActClient, onDone: @escaping () -> Void) {
        self.session = session
        self.actClient = actClient
        self.onDone = onDone
        _agent = State(initialValue: session.spawnableAgents.first ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Agent", selection: $agent) {
                        ForEach(session.spawnableAgents, id: \.self) { kind in
                            Text(kind.capitalized).tag(kind)
                        }
                    }
                }

                Section {
                    TextField("Name", text: $name)
                } footer: {
                    Text("Optional — the provider names the agent otherwise.")
                }

                Section("Task") {
                    TextField("Describe what the agent should start on…", text: $task, axis: .vertical)
                        .lineLimit(4 ... 10)
                }
            }
            .disabled(spawning)
            .navigationTitle(session.workspace ?? session.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onDone)
                        .disabled(spawning)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if spawning {
                        ProgressView()
                    } else {
                        Button("Start") { spawn() }
                            .disabled(agent.isEmpty)
                    }
                }
            }
        }
        .interactiveDismissDisabled(spawning)
        .failureAlert("Not Started", reason: $failure)
    }

    private func spawn() {
        let agentKind = agent
        let nameValue = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let taskValue = task.trimmingCharacters(in: .whitespacesAndNewlines)
        spawning = true
        failure = nil
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
                onDone()
            case .refused(let reason):
                failure = reason
            case .signedOut:
                ()  // The state change redraws automatically.
            }
        }
    }
}
