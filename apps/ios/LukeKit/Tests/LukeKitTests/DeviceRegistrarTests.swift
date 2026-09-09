import Foundation
import XCTest

@testable import LukeKit

private func makeResponse(url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

private func jsonData(_ dict: [String: Any]) -> Data {
    try! JSONSerialization.data(withJSONObject: dict)
}

private let deviceId = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
private let otherDeviceId = "9b2e5c1a-3d4f-4a6b-8c7d-0e1f2a3b4c5d"

@MainActor
private final class RegistrarTokenSource: AccountTokenProviding {
    var accountEmail: String? = "user@example.com"
    var token: String? = "at-1"
    var refreshedToken: String? = "at-2"
    var refreshes = 0
    /// What a refresh does before it answers: the real session signs out on a
    /// refresh the server rejects, and that sign-out forgets the device.
    var onRefresh: (@MainActor () async -> Void)?

    func validAccessToken() async throws -> String {
        guard let token else { throw AccountSessionError.signedOut }
        return token
    }

    func refreshAccessToken() async throws -> String {
        refreshes += 1
        await onRefresh?()
        guard let refreshedToken else { throw AccountSessionError.signedOut }
        token = refreshedToken
        return refreshedToken
    }
}

/// Records every request in order and answers each from a script, so a test
/// can read what traveled and in what order.
private final class RecordingHTTP: HTTPClient, @unchecked Sendable {
    struct Sent {
        let method: String
        let body: [String: Any]
        let token: String?
    }

    private let lock = NSLock()
    private var answers: [(Int, [String: Any])]
    private(set) var sent: [Sent] = []

    init(answers: [(Int, [String: Any])]) {
        self.answers = answers
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        lock.lock()
        defer { lock.unlock() }
        let body = (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]) ?? [:]
        sent.append(Sent(
            method: request.httpMethod ?? "",
            body: body,
            token: request.value(forHTTPHeaderField: "Authorization")
        ))
        let (status, json) = answers.isEmpty ? (500, [:]) : answers.removeFirst()
        return (jsonData(json), makeResponse(url: request.url!, status: status))
    }
}

/// Records like `RecordingHTTP`, but holds every request at the network until
/// the test opens the gate, so a call can be caught in flight.
private final class GatedHTTP: HTTPClient, @unchecked Sendable {
    private let lock = NSLock()
    private var answers: [(Int, [String: Any])]
    private var opened = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private(set) var sent: [RecordingHTTP.Sent] = []

    init(answers: [(Int, [String: Any])]) {
        self.answers = answers
    }

    var waiting: Int {
        lock.lock()
        defer { lock.unlock() }
        return waiters.count
    }

    func open() {
        lock.lock()
        opened = true
        let released = waiters
        waiters = []
        lock.unlock()
        for waiter in released { waiter.resume() }
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let body = (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]) ?? [:]
        lock.lock()
        sent.append(RecordingHTTP.Sent(
            method: request.httpMethod ?? "",
            body: body,
            token: request.value(forHTTPHeaderField: "Authorization")
        ))
        lock.unlock()
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            lock.lock()
            if opened {
                lock.unlock()
                continuation.resume()
            } else {
                waiters.append(continuation)
                lock.unlock()
            }
        }
        lock.lock()
        let (status, json) = answers.isEmpty ? (500, [:]) : answers.removeFirst()
        lock.unlock()
        return (jsonData(json), makeResponse(url: request.url!, status: status))
    }
}

@MainActor
final class DeviceRegistrarTests: XCTestCase {
    private var suites: [String] = []
    private let base = URL(string: "https://tryluke.dev")!

    override func tearDown() {
        for suite in suites { UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite) }
        super.tearDown()
    }

    private func makeStore() -> UserDefaults {
        let suite = "device-registrar-tests-\(UUID().uuidString)"
        suites.append(suite)
        return UserDefaults(suiteName: suite)!
    }

    private func registrar(
        store: UserDefaults,
        http: RecordingHTTP,
        session: RegistrarTokenSource = RegistrarTokenSource(),
        platform: DevicePlatform = .iOS
    ) -> DeviceRegistrar {
        DeviceRegistrar(
            store: store,
            client: DeviceClient(baseURL: base, http: http),
            session: session,
            platform: platform
        )
    }

    func testInstallationIdIsMintedOnceAndKept() {
        let store = makeStore()
        let http = RecordingHTTP(answers: [])
        let first = registrar(store: store, http: http).installationId
        XCTAssertTrue(DeviceClient.isWireId(first))
        XCTAssertEqual(registrar(store: store, http: http).installationId, first)
        XCTAssertEqual(store.string(forKey: DeviceRegistrar.Key.installationId), first)
    }

    func testRegisterSendsThePlatformAndInstallationAndKeepsTheRowId() async {
        let store = makeStore()
        let http = RecordingHTTP(answers: [(200, ["deviceId": deviceId])])
        let subject = registrar(store: store, http: http, platform: .watchOS)

        await subject.register().value

        XCTAssertEqual(http.sent.count, 1)
        XCTAssertEqual(http.sent[0].method, "POST")
        XCTAssertEqual(http.sent[0].token, "Bearer at-1")
        XCTAssertEqual(http.sent[0].body["platform"] as? String, "watchos")
        XCTAssertEqual(http.sent[0].body["installationId"] as? String, subject.installationId)
        XCTAssertNil(http.sent[0].body["pushToken"])
        XCTAssertEqual(subject.deviceId, deviceId)
    }

    func testRegisterRefreshesOnceOnAnUnauthorizedAnswer() async {
        let store = makeStore()
        let session = RegistrarTokenSource()
        let http = RecordingHTTP(answers: [
            (401, ["error": "invalid-token"]),
            (200, ["deviceId": deviceId]),
        ])
        let subject = registrar(store: store, http: http, session: session)

        await subject.register().value

        XCTAssertEqual(session.refreshes, 1)
        XCTAssertEqual(http.sent.map(\.token), ["Bearer at-1", "Bearer at-2"])
        XCTAssertEqual(subject.deviceId, deviceId)
    }

    func testSignedOutSessionRegistersNothing() async {
        let store = makeStore()
        let session = RegistrarTokenSource()
        session.accountEmail = nil
        let http = RecordingHTTP(answers: [(200, ["deviceId": deviceId])])
        let subject = registrar(store: store, http: http, session: session)

        await subject.register().value

        XCTAssertEqual(http.sent.count, 0)
        XCTAssertNil(subject.deviceId)
    }

    func testHeartbeatNamesTheRowAndRegistersAgainWhenItIsGone() async {
        let store = makeStore()
        let http = RecordingHTTP(answers: [
            (200, ["deviceId": deviceId]),
            (200, ["seen": true]),
            (200, ["seen": false]),
            (200, ["deviceId": otherDeviceId]),
        ])
        let subject = registrar(store: store, http: http)

        await subject.register().value
        await subject.heartbeat().value
        XCTAssertEqual(http.sent[1].method, "PUT")
        XCTAssertEqual(http.sent[1].body["deviceId"] as? String, deviceId)
        XCTAssertEqual(http.sent[1].body.keys.sorted(), ["deviceId"])

        await subject.heartbeat().value
        XCTAssertEqual(http.sent.map(\.method), ["POST", "PUT", "PUT", "POST"])
        XCTAssertEqual(subject.deviceId, otherDeviceId)
    }

    func testHeartbeatWithoutARowRegistersInstead() async {
        let store = makeStore()
        let http = RecordingHTTP(answers: [(200, ["deviceId": deviceId])])
        let subject = registrar(store: store, http: http)

        await subject.heartbeat().value

        XCTAssertEqual(http.sent.map(\.method), ["POST"])
        XCTAssertEqual(subject.deviceId, deviceId)
    }

    func testAPushTokenArrivingLaterTravelsAsAChangeAndWithEveryRegistration() async {
        let store = makeStore()
        let http = RecordingHTTP(answers: [
            (200, ["deviceId": deviceId]),
            (200, ["seen": true]),
            (200, ["seen": true]),
            (200, ["deviceId": deviceId]),
        ])
        let subject = registrar(store: store, http: http)
        await subject.register().value

        subject.pushTokenDidArrive(Data(repeating: 0xab, count: 32), environment: .sandbox)
        subject.pushTokenDidArrive(Data(repeating: 0xab, count: 32), environment: .sandbox)
        await subject.heartbeat().value
        XCTAssertEqual(http.sent.map(\.method), ["POST", "PUT", "PUT"])
        XCTAssertEqual(http.sent[1].body["pushToken"] as? String, String(repeating: "ab", count: 32))
        XCTAssertEqual(http.sent[1].body["pushEnvironment"] as? String, "sandbox")
        XCTAssertEqual(http.sent[2].body.keys.sorted(), ["deviceId"], "an acknowledged token is not resent")

        await subject.register().value
        XCTAssertEqual(http.sent[3].body["pushToken"] as? String, String(repeating: "ab", count: 32))
        XCTAssertEqual(http.sent[3].body["pushEnvironment"] as? String, "sandbox")
    }

    func testAPushTokenTheServiceNeverAcknowledgedRidesTheNextHeartbeat() async {
        let store = makeStore()
        let http = RecordingHTTP(answers: [
            (200, ["deviceId": deviceId]),
            (500, [:]),
            (200, ["seen": true]),
            (200, ["seen": true]),
        ])
        let subject = registrar(store: store, http: http)
        await subject.register().value
        subject.pushTokenDidArrive(Data(repeating: 0xcd, count: 32), environment: .production)
        await subject.heartbeat().value
        await subject.heartbeat().value

        XCTAssertEqual(http.sent.map(\.method), ["POST", "PUT", "PUT", "PUT"])
        XCTAssertEqual(http.sent[2].body["pushToken"] as? String, String(repeating: "cd", count: 32))
        XCTAssertEqual(http.sent[3].body.keys.sorted(), ["deviceId"])
    }

    func testARegistrationStillOutAtSignOutInstallsNothing() async {
        let store = makeStore()
        let http = GatedHTTP(answers: [(200, ["deviceId": deviceId])])
        let subject = registrar(store: store, http: http)

        let registering = subject.register()
        while http.waiting == 0 { await Task.yield() }
        let forgetting = subject.forget(accessToken: "departing")
        http.open()
        await registering.value
        await forgetting.value

        XCTAssertNil(subject.deviceId, "the row the late answer names was let go of at sign-out")
        XCTAssertEqual(http.sent.map(\.method), ["POST"], "nothing was registered, so nothing was forgotten")
    }

    func testASignOutFromInsideARefreshTheRegisterIsWaitingOnDoesNotDeadlock() async {
        let store = makeStore()
        let session = RegistrarTokenSource()
        let http = RecordingHTTP(answers: [
            (200, ["deviceId": deviceId]),
            (401, ["error": "invalid-token"]),
            (200, ["deleted": true]),
        ])
        let subject = registrar(store: store, http: http, session: session)
        await subject.register().value

        session.refreshedToken = nil
        session.onRefresh = {
            session.accountEmail = nil
            session.token = nil
            await subject.forget(accessToken: "departing").value
        }
        await subject.heartbeat().value

        XCTAssertEqual(http.sent.map(\.method), ["POST", "PUT", "DELETE"])
        XCTAssertEqual(http.sent[2].token, "Bearer departing")
        XCTAssertNil(subject.deviceId)
    }

    func testARegisterAskedRightAfterAForgetRunsBehindIt() async {
        let store = makeStore()
        let http = RecordingHTTP(answers: [
            (200, ["deviceId": deviceId]),
            (200, ["deleted": true]),
            (200, ["deviceId": otherDeviceId]),
        ])
        let subject = registrar(store: store, http: http)
        await subject.register().value

        subject.forget(accessToken: "departing")
        await subject.register().value

        XCTAssertEqual(http.sent.map(\.method), ["POST", "DELETE", "POST"])
        XCTAssertEqual(http.sent[1].token, "Bearer departing")
        XCTAssertEqual(subject.deviceId, otherDeviceId, "the row the new sign-in registered stands")
    }

    func testForgetUsesTheDepartingTokenAndDropsTheRowIdFirst() async {
        let store = makeStore()
        let http = RecordingHTTP(answers: [
            (200, ["deviceId": deviceId]),
            (200, ["deleted": true]),
        ])
        let subject = registrar(store: store, http: http)
        await subject.register().value

        await subject.forget(accessToken: "departing").value

        XCTAssertEqual(http.sent[1].method, "DELETE")
        XCTAssertEqual(http.sent[1].token, "Bearer departing")
        XCTAssertEqual(http.sent[1].body["deviceId"] as? String, deviceId)
        XCTAssertNil(subject.deviceId)
        XCTAssertTrue(DeviceClient.isWireId(subject.installationId))

        await subject.forget(accessToken: "departing").value
        XCTAssertEqual(http.sent.count, 2, "nothing to forget sends nothing")
    }
}
