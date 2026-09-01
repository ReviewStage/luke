import LukeKit
import SwiftUI

/// The New Workspace sheet: loads where the stored keys can create one — each
/// entry a project its provider itself reported on a fresh observation pass —
/// and hands the chosen project to the creator form. A provider that reports
/// no project offers nowhere to create, so an empty answer is said plainly
/// rather than papered over with a free-form field.
struct WorkspaceCreatorSheet: View {
    let actClient: ActClient
    let projectsClient: ProjectsClient
    /// Called after a successful creation so the presenter can dismiss and refresh.
    let onCreated: () -> Void

    @Environment(AccountSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    /// nil while the first load is in flight; loaded projects afterwards.
    @State private var projects: [RosterProject]?
    @State private var loadError: String?
    @State private var selectedProjectId: String?

    private var selectedProject: RosterProject? {
        projects?.first { $0.id == selectedProjectId } ?? projects?.first
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let error = loadError {
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundStyle(Color.errorInk)
                    } else if let projects {
                        if projects.isEmpty {
                            Text("No provider reported a project to create in. Workspaces can be created in Conductor, Cursor, and Replicas projects once a key for one is stored.")
                                .font(.system(size: 13))
                                .foregroundStyle(Color.inkSecondary)
                        } else if let project = selectedProject {
                            projectPicker(projects)
                            WorkspaceCreatorView(
                                providerId: project.providerId,
                                providerProjectId: project.providerProjectId,
                                taskSupport: project.taskSupport,
                                actClient: actClient,
                                onCreated: onCreated
                            )
                            .id(project.id)
                        }
                    } else {
                        HStack(spacing: 8) {
                            ProgressView()
                                .tint(Color.ink)
                            Text("Loading projects…")
                                .font(.system(size: 13))
                                .foregroundStyle(Color.inkSecondary)
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.top, 8)
            }
            .background(Color.ground.ignoresSafeArea())
            .navigationTitle("New Workspace")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task { await loadProjects() }
        }
    }

    private func projectPicker(_ projects: [RosterProject]) -> some View {
        Picker(
            "Project",
            selection: Binding(
                get: { selectedProject?.id ?? "" },
                set: { selectedProjectId = $0 }
            )
        ) {
            ForEach(projects) { project in
                Text(projectLabel(project)).tag(project.id)
            }
        }
        .pickerStyle(.menu)
        .tint(Color.ink)
    }

    private func projectLabel(_ project: RosterProject) -> String {
        let provider =
            VaultProviderID(rawValue: project.providerId)?.displayName
            ?? project.providerId.capitalized
        let target = project.targetName.map { " (\($0))" } ?? ""
        return "\(provider) · \(project.repository)\(target)"
    }

    private func loadProjects() async {
        loadError = nil
        do {
            let token = try await session.validAccessToken()
            do {
                projects = try await projectsClient.projects(bearerToken: token)
            } catch ProjectsClientError.serverError(let status) where status == 401 {
                // validAccessToken() refreshes near-expiry tokens; a 401 here
                // means the server rejected the token — refresh and retry once.
                let fresh = try await session.refreshAccessToken()
                projects = try await projectsClient.projects(bearerToken: fresh)
            }
        } catch is AccountSessionError {
            ()  // Signed out — the state change redraws automatically.
        } catch {
            loadError = error.localizedDescription
        }
    }
}

/// A form for creating a workspace in one reported cloud project.
///
/// Pass the `providerId`, `providerProjectId`, and `taskSupport` from the
/// projects endpoint's answer; the server re-observes and validates the
/// project against the provider's own list again before anything is created.
struct WorkspaceCreatorView: View {
    let providerId: String
    let providerProjectId: String
    var taskSupport: ProjectTaskSupport = .optional
    let actClient: ActClient
    /// Called shortly after a successful creation so a containing sheet can dismiss.
    var onCreated: (() -> Void)? = nil

    @Environment(AccountSession.self) private var session
    @Environment(ProductEventSender.self) private var events
    @State private var name = ""
    @State private var task = ""
    @State private var state: CreatorState = .idle

    private enum CreatorState: Equatable {
        case idle
        case creating
        case result(ActWorkspaceAnswer)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(spacing: 8) {
                LabeledTextField(label: "Name (optional)", text: $name, disabled: state == .creating)
                if taskSupport != .none {
                    LabeledTextField(
                        label: taskSupport == .required ? "Opening task" : "Opening task (optional)",
                        text: $task,
                        axis: .vertical,
                        disabled: state == .creating
                    )
                }
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

            Button(action: create) {
                HStack(spacing: 8) {
                    if state == .creating {
                        ProgressView()
                            .tint(Color.ink)
                            .scaleEffect(0.8)
                    }
                    Text(state == .creating ? "Creating…" : "Create workspace")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.ink)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 42)
            }
            .disabled(!canCreate || state == .creating)
            .buttonStyle(ActButtonStyle())

            if case .result(let answer) = state {
                resultBanner(answer)
            }
        }
        // Bound to the view's lifetime, unlike an unstructured Task: dismissing
        // the sheet cancels the wait, so a slow creation from a closed sheet
        // can never dismiss a sheet opened later.
        .task(id: state) {
            guard case .result(let answer) = state, answer.result == .accepted,
                  let onCreated else { return }
            try? await Task.sleep(for: .seconds(0.8))
            guard !Task.isCancelled else { return }
            onCreated()
        }
    }

    /// A project that needs an opening task cannot make an idle workspace, so
    /// the button holds until the developer has given one.
    private var canCreate: Bool {
        taskSupport != .required
            || !task.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func create() {
        let nameValue = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let taskValue =
            taskSupport == .none ? "" : task.trimmingCharacters(in: .whitespacesAndNewlines)
        state = .creating
        Task {
            do {
                let token = try await session.validAccessToken()
                let answer: ActWorkspaceAnswer
                do {
                    answer = try await actClient.createWorkspace(
                        accessToken: token,
                        providerId: providerId,
                        providerProjectId: providerProjectId,
                        name: nameValue.isEmpty ? nil : nameValue,
                        task: taskValue.isEmpty ? nil : taskValue
                    )
                } catch ActClientError.unauthorized {
                    // validAccessToken() refreshes near-expiry tokens; a 401
                    // here means the server rejected the token outright — refresh and retry once.
                    let fresh = try await session.refreshAccessToken()
                    answer = try await actClient.createWorkspace(
                        accessToken: fresh,
                        providerId: providerId,
                        providerProjectId: providerProjectId,
                        name: nameValue.isEmpty ? nil : nameValue,
                        task: taskValue.isEmpty ? nil : taskValue
                    )
                }
                if answer.result == .accepted,
                   let provider = ProductProviderID(rawValue: providerId)
                {
                    events.record(.sessionActSend(provider: provider, act: .workspaceCreate))
                }
                state = .result(answer)
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
    private func resultBanner(_ answer: ActWorkspaceAnswer) -> some View {
        HStack(spacing: 6) {
            Image(systemName: answer.result == .accepted ? "checkmark.circle" : "exclamationmark.circle")
                .font(.system(size: 13, weight: .semibold))
            VStack(alignment: .leading, spacing: 2) {
                Text(answer.result == .accepted ? "Workspace created" : (answer.reason ?? "Creation failed"))
                    .font(.system(size: 13))
                    .lineLimit(2)
                if let sessionId = answer.providerSessionId {
                    Text("Session: \(sessionId)")
                        .font(.system(size: 11))
                        .opacity(0.7)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
        .foregroundStyle(answer.result == .accepted ? Color.stateComplete : Color.errorInk)
        .padding(.horizontal, 10)
        .onTapGesture { state = .idle }
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
