import Foundation
import XCTest

@testable import LukeKit

/// The phone's sessions-socket client against a scripted socket: the
/// handshake and its refusals, the create exchange, the re-attach after a
/// dropped connection on the desktop's own cadence, and what is held, dropped,
/// and restated across the gap. Every case mirrors one in
/// `packages/voice/src/live-session-source.test.ts`.
final class HostedVoiceSessionClientTests: XCTestCase {
    private static let serviceURL = URL(string: "https://voice.example.test")!
    private static let sessionsURL = URL(string: "wss://voice.example.test/api/voice/sessions")!
    private static let sdpOffer = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
    private static let sdpAnswer = "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
    private static let sessionId = "ls_123"
    private static let deviceId = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
    private static let requestTimeout = Duration.seconds(10)

    private static func created(quota: Bool = true) -> [String: Any] {
        var frame: [String: Any] = ["type": "session.created", "sessionId": sessionId, "sdpAnswer": sdpAnswer]
        if quota { frame["quota"] = ["used": 3, "limit": 50, "resetsAt": 1_800_003_600_000] }
        return frame
    }

    private static func attached(_ id: String = sessionId) -> [String: Any] {
        ["type": "session.attached", "sessionId": id]
    }

    // MARK: - Fakes

    /// One scripted connection: what its open answers, what it was sent, and the frames the test delivers.
    private final class FakeSocket: VoiceSocket, @unchecked Sendable {
        let url: URL
        let headers: VoiceHandshakeHeaders
        var opening: VoiceSocketOpening = .opened
        /// Left unanswered so the client's deadline decides.
        var opensNever = false
        private(set) var sent: [String] = []
        private(set) var closedByClient = false
        var onSend: ((String) -> Void)?
        private let stream: AsyncStream<VoiceSocketArrival>
        private let continuation: AsyncStream<VoiceSocketArrival>.Continuation
        private lazy var iterator = stream.makeAsyncIterator()

        init(url: URL, headers: VoiceHandshakeHeaders) {
            self.url = url
            self.headers = headers
            var continuation: AsyncStream<VoiceSocketArrival>.Continuation!
            stream = AsyncStream(bufferingPolicy: .unbounded) { continuation = $0 }
            self.continuation = continuation
        }

        func open() async -> VoiceSocketOpening {
            if opensNever { await Forever.wait() }
            return opening
        }

        func send(_ text: String) async throws {
            sent.append(text)
            onSend?(text)
        }

        func receive() async -> VoiceSocketArrival {
            await iterator.next() ?? .closed(code: nil)
        }

        func close() {
            closedByClient = true
            continuation.yield(.closed(code: nil))
            continuation.finish()
        }

        func deliver(_ frame: [String: Any]) {
            let data = try! JSONSerialization.data(withJSONObject: frame)
            deliverText(String(decoding: data, as: UTF8.self))
        }

        func deliverText(_ text: String) {
            continuation.yield(.frame(text))
        }

        func closeFromServer(code: Int) {
            continuation.yield(.closed(code: code))
            continuation.finish()
        }

        var sentObjects: [[String: Any]] {
            sent.map { (try? JSONSerialization.jsonObject(with: Data($0.utf8))) as? [String: Any] ?? [:] }
        }

        var sentTypes: [String] { sentObjects.map { $0["type"] as? String ?? "" } }
    }

    /// A wait that never ends on its own; the client's deadline cancels it.
    private enum Forever {
        static func wait() async {
            let stream = AsyncStream<Void> { _ in }
            for await _ in stream {}
        }
    }

    /// Makes one fake per connection and runs the script the test wrote for it.
    private final class ScriptedOpener: VoiceSocketOpener, @unchecked Sendable {
        private(set) var sockets: [FakeSocket] = []
        var scripts: [(FakeSocket) -> Void]

        init(_ scripts: [(FakeSocket) -> Void]) {
            self.scripts = scripts
        }

        func socket(url: URL, headers: VoiceHandshakeHeaders) -> any VoiceSocket {
            let socket = FakeSocket(url: url, headers: headers)
            if sockets.count < scripts.count { scripts[sockets.count](socket) }
            sockets.append(socket)
            return socket
        }
    }

    /// The service answering the first frame with the document given.
    private static func answering(_ frame: [String: Any]) -> (FakeSocket) -> Void {
        { socket in socket.onSend = { _ in socket.deliver(frame) } }
    }

    private static func answeringText(_ text: String) -> (FakeSocket) -> Void {
        { socket in socket.onSend = { _ in socket.deliverText(text) } }
    }

    private static func closingOnSend(code: Int) -> (FakeSocket) -> Void {
        { socket in socket.onSend = { _ in socket.closeFromServer(code: code) } }
    }

    private static func refusing(status: Int) -> (FakeSocket) -> Void {
        { socket in socket.opening = .refused(status: status) }
    }

    /// A session whose holder a test moves between the first attempt and the refresh.
    private final class Session: AccountTokenProviding {
        var accountEmail: String?
        var holderAfterRefresh: String?
        var tokens: [String]
        private(set) var refreshes = 0

        init(holder: String? = "dev@example.test", tokens: [String] = ["token-1"]) {
            accountEmail = holder
            holderAfterRefresh = holder
            self.tokens = tokens
        }

        func validAccessToken() async throws -> String {
            guard accountEmail != nil else { throw AccountSessionError.signedOut }
            return tokens.count > 1 ? tokens.removeFirst() : tokens[0]
        }

        func refreshAccessToken() async throws -> String {
            refreshes += 1
            accountEmail = holderAfterRefresh
            return "token-fresh"
        }
    }

    /// The clock the client waits on: a reattach delay passes at once and is
    /// recorded in `slept`; a request deadline is counted in `armedDeadlines`
    /// and stands until the test lets every standing one pass.
    private final class Clock: @unchecked Sendable {
        private(set) var slept: [Duration] = []
        private(set) var armedDeadlines = 0
        private var deadlines: [AsyncStream<Void>.Continuation] = []
        private let lock = NSLock()

        var sleep: VoiceSleep {
            { [self] duration in
                guard duration == HostedVoiceSessionClientTests.requestTimeout else {
                    lock.withLock { slept.append(duration) }
                    return
                }
                let stream = AsyncStream<Void> { continuation in
                    lock.withLock {
                        armedDeadlines += 1
                        deadlines.append(continuation)
                    }
                }
                for await _ in stream {}
            }
        }

        /// Lets every request deadline standing pass.
        func expireDeadlines() {
            let standing: [AsyncStream<Void>.Continuation] = lock.withLock {
                let waiting = deadlines
                deadlines = []
                return waiting
            }
            for continuation in standing { continuation.finish() }
        }
    }

    @MainActor
    private func client(
        _ opener: ScriptedOpener, session: Session? = nil, clock: Clock? = nil, deviceId: String? = deviceId,
        delays: [Duration] = VoiceServiceContract.reattachDelaysMs.map { .milliseconds($0) }
    ) -> HostedVoiceSessionClient {
        HostedVoiceSessionClient(
            serviceURL: Self.serviceURL, session: session ?? Session(), deviceId: { deviceId }, opener: opener,
            requestTimeout: Self.requestTimeout, reattachDelays: delays, sleep: (clock ?? Clock()).sleep
        )
    }

    /// The connection at `index`, once the opener has made it; a test that waited for it and did not get it fails here rather than indexing past the end.
    private func socket(_ index: Int, of opener: ScriptedOpener, file: StaticString = #filePath, line: UInt = #line) throws
        -> FakeSocket
    {
        try XCTUnwrap(opener.sockets.count > index ? opener.sockets[index] : nil, "no connection \(index)", file: file, line: line)
    }

    /// Creates against the opener and answers the refusal, or nil where a session opened.
    @MainActor
    private func refusal(creating opener: ScriptedOpener, session: Session? = nil) async -> HostedVoiceSessionRefusal? {
        let opening = await client(opener, session: session).create(sdpOffer: Self.sdpOffer, voice: .marin)
        if case .opened(let session) = opening { session.close() }
        return refusal(opening)
    }

    @MainActor
    private func opened(_ opening: HostedVoiceSessionOpening, file: StaticString = #filePath, line: UInt = #line) throws
        -> HostedVoiceSession
    {
        guard case .opened(let session) = opening else {
            XCTFail("no session opened: \(opening)", file: file, line: line)
            throw XCTSkip()
        }
        return session
    }

    private func refusal(_ opening: HostedVoiceSessionOpening) -> HostedVoiceSessionRefusal? {
        if case .refused(let refusal) = opening { return refusal }
        return nil
    }

    /// Waits for what the client does off the test's own task to have happened, or fails naming it.
    @MainActor
    private func settled(
        _ waitedFor: String, file: StaticString = #filePath, line: UInt = #line, until condition: @MainActor () -> Bool
    ) async {
        for _ in 0 ..< 500 where !condition() {
            try? await Task.sleep(for: .milliseconds(1))
        }
        XCTAssertTrue(condition(), "waited for \(waitedFor)", file: file, line: line)
    }

    /// Reads the session's events off the test's task as they arrive.
    @MainActor
    private final class Reader {
        private(set) var events: [HostedVoiceSessionEvent] = []
        private var task: Task<Void, Never>?

        init(_ session: HostedVoiceSession) {
            task = Task { @MainActor [weak self] in
                for await event in session.events { self?.events.append(event) }
            }
        }

        var closes: [Int?] { events.compactMap { if case .closed(let code) = $0 { code } else { nil } } }
        var liveTypes: [String] { events.compactMap { if case .live(let event) = $0 { event.type } else { nil } } }
    }

    // MARK: - Create

    @MainActor
    func testCreateOpensUnderTheBearerAndDeviceAndSendsTheOfferAsTheFirstFrame() async throws {
        let opener = ScriptedOpener([Self.answering(Self.created())])
        let session = try opened(await client(opener).create(sdpOffer: Self.sdpOffer, voice: .cedar))
        let socket = try XCTUnwrap(opener.sockets.first)
        XCTAssertEqual(socket.url, Self.sessionsURL)
        XCTAssertEqual(socket.headers, VoiceHandshakeHeaders(bearer: "token-1", deviceId: Self.deviceId))
        XCTAssertEqual(
            socket.headers.fields,
            ["Authorization": "Bearer token-1", "x-luke-device-id": Self.deviceId]
        )
        XCTAssertNil(socket.headers.fields[URLSessionVoiceSocket.originField])
        XCTAssertEqual(socket.sent.count, 1)
        let create = try XCTUnwrap(socket.sentObjects.first)
        XCTAssertEqual(create["type"] as? String, "session.create")
        XCTAssertEqual(create["sdp"] as? String, Self.sdpOffer)
        XCTAssertEqual(create["voice"] as? String, "cedar")
        XCTAssertEqual((create["input"] as? [Any])?.isEmpty, true)
        XCTAssertEqual(session.sessionId, Self.sessionId)
        XCTAssertEqual(session.sdpAnswer, Self.sdpAnswer)
        XCTAssertEqual(session.created, LiveSessionCreated(sessionId: Self.sessionId, sdpAnswer: Self.sdpAnswer))
        XCTAssertEqual(session.quota?.used, 3)
        XCTAssertEqual(session.quota?.limit, 50)
        XCTAssertFalse(socket.closedByClient)
        session.close()
    }

    @MainActor
    func testAnUnregisteredDeviceSendsNoDeviceHeader() async throws {
        let opener = ScriptedOpener([Self.answering(Self.created(quota: false))])
        let session = try opened(await client(opener, deviceId: nil).create(sdpOffer: Self.sdpOffer, voice: .marin))
        XCTAssertEqual(opener.sockets.first?.headers.fields, ["Authorization": "Bearer token-1"])
        XCTAssertNil(session.quota)
        session.close()
    }

    @MainActor
    func testAnHTTPServiceOriginOpensAPlainSocket() {
        XCTAssertEqual(
            HostedVoiceSessionClient.sessionsURL(serviceURL: URL(string: "http://localhost:3000")!),
            URL(string: "ws://localhost:3000/api/voice/sessions")
        )
        XCTAssertEqual(
            HostedVoiceSessionClient.sessionsURL(serviceURL: URL(string: "https://tryluke.dev")!),
            URL(string: "wss://tryluke.dev/api/voice/sessions")
        )
    }

    @MainActor
    func testSignedOutOpensNoSocket() async throws {
        let opener = ScriptedOpener([])
        let opening = await client(opener, session: Session(holder: nil)).create(sdpOffer: Self.sdpOffer, voice: .marin)
        XCTAssertEqual(refusal(opening), .notSignedIn)
        XCTAssertEqual(opener.sockets.count, 0)
    }

    @MainActor
    func testARefusedUpgradeIsNamedByItsStatus() async throws {
        for (status, expected) in [
            (403, HostedVoiceSessionRefusal.httpError(status: 403)),
            (503, .hostedUnavailable),
            (429, .quotaExhausted(nil)),
            (500, .httpError(status: 500)),
        ] {
            let opener = ScriptedOpener([Self.refusing(status: status)])
            let opening = await client(opener).create(sdpOffer: Self.sdpOffer, voice: .marin)
            XCTAssertEqual(refusal(opening), expected, "status \(status)")
            XCTAssertEqual(opener.sockets.count, 1)
            XCTAssertEqual(opener.sockets.first?.closedByClient, true)
            XCTAssertEqual(opener.sockets.first?.sent, [])
        }
    }

    @MainActor
    func testATransportThatCarriedNothingIsANetworkError() async throws {
        let opener = ScriptedOpener([{ $0.opening = .failed }])
        let outcome = await refusal(creating: opener)
        XCTAssertEqual(outcome, .networkError)
    }

    @MainActor
    func testA401RenewsTheBearerOnceAndRetriesWithTheRenewedOne() async throws {
        let opener = ScriptedOpener([Self.refusing(status: 401), Self.answering(Self.created())])
        let session = Session()
        let opened = try opened(await client(opener, session: session).create(sdpOffer: Self.sdpOffer, voice: .marin))
        XCTAssertEqual(session.refreshes, 1)
        XCTAssertEqual(opener.sockets.map(\.headers.bearer), ["token-1", "token-fresh"])
        XCTAssertEqual((try socket(1, of: opener)).headers.deviceId, Self.deviceId)
        XCTAssertEqual(opener.sockets[0].closedByClient, true)
        opened.close()
    }

    @MainActor
    func testA401TwiceIsSignedOut() async throws {
        let opener = ScriptedOpener([Self.refusing(status: 401), Self.refusing(status: 401)])
        let outcome = await refusal(creating: opener)
        XCTAssertEqual(outcome, .notSignedIn)
        XCTAssertEqual(opener.sockets.count, 2)
    }

    @MainActor
    func testARenewedBearerIsNotCarriedForAnotherAccount() async throws {
        let opener = ScriptedOpener([Self.refusing(status: 401), Self.answering(Self.created())])
        let session = Session()
        session.holderAfterRefresh = "other@example.test"
        let outcome = await refusal(creating: opener, session: session)
        XCTAssertEqual(outcome, .notSignedIn)
        XCTAssertEqual(opener.sockets.count, 1)
    }

    @MainActor
    func testAFirstFrameCarryingAnErrorIsTheRefusalItNames() async throws {
        for (error, expected) in [
            ("quota-exhausted", HostedVoiceSessionRefusal.quotaExhausted(nil)),
            ("invalid-token", .notSignedIn),
            ("unavailable", .hostedUnavailable),
            ("upstream-throttled", .hostedUnavailable),
            ("invalid-request", .refused(.invalidRequest)),
        ] {
            let opener = ScriptedOpener([Self.answering(["error": error])])
            let outcome = await refusal(creating: opener)
            XCTAssertEqual(outcome, expected, error)
            XCTAssertEqual(opener.sockets.first?.closedByClient, true)
        }
    }

    @MainActor
    func testAQuotaRefusalCarriesTheQuotaTheServiceNamed() async throws {
        let opener = ScriptedOpener([
            Self.answering(["error": "quota-exhausted", "quota": ["used": 50, "limit": 50, "resetsAt": 9]]),
        ])
        guard case .quotaExhausted(let quota) = await refusal(creating: opener) else {
            return XCTFail("not a quota refusal")
        }
        XCTAssertEqual(quota?.used, 50)
        XCTAssertEqual(quota?.resetsAt, 9)
    }

    @MainActor
    func testAFirstFrameThatIsNeitherAnswerNorErrorIsMalformed() async throws {
        for text in [
            "not a document",
            #"{"type":"session.started","event_id":"e1"}"#,
            #"{"type":"session.created","sessionId":"","sdpAnswer":"x"}"#,
            #"{"type":"session.attached","sessionId":"ls_123"}"#,
        ] {
            let opener = ScriptedOpener([Self.answeringText(text)])
            let outcome = await refusal(creating: opener)
            XCTAssertEqual(outcome, .malformedResponse, text)
            XCTAssertEqual(opener.sockets.first?.closedByClient, true)
        }
    }

    @MainActor
    func testASocketClosedOrSilentBeforeItAnsweredIsTheServiceUnavailable() async throws {
        let closing = ScriptedOpener([Self.closingOnSend(code: 1011)])
        let outcome = await refusal(creating: closing)
        XCTAssertEqual(outcome, .hostedUnavailable)

        // One deadline over the handshake, which opens at once, then one over the answer that never comes.
        let silentClock = Clock()
        let silent = ScriptedOpener([{ _ in }])
        let creating = Task { await self.client(silent, clock: silentClock).create(sdpOffer: Self.sdpOffer, voice: .marin) }
        await settled("the answer's deadline to be armed") { silentClock.armedDeadlines == 2 }
        silentClock.expireDeadlines()
        let silentRefusal = refusal(await creating.value)
        XCTAssertEqual(silentRefusal, .hostedUnavailable)
        XCTAssertEqual(silent.sockets.first?.closedByClient, true)
        XCTAssertEqual(silentClock.slept, [])

        // The handshake itself never settles: its one deadline decides, and no frame is sent.
        let openClock = Clock()
        let neverOpening = ScriptedOpener([{ $0.opensNever = true }])
        let opening = Task { await self.client(neverOpening, clock: openClock).create(sdpOffer: Self.sdpOffer, voice: .marin) }
        await settled("the handshake deadline to be armed") { openClock.armedDeadlines == 1 }
        openClock.expireDeadlines()
        let openRefusal = refusal(await opening.value)
        XCTAssertEqual(openRefusal, .hostedUnavailable)
        XCTAssertEqual(neverOpening.sockets.first?.closedByClient, true)
        XCTAssertEqual(neverOpening.sockets.first?.sent, [])
    }

    // MARK: - The standing session

    @MainActor
    func testLiveEventsAreHandedUpAndTheServicesSpokenWordIsTakenOffThem() async throws {
        let opener = ScriptedOpener([Self.answering(Self.created())])
        let session = try opened(await client(opener).create(sdpOffer: Self.sdpOffer, voice: .marin))
        let reader = Reader(session)
        let socket = opener.sockets[0]
        socket.deliver(["type": "session.spoken", "kind": "briefing"])
        socket.deliver(["type": "session.started", "event_id": "e1", "session": ["id": Self.sessionId]])
        socket.deliver(["type": "session.output_transcript.delta", "event_id": "e2", "delta": "session.spoken"])
        socket.deliverText("not a document")
        socket.deliver(["type": "session.spoken", "kind": "toast"])
        await settled("the events to land") { reader.events.count == 3 }
        XCTAssertEqual(reader.events[0], .spoken(.briefing))
        XCTAssertEqual(reader.liveTypes, ["session.started", "session.output_transcript.delta"])
        session.close()
        await settled("the close to land") { reader.closes.count == 1 }
        XCTAssertEqual(reader.closes, [nil])
        XCTAssertEqual(socket.closedByClient, true)
    }

    @MainActor
    func testTheReportsAndTheHangUpRideTheSocketAsTheFramesTheContractNames() async throws {
        let opener = ScriptedOpener([Self.answering(Self.created())])
        let session = try opened(await client(opener).create(sdpOffer: Self.sdpOffer, voice: .marin))
        session.reportActivity(idle: true)
        session.stopSpeaking()
        session.reportActivity(idle: false)
        session.hangUp()
        await session.settleSends()
        let sent = opener.sockets[0].sentObjects
        XCTAssertEqual(sent.map { $0["type"] as? String }, [
            "session.create", "session.activity", "session.stop", "session.activity", "session.close",
        ])
        XCTAssertEqual(sent[1]["idle"] as? Bool, true)
        XCTAssertEqual(sent[3]["idle"] as? Bool, false)
        XCTAssertEqual(sent[2].count, 1)
        XCTAssertEqual(sent[4].count, 1)
        session.close()
    }

    @MainActor
    func testTheSessionsOwnEndIsReportedAndNothingIsTriedAgain() async throws {
        let opener = ScriptedOpener([Self.answering(Self.created())])
        let clock = Clock()
        let session = try opened(await client(opener, clock: clock).create(sdpOffer: Self.sdpOffer, voice: .marin))
        let reader = Reader(session)
        opener.sockets[0].deliver(["type": "session.closed", "event_id": "e9", "reason": "close_requested"])
        opener.sockets[0].closeFromServer(code: 1000)
        await settled("the close to land") { reader.closes.count == 1 }
        XCTAssertEqual(reader.liveTypes, ["session.closed"])
        XCTAssertEqual(reader.closes, [1000])
        XCTAssertEqual(opener.sockets.count, 1)
        XCTAssertEqual(clock.slept, [])
        session.reportActivity(idle: true)
        await session.settleSends()
        XCTAssertEqual(opener.sockets[0].sentTypes, ["session.create", "session.activity"])
    }

    // MARK: - Re-attach

    @MainActor
    func testAConnectionLostMidSessionReattachesAndThePipeResumes() async throws {
        let opener = ScriptedOpener([Self.answering(Self.created()), Self.answering(Self.attached())])
        let clock = Clock()
        let account = Session(tokens: ["token-1", "token-2"])
        let session = try opened(
            await client(opener, session: account, clock: clock).create(sdpOffer: Self.sdpOffer, voice: .marin)
        )
        let reader = Reader(session)
        opener.sockets[0].closeFromServer(code: 1006)
        await settled("the fresh connection") { opener.sockets.count == 2 && opener.sockets[1].sent.count >= 1 }
        let second = (try socket(1, of: opener))
        XCTAssertEqual(second.url, Self.sessionsURL)
        XCTAssertEqual(second.headers, VoiceHandshakeHeaders(bearer: "token-2", deviceId: nil))
        XCTAssertEqual(second.headers.fields, ["Authorization": "Bearer token-2"])
        XCTAssertEqual(second.sentObjects[0] as? [String: String], ["type": "session.attach", "sessionId": Self.sessionId])
        XCTAssertEqual(clock.slept, [.milliseconds(0)])
        XCTAssertEqual(reader.closes, [])
        second.deliver(["type": "session.input_audio.muted", "event_id": "e2", "client_event_id": "c2"])
        await settled("the event on the fresh connection") { reader.liveTypes.count == 1 }
        XCTAssertEqual(reader.liveTypes, ["session.input_audio.muted"])
        session.hangUp()
        await session.settleSends()
        XCTAssertEqual(second.sentTypes, ["session.attach", "session.close"])
        XCTAssertEqual(opener.sockets[0].sentTypes, ["session.create"])
        session.close()
    }

    @MainActor
    func testAStopPressedInTheGapIsSentOnTheConnectionThatComesAfterIt() async throws {
        var held: FakeSocket?
        let opener = ScriptedOpener([Self.answering(Self.created()), { held = $0 }])
        let session = try opened(await client(opener).create(sdpOffer: Self.sdpOffer, voice: .marin))
        session.stopSpeaking()
        await session.settleSends()
        XCTAssertEqual(opener.sockets[0].sentTypes, ["session.create", "session.stop"])
        opener.sockets[0].closeFromServer(code: 1001)
        await settled("the attach frame on the held connection") { held?.sent.count == 1 }
        // Pressed in the gap: the model keeps speaking across the service's recycle, so the stop is still meant.
        session.stopSpeaking()
        session.hangUp()
        try XCTUnwrap(held).deliver(Self.attached())
        await settled("the held sends behind the attach frame") { held?.sent.count == 3 }
        XCTAssertEqual(held?.sentTypes, ["session.attach", "session.stop", "session.close"])
        session.close()
    }

    @MainActor
    func testTheStandingIdleReportIsToldFirstToEachFreshConnection() async throws {
        let opener = ScriptedOpener([
            Self.answering(Self.created()), Self.answering(Self.attached()), Self.answering(Self.attached()),
        ])
        let session = try opened(await client(opener).create(sdpOffer: Self.sdpOffer, voice: .marin))
        // No report yet: a recycled connection is told nothing it was not told.
        opener.sockets[0].closeFromServer(code: 1001)
        await settled("the second connection") { opener.sockets.count == 2 && opener.sockets[1].sent.count == 1 }
        session.stopSpeaking()
        await settled("the probe behind the attach frame") { opener.sockets[1].sent.count == 2 }
        XCTAssertEqual((try socket(1, of: opener)).sentTypes, ["session.attach", "session.stop"])
        session.reportActivity(idle: true)
        await session.settleSends()
        (try socket(1, of: opener)).closeFromServer(code: 1001)
        await settled("the third connection") { opener.sockets.count == 3 && opener.sockets[2].sent.count == 2 }
        XCTAssertEqual((try socket(2, of: opener)).sentTypes, ["session.attach", "session.activity"])
        XCTAssertEqual((try socket(2, of: opener)).sentObjects[1]["idle"] as? Bool, true)
        session.reportActivity(idle: false)
        await session.settleSends()
        XCTAssertEqual((try socket(2, of: opener)).sentTypes, ["session.attach", "session.activity", "session.activity"])
        XCTAssertEqual((try socket(2, of: opener)).sentObjects[2]["idle"] as? Bool, false)
        session.close()
    }

    @MainActor
    func testIdleReportsMadeInTheGapAreNotReplayedBehindTheStandingOne() async throws {
        var held: FakeSocket?
        let opener = ScriptedOpener([Self.answering(Self.created()), { held = $0 }])
        let session = try opened(await client(opener).create(sdpOffer: Self.sdpOffer, voice: .marin))
        opener.sockets[0].closeFromServer(code: 1001)
        await settled("the attach frame on the held connection") { held?.sent.count == 1 }
        // During the gap the peer goes idle, then is heard again, then the stop is pressed.
        session.reportActivity(idle: true)
        session.reportActivity(idle: false)
        session.stopSpeaking()
        try XCTUnwrap(held).deliver(Self.attached())
        await settled("the standing report and the held stop") { held?.sent.count == 3 }
        XCTAssertEqual(held?.sentTypes, ["session.attach", "session.activity", "session.stop"])
        XCTAssertEqual(held?.sentObjects[1]["idle"] as? Bool, false)
        session.close()
    }

    @MainActor
    func testReattachingTriesOnTheDesktopsCadenceAndThenReportsTheLoss() async throws {
        let opener = ScriptedOpener([
            Self.answering(Self.created()), Self.closingOnSend(code: 1011), Self.refusing(status: 503), { $0.opening = .failed },
        ])
        let clock = Clock()
        let session = try opened(await client(opener, clock: clock).create(sdpOffer: Self.sdpOffer, voice: .marin))
        let reader = Reader(session)
        opener.sockets[0].closeFromServer(code: 1006)
        await settled("the loss to be reported") { reader.closes.count == 1 }
        XCTAssertEqual(reader.closes, [1006])
        XCTAssertEqual(opener.sockets.count, 4)
        XCTAssertEqual(clock.slept, [.milliseconds(0), .milliseconds(3000), .milliseconds(7000)])
        XCTAssertEqual(VoiceServiceContract.reattachDelaysMs, [0, 3000, 7000])
        for socket in opener.sockets.dropFirst() { XCTAssertTrue(socket.closedByClient) }
        XCTAssertEqual(opener.sockets.dropFirst().map(\.sentTypes), [["session.attach"], [], []])
    }

    @MainActor
    func testAServiceThatRefusesTheAttachmentEndsTheTriesAtOnce() async throws {
        for refusing in [
            Self.answering(["error": "invalid-token"]),
            Self.answering(Self.attached("ls_other")),
            Self.refusing(status: 401),
        ] {
            let opener = ScriptedOpener([Self.answering(Self.created()), refusing])
            let clock = Clock()
            let session = try opened(await client(opener, clock: clock).create(sdpOffer: Self.sdpOffer, voice: .marin))
            let reader = Reader(session)
            opener.sockets[0].closeFromServer(code: 1001)
            await settled("the loss to be reported") { reader.closes.count == 1 }
            XCTAssertEqual(reader.closes, [1001])
            XCTAssertEqual(opener.sockets.count, 2)
            XCTAssertEqual(clock.slept, [.milliseconds(0)])
            XCTAssertTrue((try socket(1, of: opener)).closedByClient)
        }
    }

    @MainActor
    func testASignOutDuringTheGapEndsTheTries() async throws {
        let opener = ScriptedOpener([Self.answering(Self.created())])
        let account = Session()
        let session = try opened(await client(opener, session: account).create(sdpOffer: Self.sdpOffer, voice: .marin))
        let reader = Reader(session)
        account.accountEmail = nil
        opener.sockets[0].closeFromServer(code: 1001)
        await settled("the loss to be reported") { reader.closes.count == 1 }
        XCTAssertEqual(opener.sockets.count, 1)
    }

    @MainActor
    func testAnAttachAnsweredByASilentServiceIsTriedAgain() async throws {
        let opener = ScriptedOpener([Self.answering(Self.created()), { _ in }, Self.answering(Self.attached())])
        let clock = Clock()
        let session = try opened(await client(opener, clock: clock).create(sdpOffer: Self.sdpOffer, voice: .marin))
        let reader = Reader(session)
        opener.sockets[0].closeFromServer(code: 1001)
        // Two deadlines stood over the creation; the attach arms one over its handshake and one over its answer.
        await settled("the deadline on the silent attach") { clock.armedDeadlines == 4 }
        clock.expireDeadlines()
        await settled("the third connection") { opener.sockets.count == 3 && opener.sockets[2].sent.count == 1 }
        XCTAssertTrue((try socket(1, of: opener)).closedByClient)
        XCTAssertEqual(clock.slept, [.milliseconds(0), .milliseconds(3000)])
        XCTAssertEqual(reader.closes, [])
        session.close()
    }

    @MainActor
    func testAHangUpDuringTheGapOpensNothingFurtherAndClosesWhatLanded() async throws {
        var held: FakeSocket?
        let opener = ScriptedOpener([Self.answering(Self.created()), { held = $0 }])
        let session = try opened(await client(opener).create(sdpOffer: Self.sdpOffer, voice: .marin))
        let reader = Reader(session)
        opener.sockets[0].closeFromServer(code: 1001)
        await settled("the attach frame on the held connection") { held?.sent.count == 1 }
        session.close()
        try XCTUnwrap(held).deliver(Self.attached())
        await settled("the close to land") { reader.closes.count == 1 }
        XCTAssertEqual(reader.closes, [1001])
        await settled("the landed attempt to be closed") { held?.closedByClient == true }
        XCTAssertEqual(opener.sockets.count, 2)
        session.reportActivity(idle: true)
        await session.settleSends()
        XCTAssertEqual(held?.sentTypes, ["session.attach"])
    }

    @MainActor
    func testAHangUpWhileAReattachWaitStandsOpensNoFurtherAttempt() async throws {
        let opener = ScriptedOpener([Self.answering(Self.created()), Self.closingOnSend(code: 1011)])
        let clock = Clock()
        // The second wait never passes on its own; the hang-up is what ends it.
        let sleep: VoiceSleep = { duration in
            if duration == .milliseconds(3000) { await Forever.wait() } else { try await clock.sleep(duration) }
        }
        let client = HostedVoiceSessionClient(
            serviceURL: Self.serviceURL, session: Session(), deviceId: { nil }, opener: opener,
            requestTimeout: Self.requestTimeout,
            reattachDelays: VoiceServiceContract.reattachDelaysMs.map { .milliseconds($0) }, sleep: sleep
        )
        let session = try opened(await client.create(sdpOffer: Self.sdpOffer, voice: .marin))
        let reader = Reader(session)
        opener.sockets[0].closeFromServer(code: 1001)
        await settled("the first try to fail") { opener.sockets.count == 2 && opener.sockets[1].closedByClient }
        session.close()
        await settled("the close to land") { reader.closes.count == 1 }
        XCTAssertEqual(reader.closes, [1001])
        XCTAssertEqual(opener.sockets.count, 2)
        XCTAssertEqual(clock.slept, [.milliseconds(0)])
    }
}
