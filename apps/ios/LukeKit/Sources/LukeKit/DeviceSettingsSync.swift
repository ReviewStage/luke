import Foundation

/// Every setting the phone and the watch both hold, read from and written to
/// the same UserDefaults keys each app's own controls use: the voice the next
/// session speaks in, and the New Workspace choices remembered per provider.
/// The watch's pace for its own Realtime mint is the watch's alone and is not
/// carried, since the Live model the phone speaks through has no speed.
/// Nothing here is account data, a credential, or anything a provider wrote;
/// it is the developer's own choices about their own devices.
public struct DeviceSettingsSnapshot: Equatable, Sendable {
    public var voice: LiveVoice
    public var workspaceProviderId: String?
    public var workspaceProjectIds: [String: String]
    public var workspaceAgentDefaults: [String: WorkspaceAgentDefault]

    public init(
        voice: LiveVoice = .default,
        workspaceProviderId: String? = nil,
        workspaceProjectIds: [String: String] = [:],
        workspaceAgentDefaults: [String: WorkspaceAgentDefault] = [:]
    ) {
        self.voice = voice
        self.workspaceProviderId = workspaceProviderId
        self.workspaceProjectIds = workspaceProjectIds
        self.workspaceAgentDefaults = workspaceAgentDefaults
    }

    public static func read(from store: UserDefaults) -> DeviceSettingsSnapshot {
        let defaults = WorkspaceCreationDefaults(store: store)
        return DeviceSettingsSnapshot(
            voice: store.string(forKey: VoiceSettingsKey.voice).flatMap(LiveVoice.init(rawValue:)) ?? .default,
            workspaceProviderId: defaults.lastProviderId,
            workspaceProjectIds: defaults.lastProjectIds,
            workspaceAgentDefaults: defaults.agentDefaults
        )
    }

    public func write(to store: UserDefaults) {
        store.set(voice.rawValue, forKey: VoiceSettingsKey.voice)
        let defaults = WorkspaceCreationDefaults(store: store)
        defaults.lastProviderId = workspaceProviderId
        defaults.setLastProjectIds(workspaceProjectIds)
        defaults.setAgentDefaults(workspaceAgentDefaults)
    }
}

/// Keeps one device's settings equal to its paired device's over a channel
/// that carries only the latest snapshot each way — WatchConnectivity's
/// application context, which is what Apple built for exactly this: it is
/// delivered whenever the pair next connects, and the last one received
/// survives a relaunch. The engine itself knows nothing of the channel; the
/// two relays hand it what arrived and send what it publishes.
///
/// Two copies converge by the newest change winning. Every local change
/// stamps the moment it was made, the stamp travels with the snapshot, and an
/// arriving snapshot is applied only when it is newer than the last change
/// made here, so a change made while the pair was apart is never undone by
/// the other device's older copy, whichever of the two activates first.
@MainActor
public final class DeviceSettingsSync {
    /// Which of the pair this device is. Settings changed before a device ever
    /// synced carry no stamp of their own, so the two copies are ranked by
    /// role instead: the primary's copy wins over the secondary's, and both
    /// lose to any change made once syncing, whichever device activates
    /// first.
    public enum Role: Sendable {
        case primary
        case secondary

        /// Later than never-changed, earlier than any real change.
        var preSyncStamp: Date {
            switch self {
            case .primary: Date(timeIntervalSinceReferenceDate: 2)
            case .secondary: Date(timeIntervalSinceReferenceDate: 1)
            }
        }
    }

    /// Bumped when a field changes meaning or type; a payload from another
    /// version is ignored rather than half-read. Version 2 dropped the pace
    /// and widened the voice to every Live voice.
    public static let payloadVersion = 2

    private enum Field {
        static let version = "settingsVersion"
        static let changedAt = "changedAt"
        static let voice = "voice"
        static let workspaceProvider = "workspaceProviderId"
        static let workspaceProjects = "workspaceProjectIds"
        static let workspaceAgents = "workspaceAgentDefaults"
        static let agent = "agent"
        static let model = "model"
        static let effort = "effort"
    }

    private static let changedAtKey = "deviceSettings.changedAt"

    private let store: UserDefaults
    private let role: Role
    private let now: () -> Date
    private let publish: ([String: Any]) -> Void
    private var known: DeviceSettingsSnapshot
    private var applying = false
    private var observer: (any NSObjectProtocol)?

    public init(
        store: UserDefaults = .standard,
        role: Role,
        now: @escaping () -> Date = Date.init,
        publish: @escaping ([String: Any]) -> Void
    ) {
        self.store = store
        self.role = role
        self.now = now
        self.publish = publish
        known = DeviceSettingsSnapshot.read(from: store)
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    /// Begins following the store. A device whose settings were already
    /// changed before it ever synced has no stamp for them; they take the
    /// role's pre-sync stamp, so a fresh pair learns them rather than
    /// overwriting them with its own untouched defaults, and two devices
    /// that each hold such a copy settle on the primary's.
    public func start() {
        if changedAt == nil, known != DeviceSettingsSnapshot() {
            changedAt = role.preSyncStamp
        }
        observer = NotificationCenter.default.addObserver(
            forName: UserDefaults.didChangeNotification, object: store, queue: nil
        ) { [weak self] _ in
            if Thread.isMainThread {
                MainActor.assumeIsolated { self?.noteLocalChange() }
            } else {
                Task { @MainActor [weak self] in self?.noteLocalChange() }
            }
        }
    }

    /// Sends what this device holds now, for the edges where the pair may
    /// have missed a change: activation and a new pairing.
    public func publishCurrent() {
        publish(payload(for: known))
    }

    /// Applies a paired device's snapshot when it is newer than the last
    /// change made here; anything older or unreadable is left alone.
    public func receive(_ payload: [String: Any]) {
        guard payload[Field.version] as? Int == Self.payloadVersion,
              let stamp = payload[Field.changedAt] as? Double,
              let incoming = Self.snapshot(from: payload)
        else { return }
        let incomingChangedAt = Date(timeIntervalSinceReferenceDate: stamp)
        if let changedAt, incomingChangedAt <= changedAt { return }
        changedAt = incomingChangedAt
        guard incoming != known else { return }
        known = incoming
        applying = true
        incoming.write(to: store)
        applying = false
    }

    private func noteLocalChange() {
        guard !applying else { return }
        let current = DeviceSettingsSnapshot.read(from: store)
        guard current != known else { return }
        known = current
        changedAt = now()
        publish(payload(for: current))
    }

    private var changedAt: Date? {
        get {
            guard let stamp = store.object(forKey: Self.changedAtKey) as? Double else { return nil }
            return Date(timeIntervalSinceReferenceDate: stamp)
        }
        set {
            applying = true
            if let newValue {
                store.set(newValue.timeIntervalSinceReferenceDate, forKey: Self.changedAtKey)
            } else {
                store.removeObject(forKey: Self.changedAtKey)
            }
            applying = false
        }
    }

    private func payload(for snapshot: DeviceSettingsSnapshot) -> [String: Any] {
        var payload: [String: Any] = [
            Field.version: Self.payloadVersion,
            Field.changedAt: (changedAt ?? Date(timeIntervalSinceReferenceDate: 0))
                .timeIntervalSinceReferenceDate,
            Field.voice: snapshot.voice.rawValue,
            Field.workspaceProjects: snapshot.workspaceProjectIds,
            Field.workspaceAgents: snapshot.workspaceAgentDefaults.mapValues { selection in
                var fields = [Field.agent: selection.agent]
                if let model = selection.model { fields[Field.model] = model }
                if let effort = selection.effort { fields[Field.effort] = effort }
                return fields
            },
        ]
        if let provider = snapshot.workspaceProviderId {
            payload[Field.workspaceProvider] = provider
        }
        return payload
    }

    /// A voice the vocabulary no longer names falls to the default, the same
    /// answer each app's own controls give an unknown stored value.
    private static func snapshot(from payload: [String: Any]) -> DeviceSettingsSnapshot? {
        guard let voice = payload[Field.voice] as? String else { return nil }
        let agents = (payload[Field.workspaceAgents] as? [String: [String: String]] ?? [:])
            .compactMapValues { fields -> WorkspaceAgentDefault? in
                guard let agent = fields[Field.agent] else { return nil }
                return WorkspaceAgentDefault(
                    agent: agent,
                    model: fields[Field.model],
                    effort: fields[Field.effort]
                )
            }
        return DeviceSettingsSnapshot(
            voice: LiveVoice(rawValue: voice) ?? .default,
            workspaceProviderId: payload[Field.workspaceProvider] as? String,
            workspaceProjectIds: payload[Field.workspaceProjects] as? [String: String] ?? [:],
            workspaceAgentDefaults: agents
        )
    }
}
