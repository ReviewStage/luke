import Foundation
import XCTest

@testable import LukeKit

private func makeResponse(url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

private func jsonData(_ dict: [String: Any]) -> Data {
    try! JSONSerialization.data(withJSONObject: dict)
}

@MainActor
private final class StubTokenSource: AccountTokenProviding {
    var accountEmail: String?
    private let valid: String
    private let refreshed: String
    private(set) var refreshCalls = 0

    init(email: String? = "dev@example.com", valid: String = "at-1", refreshed: String = "at-2") {
        accountEmail = email
        self.valid = valid
        self.refreshed = refreshed
    }

    func validAccessToken() async throws -> String { valid }

    func refreshAccessToken() async throws -> String {
        refreshCalls += 1
        return refreshed
    }
}

private actor CallCounter {
    private(set) var calls = 0

    func next() -> Int {
        calls += 1
        return calls
    }
}

/// Holds a stubbed answer open until the test releases it, so a response can
/// be made to arrive after acts that started later.
private actor Gate {
    private var opened = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func open() {
        opened = true
        for waiter in waiters { waiter.resume() }
        waiters = []
    }

    func wait() async {
        if opened { return }
        await withCheckedContinuation { waiters.append($0) }
    }
}

@MainActor
final class VaultStoreTests: XCTestCase {
    private let base = URL(string: "https://tryluke.dev")!

    /// The two failures need different words: a local sign-out and a server
    /// that refuses a freshly refreshed token have different ways out, and
    /// one sentence for both once cost a live debugging session.
    func testATokenRefusalReadsDifferentlyFromASignOut() {
        let signedOut = VaultStore.message(for: AccountSessionError.signedOut)
        let refused = VaultStore.message(
            for: VaultClientError.serverError(status: 401, apiError: .invalidToken)
        )
        XCTAssertNotEqual(signedOut, refused)
        XCTAssertTrue(refused.contains("token"))
    }

    func testRefusedTokenRefreshesOnceAndRetries() async {
        let counter = CallCounter()
        let stub = StubHTTPClient { request in
            if await counter.next() == 1 {
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer at-stale")
                return (
                    jsonData(["error": "invalid-token"]),
                    makeResponse(url: request.url!, status: 401)
                )
            }
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer at-fresh")
            return (jsonData(["keys": []]), makeResponse(url: request.url!, status: 200))
        }
        let source = StubTokenSource(valid: "at-stale", refreshed: "at-fresh")
        let store = VaultStore(client: VaultClient(baseURL: base, http: stub), session: source)
        await store.load()
        XCTAssertNil(store.loadError)
        XCTAssertEqual(source.refreshCalls, 1)
    }

    func testEntriesAnswerOnlyUnderTheirAccount() async {
        let stub = StubHTTPClient { request in
            let payload: [String: Any] = [
                "keys": [["providerId": "conductor", "updatedAt": 1000]],
            ]
            return (jsonData(payload), makeResponse(url: request.url!, status: 200))
        }
        let source = StubTokenSource(email: "first@example.com")
        let store = VaultStore(client: VaultClient(baseURL: base, http: stub), session: source)
        await store.load()
        XCTAssertNotNil(store.entry(for: .conductor))

        source.accountEmail = "second@example.com"
        XCTAssertNil(store.entry(for: .conductor))

        source.accountEmail = nil
        XCTAssertNil(store.entry(for: .conductor))
    }

    func testARetryNeverActsForADifferentAccount() async throws {
        let gate = Gate()
        let counter = CallCounter()
        let stub = StubHTTPClient { request in
            // The store request: held open until the account below has changed
            // hands, then refused, which is where a retry would fire.
            _ = await counter.next()
            await gate.wait()
            return (
                jsonData(["error": "invalid-token"]),
                makeResponse(url: request.url!, status: 401)
            )
        }
        let source = StubTokenSource(email: "first@example.com")
        let store = VaultStore(client: VaultClient(baseURL: base, http: stub), session: source)

        let save = Task { try await store.store(key: "sk-abcd", for: .conductor) }
        while await counter.calls < 1 { await Task.yield() }
        source.accountEmail = "second@example.com"
        await gate.open()

        do {
            try await save.value
            XCTFail("Expected throw")
        } catch AccountSessionError.signedOut {
            // expected: the act refuses rather than replaying under the new account
        } catch {
            XCTFail("Unexpected: \(error)")
        }
        XCTAssertEqual(source.refreshCalls, 0)
        XCTAssertNil(store.entry(for: .conductor))
    }

    func testASaveFinishingUnderANewAccountTouchesNothing() async throws {
        let gate = Gate()
        let counter = CallCounter()
        let stub = StubHTTPClient { request in
            switch await counter.next() {
            case 1:
                // The first account's store request: held open until the
                // account has changed hands and the new account's list landed.
                await gate.wait()
                return (jsonData(["stored": true]), makeResponse(url: request.url!, status: 200))
            default:
                return (jsonData(["keys": []]), makeResponse(url: request.url!, status: 200))
            }
        }
        let source = StubTokenSource(email: "first@example.com")
        let store = VaultStore(client: VaultClient(baseURL: base, http: stub), session: source)

        let save = Task { try await store.store(key: "sk-abcd", for: .conductor) }
        while await counter.calls < 1 { await Task.yield() }

        source.accountEmail = "second@example.com"
        await store.load()
        await gate.open()
        try await save.value

        // The first account's delivered act must not install an entry into
        // the second account's visible list.
        XCTAssertNil(store.entry(for: .conductor))
    }

    func testSuccessfulActClearsAStaleLoadError() async throws {
        let counter = CallCounter()
        let stub = StubHTTPClient { request in
            switch await counter.next() {
            case 1:
                return (
                    jsonData(["error": "upstream-error"]),
                    makeResponse(url: request.url!, status: 502)
                )
            case 2:
                return (jsonData(["stored": true]), makeResponse(url: request.url!, status: 200))
            default:
                let payload: [String: Any] = [
                    "keys": [["providerId": "conductor", "updatedAt": 1000]],
                ]
                return (jsonData(payload), makeResponse(url: request.url!, status: 200))
            }
        }
        let source = StubTokenSource()
        let store = VaultStore(client: VaultClient(baseURL: base, http: stub), session: source)

        await store.load()
        XCTAssertNotNil(store.loadError)

        try await store.store(key: "sk-k123", for: .conductor)
        XCTAssertNil(store.loadError)
        XCTAssertNotNil(store.entry(for: .conductor))
    }

    func testStaleListAnswerDoesNotOverwriteASave() async throws {
        let gate = Gate()
        let counter = CallCounter()
        let stub = StubHTTPClient { request in
            switch await counter.next() {
            case 1:
                // The initial load's list request: held open until the save
                // below has landed, then answered with the pre-save state.
                await gate.wait()
                return (jsonData(["keys": []]), makeResponse(url: request.url!, status: 200))
            case 2:
                return (jsonData(["stored": true]), makeResponse(url: request.url!, status: 200))
            default:
                let payload: [String: Any] = [
                    "keys": [["providerId": "conductor", "updatedAt": 1000]],
                ]
                return (jsonData(payload), makeResponse(url: request.url!, status: 200))
            }
        }
        let source = StubTokenSource()
        let store = VaultStore(client: VaultClient(baseURL: base, http: stub), session: source)

        let initialLoad = Task { await store.load() }
        while await counter.calls < 1 { await Task.yield() }

        try await store.store(key: "sk-k123", for: .conductor)
        XCTAssertNotNil(store.entry(for: .conductor))

        await gate.open()
        await initialLoad.value
        XCTAssertNotNil(store.entry(for: .conductor))
    }
}
