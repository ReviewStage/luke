import Foundation

/// The agent kind, optional model, and optional effort last chosen for new
/// workspaces on one provider. Most providers require a model beside the
/// agent, while kind-only providers carry only the agent name.
public struct WorkspaceAgentDefault: Equatable, Sendable {
    public let agent: String
    public let model: String?
    public let effort: String?

    public init(agent: String, model: String? = nil, effort: String? = nil) {
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

    /// Every provider's remembered project at once, keyed by provider id —
    /// the tie-breaks a spoken creation ask is settled against.
    public var lastProjectIds: [String: String] {
        projectsByProvider()
    }

    public func setLastProjectId(_ projectId: String, for providerId: String) {
        var held = projectsByProvider()
        held[providerId] = projectId
        store.set(held, forKey: Key.projectByProvider)
    }

    /// Replaces every provider's remembered project at once — the shape a
    /// paired device's copy of these choices arrives in.
    public func setLastProjectIds(_ projectIds: [String: String]) {
        if projectIds.isEmpty {
            store.removeObject(forKey: Key.projectByProvider)
        } else {
            store.set(projectIds, forKey: Key.projectByProvider)
        }
    }

    /// Every provider's remembered agent selection at once, keyed by provider id.
    public var agentDefaults: [String: WorkspaceAgentDefault] {
        agentsByProvider().compactMapValues(Self.agentDefault(fields:))
    }

    /// Replaces every provider's remembered agent selection at once.
    public func setAgentDefaults(_ selections: [String: WorkspaceAgentDefault]) {
        if selections.isEmpty {
            store.removeObject(forKey: Key.agentByProvider)
        } else {
            store.set(selections.mapValues(Self.fields(of:)), forKey: Key.agentByProvider)
        }
    }

    public func agentDefault(for providerId: String) -> WorkspaceAgentDefault? {
        agentsByProvider()[providerId].flatMap(Self.agentDefault(fields:))
    }

    /// Passing nil forgets the provider's stored choice, so choosing the
    /// provider's own default again is remembered as exactly that.
    public func setAgentDefault(_ selection: WorkspaceAgentDefault?, for providerId: String) {
        var held = agentsByProvider()
        if let selection {
            held[providerId] = Self.fields(of: selection)
        } else {
            held.removeValue(forKey: providerId)
        }
        store.set(held, forKey: Key.agentByProvider)
    }

    private func projectsByProvider() -> [String: String] {
        store.dictionary(forKey: Key.projectByProvider) as? [String: String] ?? [:]
    }

    private func agentsByProvider() -> [String: [String: String]] {
        store.dictionary(forKey: Key.agentByProvider) as? [String: [String: String]] ?? [:]
    }

    private static func agentDefault(fields: [String: String]) -> WorkspaceAgentDefault? {
        guard let agent = fields["agent"] else { return nil }
        return WorkspaceAgentDefault(agent: agent, model: fields["model"], effort: fields["effort"])
    }

    private static func fields(of selection: WorkspaceAgentDefault) -> [String: String] {
        var fields = ["agent": selection.agent]
        if let model = selection.model { fields["model"] = model }
        if let effort = selection.effort { fields["effort"] = effort }
        return fields
    }
}
