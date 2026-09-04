import Foundation
import Observation

/// Counts how Luke's own features are used, and sends nothing else — the
/// desktop's `ProductEventSender` (`packages/analytics/src/sender.ts`)
/// rebuilt for the iOS and watchOS apps, keeping every posture it keeps.
/// Events go to Luke's own `/api/events`, never to an analytics provider, and
/// the batch carries no identity: the service resolves the account from the
/// same bearer token every other hosted call rides, and the one thing named
/// beyond the events is which of Luke's own apps is posting, as a fixed
/// header value the service maps onto an equally fixed `$lib` tag.
///
/// The pipeline is lossy on purpose. Any outcome — accepted, refused,
/// unreachable — drops the batch, and nothing is ever retried: counts
/// undercount on a flaky network in exchange for never retry-storming Luke's
/// own service and never double-counting a day. Signed out, the queue waits
/// rather than being spent against a request that cannot authenticate.
@MainActor
@Observable
public final class ProductEventSender {
    private enum Defaults {
        static let requestTimeout: TimeInterval = 10
        /// A minute between flushes, the desktop's own cadence: long enough
        /// that a launch, a sign-in, and a first observation ride one request
        /// rather than three; short enough that little is lost to a swipe-up.
        static let flushInterval: TimeInterval = 60
        /// How many events wait for a network at most. Past this the oldest
        /// go: a long stretch offline should keep recent behaviour, and the
        /// one event that would hurt to lose — the day marker — is recorded
        /// again the next day anyway.
        static let queueLimit = 200
        /// The wire's own `PRODUCT_EVENT_BATCH_LIMIT`.
        static let batchLimit = 50
    }

    /// Mirrors `PRODUCT_EVENT_CLIENT_HEADER`.
    static let clientHeader = "x-luke-client"

    /// The one discriminator the day marker dedups on.
    private static let dayActiveKey = "day"

    private struct QueuedEvent {
        let event: ProductEvent
        let at: Date
    }

    private let endpoint: URL
    private let appVersion: String
    private let client: ProductEventClient
    /// False makes every record a no-op — the test-run and capture gate, the
    /// desktop's `runMode.sendsNetwork` at this app's one seam.
    private let sends: Bool
    private let session: any AccountTokenProviding
    private let http: HTTPClient
    private let now: () -> Date
    private let flushInterval: TimeInterval
    private let queueLimit: Int

    private var queue: [QueuedEvent] = []
    /// Nested rather than an interpolated key: the name and the discriminator stay apart.
    private var recordedDays: [String: [String: String]] = [:]
    private var armed = false
    private var timer: Timer?
    private var inFlight: Task<Void, Never>?

    public init(
        serviceURL: URL,
        appVersion: String,
        client: ProductEventClient,
        sends: Bool,
        session: any AccountTokenProviding,
        http: HTTPClient = URLSession.shared,
        now: @escaping () -> Date = Date.init,
        flushInterval: TimeInterval? = nil,
        queueLimit: Int? = nil
    ) {
        endpoint = serviceURL.appendingPathComponent("api/events")
        self.appVersion = appVersion
        self.client = client
        self.sends = sends
        self.session = session
        self.http = http
        self.now = now
        self.flushInterval = flushInterval ?? Defaults.flushInterval
        self.queueLimit = queueLimit ?? Defaults.queueLimit
    }

    /// Queues one event. Synchronous and never throws, so an emit site can
    /// sit on any path without ordering itself around it.
    public func record(_ event: ProductEvent) {
        guard allowed else { return }
        queue.append(QueuedEvent(event: event, at: now()))
        if queue.count > queueLimit {
            queue.removeFirst(queue.count - queueLimit)
        }
    }

    /// Marks today active, at most once per UTC day, so days the app was
    /// merely reopened from the switcher still count without a fresh launch.
    public func markDayActive() {
        recordOncePerDay(.appDayActive, discriminator: Self.dayActiveKey)
    }

    /// Queues one event per discriminator per UTC day — one observation per
    /// provider per day is the fact worth having, not a count of refreshes.
    public func recordOncePerDay(_ event: ProductEvent, discriminator: String) {
        guard allowed else { return }
        let today = Self.dayFormatter.string(from: now())
        if recordedDays[event.name]?[discriminator] == today { return }
        recordedDays[event.name, default: [:]][discriminator] = today
        record(event)
    }

    /// Arms counting. The sender comes up disarmed rather than assuming, so
    /// nothing recorded while the app is still standing itself up can be
    /// sent before the launch has decided whether this run counts at all.
    public func arm() {
        armed = true
    }

    /// Starts the timed flush; each tick also marks the day, because an app
    /// left open crosses midnight without relaunching.
    public func start() {
        guard timer == nil else { return }
        let timer = Timer(timeInterval: flushInterval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.markDayActive()
                self.flush()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    public func stop() {
        timer?.invalidate()
        timer = nil
        queue.removeAll()
    }

    /// Sends what is queued, at most one request at a time. Never throws: a
    /// failure is a count nobody has, which is the trade this whole pipeline
    /// makes. A flush called mid-request chains behind it rather than
    /// returning it, because the running request took its batch before this
    /// call's events were queued — and the one caller that awaits a flush,
    /// the sign-out, is exactly the one whose event must not wait for a
    /// token that is about to be cleared. The slot is never cleared, only
    /// replaced: a finished predecessor resolving a successor's chain
    /// instantly costs one held task, where clearing it from inside the task
    /// let a finished predecessor free the slot a successor still held, and
    /// the next flush run beside it.
    @discardableResult
    public func flush() -> Task<Void, Never> {
        let previous = inFlight
        let task = Task {
            if let previous { await previous.value }
            await send()
        }
        inFlight = task
        return task
    }

    private var allowed: Bool {
        sends && armed
    }

    private func send() async {
        guard !queue.isEmpty else { return }
        // Signed out is temporary and nobody's fault, so the queue waits
        // rather than being spent against a request that cannot authenticate.
        guard let token = try? await session.validAccessToken() else { return }
        // Taken only once a request will actually be made, and gone whatever
        // becomes of it.
        let events = Array(queue.prefix(Defaults.batchLimit))
        queue.removeFirst(events.count)
        let status = await post(token: token, events: events)
        if status == 401 {
            guard let refreshed = try? await session.refreshAccessToken(),
                  refreshed != token
            else { return }
            _ = await post(token: refreshed, events: events)
        }
    }

    private func post(token: String, events: [QueuedEvent]) async -> Int? {
        var request = URLRequest(url: endpoint, timeoutInterval: Defaults.requestTimeout)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(client.rawValue, forHTTPHeaderField: Self.clientHeader)
        let body: [String: Any] = ["events": events.map(wireEvent)]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        request.httpBody = data
        guard let (_, response) = try? await http.data(for: request) else { return nil }
        return (response as? HTTPURLResponse)?.statusCode
    }

    private func wireEvent(_ queued: QueuedEvent) -> [String: Any] {
        [
            "name": queued.event.name,
            "at": Int(queued.at.timeIntervalSince1970 * 1000),
            "properties": queued.event.wireProperties(appVersion: appVersion),
        ]
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}
