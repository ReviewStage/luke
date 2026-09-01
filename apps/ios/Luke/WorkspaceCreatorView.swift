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
        .alert(
            "Not Created",
            isPresented: Binding(
                get: { failure != nil },
                set: { if !$0 { failure = nil } }
            ),
            presenting: failure
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { reason in
            Text(reason)
        }
    }

    // MARK: - Form

    private var creatorForm: some View {
        Form {
            Section {
                Picker("Provider", selection: providerBinding) {
                    ForEach(providerIds, id: \.self) { id in
                        Text(providerName(id)).tag(id)
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

            Section {
                TextField("Name", text: $name)
            } footer: {
                Text("Optional — the provider names the workspace otherwise.")
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
                "No provider reported a project to create in. Workspaces can be created in Conductor, Cursor, and Replicas projects once a key for one is stored."
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

    /// Providers in the order the answer lists them, each exactly once.
    private var providerIds: [String] {
        guard let answer else { return [] }
        var seen = Set<String>()
        var ids: [String] = []
        for project in answer.projects where seen.insert(project.providerId).inserted {
            ids.append(project.providerId)
        }
        return ids
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
        let candidates = answer?.projects.filter { $0.providerId == id } ?? []
        let storedProject = defaults.lastProjectId(for: id)
        projectId =
            candidates.first { $0.providerProjectId == storedProject }?.providerProjectId
            ?? candidates.first?.providerProjectId ?? ""

        let options = answer?.agentModels.filter { $0.providerId == id } ?? []
        if let stored = defaults.agentDefault(for: id),
            let option = options.first(where: { $0.agent == stored.agent }),
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

    private func providerName(_ id: String) -> String {
        VaultProviderID(rawValue: id)?.displayName ?? id.capitalized
    }

    private func projectLabel(_ project: RosterProject) -> String {
        let target = project.targetName.map { " (\($0))" } ?? ""
        return "\(project.repository)\(target)"
    }

    // MARK: - Acts

    private var canCreate: Bool {
        guard !creating, let project else { return false }
        if project.taskSupport == .required,
            task.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        {
            return false
        }
        // An agent choice needs a model beside it; the two only mean anything together.
        if agentKind != nil, modelId.isEmpty { return false }
        return true
    }

    private func loadProjects() async {
        do {
            let token = try await session.validAccessToken()
            let fetched: ProjectsAnswer
            do {
                fetched = try await projectsClient.projects(bearerToken: token)
            } catch ProjectsClientError.serverError(let status) where status == 401 {
                // validAccessToken() refreshes near-expiry tokens; a 401 here
                // means the server rejected the token — refresh and retry once.
                let fresh = try await session.refreshAccessToken()
                fetched = try await projectsClient.projects(bearerToken: fresh)
            }
            answer = fetched
            var seen = Set<String>()
            var ids: [String] = []
            for project in fetched.projects where seen.insert(project.providerId).inserted {
                ids.append(project.providerId)
            }
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
        let chosenName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let chosenTask =
            project.taskSupport == ProjectTaskSupport.none
            ? "" : task.trimmingCharacters(in: .whitespacesAndNewlines)
        let chosenAgent = agentKind
        let chosenModel = chosenAgent != nil ? modelId : nil
        let chosenEffort = chosenAgent != nil ? effort : nil
        let call: (String) async throws -> ActWorkspaceAnswer = { token in
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
        Task {
            defer { creating = false }
            do {
                let token = try await session.validAccessToken()
                let created: ActWorkspaceAnswer
                do {
                    created = try await call(token)
                } catch ActClientError.unauthorized {
                    // validAccessToken() refreshes near-expiry tokens; a 401 here
                    // means the server rejected the token — refresh and retry once.
                    let fresh = try await session.refreshAccessToken()
                    created = try await call(fresh)
                }
                if created.result == .accepted {
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
    @State private var agent: String
    @State private var name = ""
    @State private var task = ""
    @State private var state: SpawnerState = .idle

    private enum SpawnerState: Equatable {
        case idle
        case spawning
        case result(ActWorkspaceAnswer)
    }

    init(session: RosterSession, actClient: ActClient, onDone: @escaping () -> Void) {
        self.session = session
        self.actClient = actClient
        self.onDone = onDone
        _agent = State(initialValue: session.spawnableAgents.first ?? "")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Picker("Agent", selection: $agent) {
                        ForEach(session.spawnableAgents, id: \.self) { kind in
                            Text(kind.capitalized).tag(kind)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(Color.ink)
                    .disabled(state == .spawning)

                    VStack(spacing: 8) {
                        LabeledTextField(
                            label: "Name (optional)", text: $name, disabled: state == .spawning)
                        LabeledTextField(
                            label: "Opening task (optional)",
                            text: $task,
                            axis: .vertical,
                            disabled: state == .spawning
                        )
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.cardFill)
                            .overlay(
                                RoundedRectangle(cornerRadius: 10)
                                    .stroke(Color.controlStroke, lineWidth: 1)
                            )
                    )

                    Button(action: spawn) {
                        HStack(spacing: 8) {
                            if state == .spawning {
                                ProgressView()
                                    .tint(Color.ink)
                                    .scaleEffect(0.8)
                            }
                            Text(state == .spawning ? "Starting…" : "Start agent")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Color.ink)
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 42)
                    }
                    .disabled(agent.isEmpty || state == .spawning)
                    .buttonStyle(ActButtonStyle())

                    if case .result(let answer) = state {
                        spawnBanner(answer)
                    }
                }
                .padding(.horizontal)
                .padding(.top, 8)
            }
            .background(Color.ground.ignoresSafeArea())
            .navigationTitle(session.workspace ?? session.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel", action: onDone)
                }
            }
        }
        .task(id: state) {
            guard case .result(let answer) = state, answer.result == .accepted else { return }
            try? await Task.sleep(for: .seconds(0.8))
            guard !Task.isCancelled else { return }
            onDone()
        }
    }

    private func spawn() {
        let agentKind = agent
        let nameValue = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let taskValue = task.trimmingCharacters(in: .whitespacesAndNewlines)
        state = .spawning
        Task {
            do {
                let token = try await account.validAccessToken()
                do {
                    let answer = try await actClient.spawnAgent(
                        accessToken: token,
                        providerId: session.providerId,
                        providerSessionId: session.sessionId,
                        agent: agentKind,
                        name: nameValue.isEmpty ? nil : nameValue,
                        task: taskValue.isEmpty ? nil : taskValue
                    )
                    state = .result(answer)
                } catch ActClientError.unauthorized {
                    // validAccessToken() refreshes near-expiry tokens; a 401
                    // here means the server rejected the token outright — refresh and retry once.
                    let fresh = try await account.refreshAccessToken()
                    let answer = try await actClient.spawnAgent(
                        accessToken: fresh,
                        providerId: session.providerId,
                        providerSessionId: session.sessionId,
                        agent: agentKind,
                        name: nameValue.isEmpty ? nil : nameValue,
                        task: taskValue.isEmpty ? nil : taskValue
                    )
                    state = .result(answer)
                }
            } catch {
                state = .result(ActWorkspaceAnswer(
                    result: .rejected,
                    reason: error.localizedDescription,
                    providerSessionId: nil
                ))
            }
        }
    }

    @ViewBuilder
    private func spawnBanner(_ answer: ActWorkspaceAnswer) -> some View {
        HStack(spacing: 6) {
            Image(systemName: answer.result == .accepted ? "checkmark.circle" : "exclamationmark.circle")
                .font(.system(size: 13, weight: .semibold))
            Text(answer.result == .accepted ? "Agent started" : (answer.reason ?? "Not started"))
                .font(.system(size: 13))
                .lineLimit(2)
        }
        .foregroundStyle(answer.result == .accepted ? Color.stateComplete : Color.errorInk)
        .padding(.horizontal, 10)
        .onTapGesture { state = .idle }
    }
}

private struct LabeledTextField: View {
    let label: String
    @Binding var text: String
    var axis: Axis = .horizontal
    var disabled: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Color.inkSecondary)
            TextField("", text: $text, axis: axis)
                .lineLimit(axis == .vertical ? 3 : 1, reservesSpace: false)
                .textFieldStyle(.plain)
                .font(.system(size: 15))
                .foregroundStyle(Color.ink)
                .disabled(disabled)
        }
    }
}

struct ActButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 16)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(configuration.isPressed ? Color.pressedFill : Color.cardFill)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color.controlStroke, lineWidth: 1)
                    )
            )
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}
