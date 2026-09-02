import Foundation
import XCTest

@testable import LukeKit

// MARK: - Stubs

@MainActor
private final class StubTokens: AccountTokenProviding {
    var accountEmail: String? = "dev@example.com"
    /// Nil is signed out: the read throws the way `AccountSession` does.
    var valid: String?
    var refreshed: String?
    private(set) var refreshCalls = 0

    nonisolated init(valid: String? = "at-1", refreshed: String? = nil) {
        self.valid = valid
        self.refreshed = refreshed
    }

    func validAccessToken() async throws -> String {
        guard let valid else { throw AccountSessionError.signedOut }
        return valid
    }

    func refreshAccessToken() async throws -> String {
        refreshCalls += 1
        guard let refreshed else { throw AccountSessionError.signedOut }
        valid = refreshed
        return refreshed
    }
}

private actor RequestLog {
    private(set) var requests: [URLRequest] = []

    func record(_ request: URLRequest) {
        requests.append(request)
    }
}

/// A stable clock the tests can turn by hand.
private final class Clock: @unchecked Sendable {
    var now = Date(timeIntervalSince1970: 1_774_000_000)
}

/// Counts how many stubbed requests stand open at once, so a test can assert
/// the sender's requests never overlap.
private actor Meter {
    private var active = 0
    private(set) var peak = 0

    func enter() {
        active += 1
        peak = max(peak, active)
    }

    func exit() {
        active -= 1
    }
}

/// Holds a stubbed answer open until the test releases it, so a flush can be
/// made to arrive while another's request is still in flight.
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

private func accepted(for request: URLRequest, status: Int = 202) -> (Data, URLResponse) {
    let response = HTTPURLResponse(
        url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil
    )!
    return (Data("{}".utf8), response)
}

private func sentEvents(_ request: URLRequest) -> [[String: Any]] {
    guard let body = request.httpBody,
          let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
          let events = json["events"] as? [[String: Any]]
    else { return [] }
    return events
}

// MARK: - Tests

@MainActor
final class ProductEventSenderTests: XCTestCase {
    private let serviceURL = URL(string: "https://luke.test")!

    private func makeSender(
        sends: Bool = true,
        tokens: StubTokens = StubTokens(),
        clock: Clock = Clock(),
        queueLimit: Int = 200,
        respond: @escaping @Sendable (URLRequest) async throws -> (Data, URLResponse) = {
            accepted(for: $0)
        }
    ) -> (sender: ProductEventSender, log: RequestLog) {
        let log = RequestLog()
        let http = StubHTTPClient { request in
            await log.record(request)
            return try await respond(request)
        }
        let sender = ProductEventSender(
            serviceURL: serviceURL,
            appVersion: "0.1.1",
            sends: sends,
            session: tokens,
            http: http,
            now: { clock.now },
            queueLimit: queueLimit
        )
        return (sender, log)
    }

    func testARunThatSendsNoNetworkQueuesNothing() async {
        let (sender, log) = makeSender(sends: false)
        sender.arm()
        sender.record(.appLaunch)
        sender.markDayActive()
        await sender.flush().value
        let requests = await log.requests
        XCTAssertTrue(requests.isEmpty)
    }

    func testASenderThatWasNeverArmedSendsNothing() async {
        let (sender, log) = makeSender()
        sender.record(.appLaunch)
        sender.markDayActive()
        await sender.flush().value
        let requests = await log.requests
        XCTAssertTrue(requests.isEmpty)
    }

    func testAFlushPostsOneBearerBatchNamingThisAppAndEmptiesTheQueue() async {
        let clock = Clock()
        let (sender, log) = makeSender(clock: clock)
        sender.arm()
        sender.record(.appLaunch)
        sender.record(.accountSignIn)
        await sender.flush().value

        var requests = await log.requests
        XCTAssertEqual(requests.count, 1)
        let request = requests[0]
        XCTAssertEqual(request.url, serviceURL.appendingPathComponent("api/events"))
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer at-1")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-luke-client"), "ios")

        let events = sentEvents(request)
        XCTAssertEqual(events.map { $0["name"] as? String }, ["app:launch", "account:sign_in"])
        let expectedAt = Int(clock.now.timeIntervalSince1970 * 1000)
        XCTAssertEqual(events.map { $0["at"] as? Int }, [expectedAt, expectedAt])
        XCTAssertEqual(
            events[0]["properties"] as? [String: String],
            ["app_version": "0.1.1"]
        )

        await sender.flush().value
        requests = await log.requests
        XCTAssertEqual(requests.count, 1)
    }

    func testA401RefreshesAndRetriesOnceAndTheSameTokenTwiceDoesNot() async {
        let refreshing = StubTokens(valid: "stale", refreshed: "fresh")
        let (sender, log) = makeSender(tokens: refreshing) { request in
            accepted(
                for: request,
                status: request.value(forHTTPHeaderField: "Authorization") == "Bearer fresh"
                    ? 202 : 401
            )
        }
        sender.arm()
        sender.record(.appLaunch)
        await sender.flush().value
        let requests = await log.requests
        XCTAssertEqual(refreshing.refreshCalls, 1)
        XCTAssertEqual(
            requests.map { $0.value(forHTTPHeaderField: "Authorization") },
            ["Bearer stale", "Bearer fresh"]
        )

        let stuck = StubTokens(valid: "same", refreshed: "same")
        let (stuckSender, stuckLog) = makeSender(tokens: stuck) { accepted(for: $0, status: 401) }
        stuckSender.arm()
        stuckSender.record(.appLaunch)
        await stuckSender.flush().value
        let stuckRequests = await stuckLog.requests
        XCTAssertEqual(stuckRequests.count, 1)
    }

    func testAFailedSendDropsItsBatchRatherThanRetryingItBehindTheNextOne() async {
        let (sender, log) = makeSender { _ in throw URLError(.notConnectedToInternet) }
        sender.arm()
        sender.record(.appLaunch)
        await sender.flush().value

        sender.record(.accountSignIn)
        await sender.flush().value

        let requests = await log.requests
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(
            sentEvents(requests[1]).map { $0["name"] as? String },
            ["account:sign_in"]
        )
    }

    func testSignedOutTheQueueWaitsRatherThanBeingSpent() async {
        let tokens = StubTokens(valid: nil)
        let (sender, log) = makeSender(tokens: tokens)
        sender.arm()
        sender.record(.appLaunch)
        await sender.flush().value
        var requests = await log.requests
        XCTAssertTrue(requests.isEmpty)

        tokens.valid = "at-1"
        await sender.flush().value
        requests = await log.requests
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(sentEvents(requests[0]).count, 1)
    }

    func testPastTheQueueLimitTheOldestGoAndTheNewestStay() async {
        let (sender, log) = makeSender(queueLimit: 3)
        sender.arm()
        for provider in [ProductProviderID.claudeCode, .codex, .conductor, .omp] {
            sender.record(.sessionActSend(provider: provider, act: .messageSend))
        }
        await sender.flush().value

        let requests = await log.requests
        let providers = sentEvents(requests[0]).map {
            ($0["properties"] as? [String: String])?["provider_id"]
        }
        XCTAssertEqual(providers, ["codex", "conductor", "omp"])
    }

    func testABatchPastTheWireLimitIsLeftForTheNextFlushRatherThanRefused() async {
        let (sender, log) = makeSender()
        sender.arm()
        for _ in 0 ..< 60 {
            sender.record(.accountSignIn)
        }
        await sender.flush().value
        await sender.flush().value

        let requests = await log.requests
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(sentEvents(requests[0]).count, 50)
        XCTAssertEqual(sentEvents(requests[1]).count, 10)
    }

    func testTheDayMarkerRecordsOnceADayAndAgainOnceTheDayHasTurned() async {
        let clock = Clock()
        let (sender, log) = makeSender(clock: clock)
        sender.arm()
        sender.markDayActive()
        sender.markDayActive()
        clock.now += 6 * 60 * 60
        sender.markDayActive()
        await sender.flush().value
        var requests = await log.requests
        XCTAssertEqual(sentEvents(requests[0]).count, 1)

        clock.now += 24 * 60 * 60
        sender.markDayActive()
        await sender.flush().value
        requests = await log.requests
        XCTAssertEqual(
            sentEvents(requests[1]).map { $0["name"] as? String },
            ["app:day_active"]
        )
    }

    func testAnObservationIsCountedOncePerProviderPerDay() async {
        let (sender, log) = makeSender()
        sender.arm()
        for provider in [ProductProviderID.codex, .codex, .claudeCode] {
            sender.recordOncePerDay(
                .sessionObserve(provider: provider, sessions: .few),
                discriminator: provider.rawValue
            )
        }
        await sender.flush().value

        let requests = await log.requests
        let providers = sentEvents(requests[0]).map {
            ($0["properties"] as? [String: Any])?["provider_id"] as? String
        }
        XCTAssertEqual(providers, ["codex", "claude-code"])
    }

    /// The sign-out path records its act and awaits a flush while the timed
    /// flush may already be mid-request with an earlier batch; an act queued
    /// after that batch was taken must ride its own request, not wait behind
    /// a token the sign-out is about to clear.
    func testAFlushCalledMidRequestChainsBehindItRatherThanReturningIt() async {
        let taken = Gate()
        let release = Gate()
        let (sender, log) = makeSender { request in
            await taken.open()
            await release.wait()
            return accepted(for: request)
        }
        sender.arm()
        sender.record(.appLaunch)
        let first = sender.flush()
        await taken.wait()

        sender.record(.accountAct(.signOut))
        let second = sender.flush()
        await release.open()
        await first.value
        await second.value

        let requests = await log.requests
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(
            sentEvents(requests[1]).map { $0["name"] as? String },
            ["account:act"]
        )
    }

    /// A predecessor finishing must not free the slot a successor still
    /// holds: a third flush arriving then would run beside the successor,
    /// and two requests would overlap.
    func testFlushesNeverOverlapHoweverTheyInterleave() async {
        let meter = Meter()
        let firstTaken = Gate()
        let firstRelease = Gate()
        let secondTaken = Gate()
        let secondRelease = Gate()
        let (sender, log) = makeSender { request in
            await meter.enter()
            let names = sentEvents(request).compactMap { $0["name"] as? String }
            if names == ["app:launch"] {
                await firstTaken.open()
                await firstRelease.wait()
            }
            if names == ["account:sign_in"] {
                await secondTaken.open()
                await secondRelease.wait()
            }
            await meter.exit()
            return accepted(for: request)
        }
        sender.arm()
        sender.record(.appLaunch)
        let first = sender.flush()
        await firstTaken.wait()

        sender.record(.accountSignIn)
        let second = sender.flush()
        await firstRelease.open()
        await first.value
        await secondTaken.wait()

        // The predecessor has finished and the successor's request is being
        // held open; a flush arriving now is the clobbered-slot case.
        sender.record(.accountAct(.signOut))
        let third = sender.flush()
        // Room for a wrongly unchained third send to reach the stub before
        // the successor is released; a chained one cannot.
        for _ in 0 ..< 20 { await Task.yield() }
        await secondRelease.open()
        await second.value
        await third.value

        let requests = await log.requests
        XCTAssertEqual(requests.count, 3)
        XCTAssertEqual(
            sentEvents(requests[2]).map { $0["name"] as? String },
            ["account:act"]
        )
        let peak = await meter.peak
        XCTAssertEqual(peak, 1)
    }

    func testStoppingDropsWhatWasQueuedRatherThanHoldingTheQuitOpen() async {
        let (sender, log) = makeSender()
        sender.arm()
        sender.start()
        sender.record(.appLaunch)
        sender.stop()
        await sender.flush().value
        let requests = await log.requests
        XCTAssertTrue(requests.isEmpty)
    }
}
