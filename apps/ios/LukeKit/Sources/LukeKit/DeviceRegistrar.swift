import Foundation

/// This installation's device row on the service. The installation id is
/// minted once and kept in UserDefaults for the life of the install — it is
/// not a credential, only the key that lets a sign-in under another account
/// move the one row instead of leaving a second — and the row's id the service
/// answered sits beside it so a heartbeat can name the row. Every call runs
/// under the account's own token discipline; a failure is left for the next
/// registration or heartbeat rather than retried here, because nothing the
/// user sees waits on it. Every answer is checked against the generation that
/// asked, so a call still out when the account signed out installs nothing.
@MainActor
public final class DeviceRegistrar {
    public enum Key {
        public static let installationId = "device.installationId"
        public static let deviceId = "device.id"
    }

    private let store: UserDefaults
    private let client: DeviceClient
    private let session: any AccountTokenProviding
    private let platform: DevicePlatform
    /// The push address Apple issued this run, carried into every
    /// registration and sent as a change to a row already standing until the
    /// service has acknowledged it once.
    private var push: DevicePushAddress?
    private var pushAcknowledged = false
    /// Bumped by every forget so an answer to a call made under the departing
    /// account installs nothing — the row it names is gone.
    private var generation = 0
    private var task: Task<Void, Never>?

    public init(
        store: UserDefaults = .standard,
        client: DeviceClient,
        session: any AccountTokenProviding,
        platform: DevicePlatform
    ) {
        self.store = store
        self.client = client
        self.session = session
        self.platform = platform
    }

    /// The id this installation registers under, minted on first read and
    /// never again for this store.
    public var installationId: String {
        if let stored = store.string(forKey: Key.installationId)?.lowercased(),
           DeviceClient.isWireId(stored)
        {
            return stored
        }
        let minted = UUID().uuidString.lowercased()
        store.set(minted, forKey: Key.installationId)
        return minted
    }

    /// The row's id as the service last answered it, or nil before a registration lands.
    public var deviceId: String? {
        guard let stored = store.string(forKey: Key.deviceId)?.lowercased(),
              DeviceClient.isWireId(stored)
        else { return nil }
        return stored
    }

    /// Registers this installation under the signed-in account, carrying the
    /// push address if one has arrived. Idempotent: the service re-keys the
    /// one row, so a registration repeated at every sign-in edge is the point.
    @discardableResult
    public func register() -> Task<Void, Never> {
        enqueue { await self.registerNow() }
    }

    /// Moves the row's last-seen instant, carrying a push address the service
    /// has not yet acknowledged, and registers again when the service no
    /// longer holds the row or none was ever registered.
    @discardableResult
    public func heartbeat() -> Task<Void, Never> {
        enqueue { await self.heartbeatNow() }
    }

    /// Carries the token Apple issued to the row: as a change when one is
    /// already registered, and with every registration until acknowledged.
    public func pushTokenDidArrive(_ token: Data, environment: PushEnvironment) {
        let address = DevicePushAddress(token: DeviceClient.hexToken(token), environment: environment)
        guard address != push else { return }
        push = address
        pushAcknowledged = false
        enqueue { await self.heartbeatNow() }
    }

    /// Forgets the row on the departing account's own token, handed in because
    /// the session has already let go of it. The generation moves at once, so
    /// a register or heartbeat already under way installs nothing, and the
    /// stored row id goes now: the account is leaving whether or not the
    /// service hears, and a row it still holds is re-keyed by the next
    /// registration. The delete does not wait for standing work — a register
    /// waiting on a token refresh that is itself signing out would have the
    /// sign-out waiting on this forget, and this forget on it — but
    /// everything queued after it waits for both, so a registration already on
    /// the wire lands before the next account's rather than after it, where it
    /// would move the row back.
    @discardableResult
    public func forget(accessToken: String) -> Task<Void, Never> {
        generation += 1
        pushAcknowledged = false
        let deviceId = deviceId
        store.removeObject(forKey: Key.deviceId)
        let forgetting = Task { @MainActor in
            guard let deviceId else { return }
            _ = try? await self.client.forget(deviceId: deviceId, accessToken: accessToken)
        }
        let standing = task
        task = Task { @MainActor in
            await standing?.value
            await forgetting.value
        }
        return forgetting
    }

    private func registerNow() async {
        guard session.accountEmail != nil else { return }
        let generation = generation
        let installationId = installationId
        let push = push
        do {
            let deviceId = try await session.authorized {
                try await self.client.register(
                    platform: self.platform,
                    installationId: installationId,
                    push: push,
                    accessToken: $0
                )
            }
            guard generation == self.generation else { return }
            store.set(deviceId, forKey: Key.deviceId)
            if push != nil, push == self.push { pushAcknowledged = true }
        } catch {}
    }

    private func heartbeatNow() async {
        guard let deviceId else {
            await registerNow()
            return
        }
        let generation = generation
        let push = push
        let change: PushTokenChange = if let push, !pushAcknowledged { .replaced(push) } else { .unchanged }
        do {
            let seen = try await session.authorized {
                try await self.client.heartbeat(deviceId: deviceId, pushToken: change, accessToken: $0)
            }
            guard generation == self.generation else { return }
            if !seen {
                await registerNow()
                return
            }
            if case .replaced = change, push == self.push { pushAcknowledged = true }
        } catch {}
    }

    /// One call at a time, in order, so a heartbeat cannot overtake the
    /// registration whose row id it needs and a registration cannot overtake
    /// the forget before it. Work queued under an account that has since
    /// signed out finds no token, or answers into a generation that has
    /// moved, and does nothing.
    private func enqueue(_ work: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
        let previous = task
        let next = Task { @MainActor in
            await previous?.value
            await work()
        }
        task = next
        return next
    }
}
