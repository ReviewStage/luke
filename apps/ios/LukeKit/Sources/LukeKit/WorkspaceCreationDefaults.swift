import Foundation

/// The agent kind, model, and optionally effort last chosen for new
/// workspaces on one provider — one value on purpose, the way the desktop
/// stores it: a model id or an effort level only means anything beside the
/// agent that runs it.
public struct WorkspaceAgentDefault: Equatable, Sendable {
    public let agent: String
    public let model: String
    public let effort: String?

    public init(agent: String, model: String, effort: String? = nil) {
        self.agent = agent
        self.model = model
        self.effort = effort
    }
}

/// Remembers the developer's own last New Workspace choices on this device —
/// the provider, the project per provider, and the agent selection per
/// provider — the way the desktop app keeps its workspace agent defaults.
/// Stored in UserDefaults and only ever replayed against what the latest
/// projects answer still offers: a remembered value the answer no longer
/// lists is simply not preselected, never sent.
public final class WorkspaceCreationDefaults {
    private enum Key {
        static let provider = "workspaceCreation.lastProviderId"
        static let projectByProvider = "workspaceCreation.lastProjectIdByProvider"
        static let agentByProvider = "workspaceCreation.agentSelectionByProvider"
    }

    private enum AgentField {
        static let agent = "agent"
        static let model = "model"
        static let effort = "effort"
    }

    private let store: UserDefaults

    public init(store: UserDefaults = .standard) {
        self.store = store
    }

    public var lastProviderId: String? {
        get { store.string(forKey: Key.provider) }
        set {
            if let newValue {
                store.set(newValue, forKey: Key.provider)
            } else {
                store.removeObject(forKey: Key.provider)
            }
        }
    }

    public func lastProjectId(for providerId: String) -> String? {
        projectsByProvider()[providerId]
    }

    public func setLastProjectId(_ projectId: String, for providerId: String) {
        var held = projectsByProvider()
        held[providerId] = projectId
        store.set(held, forKey: Key.projectByProvider)
    }

    public func agentDefault(for providerId: String) -> WorkspaceAgentDefault? {
        guard
            let held = store.dictionary(forKey: Key.agentByProvider) as? [String: [String: String]],
            let fields = held[providerId],
            let agent = fields[AgentField.agent],
            let model = fields[AgentField.model]
        else { return nil }
        return WorkspaceAgentDefault(agent: agent, model: model, effort: fields[AgentField.effort])
    }

    /// Passing nil forgets the provider's stored choice, so choosing the
    /// provider's own default again is remembered as exactly that.
    public func setAgentDefault(_ selection: WorkspaceAgentDefault?, for providerId: String) {
        var held = store.dictionary(forKey: Key.agentByProvider) as? [String: [String: String]] ?? [:]
        if let selection {
            var fields = [AgentField.agent: selection.agent, AgentField.model: selection.model]
            if let effort = selection.effort { fields[AgentField.effort] = effort }
            held[providerId] = fields
        } else {
            held.removeValue(forKey: providerId)
        }
        store.set(held, forKey: Key.agentByProvider)
    }

    private func projectsByProvider() -> [String: String] {
        store.dictionary(forKey: Key.projectByProvider) as? [String: String] ?? [:]
    }
}
