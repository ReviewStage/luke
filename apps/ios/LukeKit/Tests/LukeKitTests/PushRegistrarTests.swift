import Foundation
import XCTest

@testable import LukeKit

private let serviceURL = URL(string: "https://tryluke.dev")!
private let token = String(repeating: "0b", count: 32)

@MainActor
private final class StubAccount: AccountTokenProviding {
    var accountEmail: String?
    var refreshes = 0

    init(accountEmail: String?) {
        self.accountEmail = accountEmail
    }

    func validAccessToken() async throws -> String {
        guard accountEmail != nil else { throw AccountSessionError.signedOut }
        return "at-\(accountEmail ?? "")"
    }

    func refreshAccessToken() async throws -> String {
        refreshes += 1
        return "fresh-\(accountEmail ?? "")"
    }
}

/// Records every call the registrar makes, in order, as method and bearer,
/// and answers each with the next scripted status (200 once the script runs out).
private final class Recorder: @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [String] = []
    private var statuses: [Int] = []

    var calls: [String] {
        lock.withLock { recorded }
    }

    func script(_ statuses: [Int]) {
        lock.withLock { self.statuses = statuses }
    }

    private func record(_ request: URLRequest) -> Int {
        lock.withLock {
            let bearer = request.value(forHTTPHeaderField: "Authorization") ?? ""
            recorded.append("\(request.httpMethod ?? "") \(bearer)")
            return statuses.isEmpty ? 200 : statuses.removeFirst()
        }
    }

    private static func answer(_ request: URLRequest, status: Int) throws -> (Data, URLResponse) {
        let body: [String: Any]
        if status != 200 {
            body = ["error": "invalid-token"]
        } else if request.httpMethod == "DELETE" {
            body = ["deleted": true]
        } else {
            body = ["stored": true]
        }
        let data = try JSONSerialization.data(withJSONObject: body)
        let response = HTTPURLResponse(
            url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil
        )!
        return (data, response)
    }

    func client() -> DeviceClient {
        let recorder = self
        let stub = StubHTTPClient { request in
            try Recorder.answer(request, status: recorder.record(request))
        }
        return DeviceClient(baseURL: serviceURL, http: stub)
    }
}

@MainActor
final class PushRegistrarTests: XCTestCase {
    func testATokenArrivingWhileSignedInRegistersAtOnce() async {
        let recorder = Recorder()
        let account = StubAccount(accountEmail: "dev@example.com")
        let registrar = PushRegistrar(client: recorder.client(), session: account)

        await registrar.tokenArrived(token, environment: .sandbox)

        XCTAssertEqual(recorder.calls, ["POST Bearer at-dev@example.com"])
        XCTAssertEqual(registrar.registeredAccount, "dev@example.com")
        XCTAssertEqual(registrar.held, .init(token: token, environment: .sandbox))
    }

    func testATokenArrivingSignedOutWaitsForTheSignIn() async {
        let recorder = Recorder()
        let account = StubAccount(accountEmail: nil)
        let registrar = PushRegistrar(client: recorder.client(), session: account)

        await registrar.tokenArrived(token, environment: .production)
        XCTAssertEqual(recorder.calls, [])
        XCTAssertNil(registrar.registeredAccount)

        account.accountEmail = "dev@example.com"
        await registrar.accountSignedIn()
        XCTAssertEqual(recorder.calls, ["POST Bearer at-dev@example.com"])
        XCTAssertEqual(registrar.registeredAccount, "dev@example.com")
    }

    func testASignInWithNoTokenYetRegistersNothing() async {
        let recorder = Recorder()
        let registrar = PushRegistrar(
            client: recorder.client(), session: StubAccount(accountEmail: "dev@example.com")
        )
        await registrar.accountSignedIn()
        XCTAssertEqual(recorder.calls, [])
    }

    func testTheSameAccountAndTokenRegisterOnce() async {
        let recorder = Recorder()
        let account = StubAccount(accountEmail: "dev@example.com")
        let registrar = PushRegistrar(client: recorder.client(), session: account)

        await registrar.tokenArrived(token, environment: .sandbox)
        await registrar.accountSignedIn()
        await registrar.tokenArrived(token, environment: .sandbox)
        XCTAssertEqual(recorder.calls.count, 1)

        await registrar.tokenArrived(String(repeating: "0c", count: 32), environment: .sandbox)
        XCTAssertEqual(recorder.calls.count, 2)
    }

    func testSignOutUnregistersUnderTheLeavingAccountAndKeepsTheToken() async {
        let recorder = Recorder()
        let account = StubAccount(accountEmail: "one@example.com")
        let registrar = PushRegistrar(client: recorder.client(), session: account)
        await registrar.tokenArrived(token, environment: .sandbox)

        await registrar.unregister()
        XCTAssertEqual(recorder.calls, ["POST Bearer at-one@example.com", "DELETE Bearer at-one@example.com"])
        XCTAssertNil(registrar.registeredAccount)
        XCTAssertEqual(registrar.held?.token, token)

        account.accountEmail = "two@example.com"
        await registrar.accountSignedIn()
        XCTAssertEqual(recorder.calls.last, "POST Bearer at-two@example.com")
        XCTAssertEqual(registrar.registeredAccount, "two@example.com")
    }

    func testARefusedBearerIsRefreshedAndRetriedOnce() async {
        let recorder = Recorder()
        recorder.script([401])
        let account = StubAccount(accountEmail: "dev@example.com")
        let registrar = PushRegistrar(client: recorder.client(), session: account)

        await registrar.tokenArrived(token, environment: .sandbox)

        XCTAssertEqual(recorder.calls, ["POST Bearer at-dev@example.com", "POST Bearer fresh-dev@example.com"])
        XCTAssertEqual(account.refreshes, 1)
        XCTAssertEqual(registrar.registeredAccount, "dev@example.com")
    }

    func testAFailedRegistrationIsRememberedAndRetriedNextEdge() async {
        let recorder = Recorder()
        recorder.script([503])
        let account = StubAccount(accountEmail: "dev@example.com")
        let registrar = PushRegistrar(client: recorder.client(), session: account)

        await registrar.tokenArrived(token, environment: .sandbox)
        XCTAssertNil(registrar.registeredAccount)
        XCTAssertNotNil(registrar.lastError)

        await registrar.accountSignedIn()
        XCTAssertEqual(registrar.registeredAccount, "dev@example.com")
        XCTAssertNil(registrar.lastError)
    }
}
