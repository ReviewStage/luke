import Foundation

/// Every setting the phone and the watch both hold, read from and written to
/// the same UserDefaults keys each app's own controls use: the voice and pace
/// the next mint asks for, and the New Workspace choices remembered per
/// provider. Nothing here is account data, a credential, or anything a
/// provider wrote; it is the developer's own choices about their own devices.
public struct DeviceSettingsSnapshot: Equatable, Sendable {
    public var voice: RealtimeVoice
    public var speed: RealtimeVoiceSpeed
    public var workspaceProviderId: String?
    public var workspaceProjectIds: [String: String]
    public var workspaceAgentDefaults: [String: WorkspaceAgentDefault]

    public init(
        voice: RealtimeVoice = .default,
        speed: RealtimeVoiceSpeed = .default,
        workspaceProviderId: String? = nil,
        workspaceProjectIds: [String: String] = [:],
        workspaceAgentDefaults: [String: WorkspaceAgentDefault] = [:]
    ) {
        self.voice = voice
        self.speed = speed
        self.workspaceProviderId = workspaceProviderId
        self.workspaceProjectIds = workspaceProjectIds
        self.workspaceAgentDefaults = workspaceAgentDefaults
    }

    public static func read(from store: UserDefaults) -> DeviceSettingsSnapshot {
        let defaults = WorkspaceCreationDefaults(store: store)
        return DeviceSettingsSnapshot(
            voice: store.string(forKey: VoiceSettingsKey.voice).flatMap(RealtimeVoice.init(rawValue:))
                ?? .default,
            speed: store.string(forKey: VoiceSettingsKey.speed).flatMap(RealtimeVoiceSpeed.init(rawValue:))
                ?? .default,
            workspaceProviderId: defaults.lastProviderId,
            workspaceProjectIds: defaults.lastProjectIds,
            workspaceAgentDefaults: defaults.agentDefaults
        )
    }

    public func write(to store: UserDefaults) {
        store.set(voice.rawValue, forKey: VoiceSettingsKey.voice)
        store.set(speed.rawValue, forKey: VoiceSettingsKey.speed)
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
    /// Bumped when a field changes meaning or type; a payload from another
    /// version is ignored rather than half-read.
    public static let payloadVersion = 1

    private enum Field {
        static let version = "settingsVersion"
        static let changedAt = "changedAt"
        static let voice = "voice"
        static let speed = "speed"
        static let workspaceProvider = "workspaceProviderId"
        static let workspaceProjects = "workspaceProjectIds"
        static let workspaceAgents = "workspaceAgentDefaults"
        static let agent = "agent"
        static let model = "model"
        static let effort = "effort"
    }

    private static let changedAtKey = "deviceSettings.changedAt"

    private let store: UserDefaults
    private let now: () -> Date
    private let publish: ([String: Any]) -> Void
    private var known: DeviceSettingsSnapshot
    private var applying = false
    private var observer: (any NSObjectProtocol)?

    public init(
        store: UserDefaults = .standard,
        now: @escaping () -> Date = Date.init,
        publish: @escaping ([String: Any]) -> Void
    ) {
        self.store = store
        self.now = now
        self.publish = publish
        known = DeviceSettingsSnapshot.read(from: store)
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    /// Begins following the store. A device whose settings were already
    /// changed before it ever synced has no stamp for them; they are stamped
    /// now, so a fresh pair learns them rather than overwriting them with
    /// its own untouched defaults.
    public func start() {
        if changedAt == nil, known != DeviceSettingsSnapshot() {
            changedAt = now()
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
            Field.speed: snapshot.speed.rawValue,
            Field.workspaceProjects: snapshot.workspaceProjectIds,
            Field.workspaceAgents: snapshot.workspaceAgentDefaults.mapValues { selection in
                var fields = [Field.agent: selection.agent, Field.model: selection.model]
                if let effort = selection.effort { fields[Field.effort] = effort }
                return fields
            },
        ]
        if let provider = snapshot.workspaceProviderId {
            payload[Field.workspaceProvider] = provider
        }
        return payload
    }

    /// A voice or pace the vocabulary no longer names falls to the default,
    /// the same answer each app's own controls give an unknown stored value.
    private static func snapshot(from payload: [String: Any]) -> DeviceSettingsSnapshot? {
        guard let voice = payload[Field.voice] as? String,
              let speed = payload[Field.speed] as? String
        else { return nil }
        let agents = (payload[Field.workspaceAgents] as? [String: [String: String]] ?? [:])
            .compactMapValues { fields -> WorkspaceAgentDefault? in
                guard let agent = fields[Field.agent], let model = fields[Field.model] else {
                    return nil
                }
                return WorkspaceAgentDefault(agent: agent, model: model, effort: fields[Field.effort])
            }
        return DeviceSettingsSnapshot(
            voice: RealtimeVoice(rawValue: voice) ?? .default,
            speed: RealtimeVoiceSpeed(rawValue: speed) ?? .default,
            workspaceProviderId: payload[Field.workspaceProvider] as? String,
            workspaceProjectIds: payload[Field.workspaceProjects] as? [String: String] ?? [:],
            workspaceAgentDefaults: agents
        )
    }
}
