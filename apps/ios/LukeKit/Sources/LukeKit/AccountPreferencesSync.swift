import Foundation

/// Mirrors the phone's cross-device preferences into the signed-in Luke account.
/// The watch still gets the same choices through WatchConnectivity; only the
/// phone talks to the hosted service, because it owns the account session.
@MainActor
public final class AccountPreferencesSync {
    private enum Key {
        static let baseline = "accountPreferences.syncBaseline"
        static let accountEmail = "accountEmail"
        static let preferences = "preferences"
    }

    private let store: UserDefaults
    private let client: AccountPreferencesClient
    private let session: any AccountTokenProviding
    private var known: DeviceSettingsSnapshot
    private var hydratedAccount: String?
    private var applying = false
    private var observer: (any NSObjectProtocol)?
    private var task: Task<Void, Never>?

    public init(
        store: UserDefaults = .standard,
        client: AccountPreferencesClient,
        session: any AccountTokenProviding
    ) {
        self.store = store
        self.client = client
        self.session = session
        known = DeviceSettingsSnapshot.read(from: store)
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        task?.cancel()
    }

    public func start() {
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

    @discardableResult
    public func reconcile() -> Task<Void, Never> {
        enqueue { _ = await self.reconcileNow() }
    }

    public func clearAccountPreferences() {
        task?.cancel()
        task = nil
        hydratedAccount = nil
        clearBaseline()
        known = DeviceSettingsSnapshot()
        applying = true
        known.write(to: store)
        applying = false
    }

    @discardableResult
    private func reconcileNow() async -> Bool {
        guard let account = session.accountEmail else { return false }
        let baseline = hydrationBaseline(for: account)
        let answer: AccountPreferencesAnswer
        do {
            answer = try await authorized { try await self.client.readPreferences(accessToken: $0) }
        } catch {
            return false
        }
        guard session.accountEmail == account else { return false }
        let local = DeviceSettingsSnapshot.read(from: store)
        if !answer.hasStoredSnapshot {
            if local != DeviceSettingsSnapshot(),
               !(await write(local, account: account))
            {
                return false
            }
            setBaseline(local, for: account)
            hydratedAccount = account
            return true
        }
        let merged = answer.preferences.mergingLocalChanges(current: local, expected: baseline)
        apply(merged)
        guard session.accountEmail == account else { return false }
        hydratedAccount = account
        guard merged != answer.preferences else {
            setBaseline(merged, for: account)
            return true
        }
        if await write(merged, account: account) {
            setBaseline(merged, for: account)
        }
        return true
    }

    private func noteLocalChange() {
        guard !applying else { return }
        let current = DeviceSettingsSnapshot.read(from: store)
        guard current != known else { return }
        known = current
        enqueue { await self.push() }
    }

    private func push() async {
        guard let account = session.accountEmail else { return }
        if hydratedAccount != account, !(await reconcileNow()) {
            return
        }
        let snapshot = DeviceSettingsSnapshot.read(from: store)
        guard session.accountEmail == account, hydratedAccount == account else { return }
        if await write(snapshot, account: account) {
            setBaseline(snapshot, for: account)
        }
    }

    private func apply(_ snapshot: DeviceSettingsSnapshot) {
        guard snapshot != known else { return }
        known = snapshot
        applying = true
        snapshot.write(to: store)
        applying = false
    }

    private func write(_ snapshot: DeviceSettingsSnapshot, account: String) async -> Bool {
        do {
            let answer = try await authorized {
                try await self.client.writePreferences(snapshot, accessToken: $0)
            }
            guard session.accountEmail == account else { return false }
            known = answer.preferences
            return true
        } catch {
            return false
        }
    }

    private func hydrationBaseline(for account: String) -> DeviceSettingsSnapshot {
        if let baseline = storedBaseline(for: account) { return baseline }
        let snapshot = DeviceSettingsSnapshot.read(from: store)
        setBaseline(snapshot, for: account)
        return snapshot
    }

    private func storedBaseline(for account: String) -> DeviceSettingsSnapshot? {
        guard let record = store.dictionary(forKey: Key.baseline),
              record[Key.accountEmail] as? String == account,
              let preferences = record[Key.preferences] as? [String: Any]
        else { return nil }
        return DeviceSettingsSnapshot(accountPreferencesWire: preferences)
    }

    private func setBaseline(_ snapshot: DeviceSettingsSnapshot, for account: String) {
        store.set(
            [
                Key.accountEmail: account,
                Key.preferences: snapshot.accountPreferencesWire,
            ],
            forKey: Key.baseline
        )
    }

    private func clearBaseline() {
        store.removeObject(forKey: Key.baseline)
    }

    @discardableResult
    private func enqueue(_ work: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
        let previous = task
        let next = Task { @MainActor in
            await previous?.value
            if Task.isCancelled { return }
            await work()
        }
        task = next
        return next
    }

    private func authorized<T>(_ call: (String) async throws -> T) async throws -> T {
        guard let account = session.accountEmail else { throw AccountSessionError.signedOut }
        let token = try await session.validAccessToken()
        guard session.accountEmail == account else { throw AccountSessionError.signedOut }
        do {
            return try await call(token)
        } catch AccountPreferencesClientError.serverError(let status, _) where status == 401 {
            guard session.accountEmail == account else { throw AccountSessionError.signedOut }
            let refreshed = try await session.refreshAccessToken()
            guard session.accountEmail == account else { throw AccountSessionError.signedOut }
            return try await call(refreshed)
        }
    }
}

private extension DeviceSettingsSnapshot {
    func mergingLocalChanges(
        current: DeviceSettingsSnapshot,
        expected: DeviceSettingsSnapshot
    ) -> DeviceSettingsSnapshot {
        DeviceSettingsSnapshot(
            voice: current.voice == expected.voice ? voice : current.voice,
            speed: current.speed == expected.speed ? speed : current.speed,
            workspaceProviderId: current.workspaceProviderId == expected.workspaceProviderId
                ? workspaceProviderId
                : current.workspaceProviderId,
            workspaceProjectIds: Self.merging(
                remote: workspaceProjectIds,
                current: current.workspaceProjectIds,
                expected: expected.workspaceProjectIds
            ),
            workspaceAgentDefaults: Self.merging(
                remote: workspaceAgentDefaults,
                current: current.workspaceAgentDefaults,
                expected: expected.workspaceAgentDefaults
            )
        )
    }

    private static func merging<Value: Equatable>(
        remote: [String: Value],
        current: [String: Value],
        expected: [String: Value]
    ) -> [String: Value] {
        var merged = remote
        for key in Set(current.keys).union(expected.keys) where current[key] != expected[key] {
            merged[key] = current[key]
        }
        return merged
    }
}
