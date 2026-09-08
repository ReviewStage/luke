import Foundation

/// Mirrors the phone's cross-device preferences into the signed-in Luke account.
/// The watch still gets the same choices through WatchConnectivity; only the
/// phone talks to the hosted service, because it owns the account session.
@MainActor
public final class AccountPreferencesSync {
    private let store: UserDefaults
    private let client: AccountPreferencesClient
    private let session: any AccountTokenProviding
    private var known: DeviceSettingsSnapshot
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
        enqueue { await self.reconcileNow() }
    }

    @discardableResult
    public func publishCurrent() -> Task<Void, Never> {
        enqueue { await self.push(DeviceSettingsSnapshot.read(from: self.store)) }
    }

    private func reconcileNow() async {
        guard let account = session.accountEmail else { return }
        let localBeforeRead = DeviceSettingsSnapshot.read(from: store)
        let answer: AccountPreferencesAnswer
        do {
            answer = try await authorized { try await self.client.readPreferences(accessToken: $0) }
        } catch {
            return
        }
        guard session.accountEmail == account else { return }
        let localAfterRead = DeviceSettingsSnapshot.read(from: store)
        if answer.updatedAt == nil {
            guard localAfterRead != DeviceSettingsSnapshot() else { return }
            await push(localAfterRead)
            return
        }
        guard localAfterRead == localBeforeRead else { return }
        apply(answer.preferences)
    }

    private func noteLocalChange() {
        guard !applying else { return }
        let current = DeviceSettingsSnapshot.read(from: store)
        guard current != known else { return }
        known = current
        enqueue { await self.push(current) }
    }

    private func push(_ snapshot: DeviceSettingsSnapshot) async {
        guard let account = session.accountEmail else { return }
        do {
            let answer = try await authorized {
                try await self.client.writePreferences(snapshot, accessToken: $0)
            }
            guard session.accountEmail == account else { return }
            known = answer.preferences
        } catch {
            return
        }
    }

    private func apply(_ snapshot: DeviceSettingsSnapshot) {
        guard snapshot != known else { return }
        known = snapshot
        applying = true
        snapshot.write(to: store)
        applying = false
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
