import Foundation
import XCTest

@testable import LukeKit

private func makeResponse(url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

private func jsonData(_ dict: [String: Any]) -> Data {
    try! JSONSerialization.data(withJSONObject: dict)
}

private func identity(_ id: String = "s1", provider: String = "conductor") -> [String: Any] {
    ["provider_id": provider, "provider_session_id": id]
}

/// The gauntlet every spoken act runs on the phone and the watch alike,
/// exercised once here so the two surfaces cannot drift apart.
@MainActor
final class VoiceActDispatcherTests: XCTestCase {
    private let base = URL(string: "https://example.com")!
    private let everyTool = VoiceToolName.allCases.map(\.rawValue)

    private func context(
        mintedTools: [String]?,
        sessions: [RosterSession] = [],
        projects: ProjectsAnswer? = nil,
        http: StubHTTPClient = StubHTTPClient { _ in throw URLError(.notConnectedToInternet) },
        accessToken: @escaping () async throws -> String = { "token" },
        count: @escaping (ProductSessionAct, String) -> Void = { _, _ in },
        refreshRoster: @escaping () async -> Void = {},
        open: @escaping (RosterSession) -> Void = { _ in },
        showList: @escaping (VoiceAsks.SessionListAsk) -> Void = { _ in }
    ) -> VoiceActContext {
        VoiceActContext(
            mintedTools: mintedTools,
            sessions: sessions,
            projects: projects,
            defaults: WorkspaceCreationDefaults(
                store: UserDefaults(suiteName: "VoiceActDispatcherTests.\(UUID().uuidString)")!
            ),
            actClient: ActClient(baseURL: base, http: http),
            accessToken: accessToken,
            count: count,
            refreshRoster: refreshRoster,
            open: open,
            showList: showList
        )
    }

    func testAToolOutsideTheVocabularyIsRefused() async {
        let output = await dispatchVoiceToolCall(
            name: "remember_fact", arguments: [:], context: context(mintedTools: everyTool)
        )
        XCTAssertEqual(output, #"{"reason":"No such tool exists.","result":"rejected"}"#)
    }

    func testACallBeforeTheMintedSetIsKnownIsRefused() async {
        let output = await dispatchVoiceToolCall(
            name: VoiceToolName.openSession.rawValue,
            arguments: identity(),
            context: context(mintedTools: nil, sessions: [RosterSession(id: "s1")])
        )
        XCTAssertEqual(
            output, #"{"reason":"The call's minted tools are not known yet.","result":"rejected"}"#
        )
    }

    func testAToolTheServiceDidNotMintIsRefusedEvenWhenCarried() async {
        var opened: [RosterSession] = []
        let output = await dispatchVoiceToolCall(
            name: VoiceToolName.openSession.rawValue,
            arguments: identity(),
            context: context(
                mintedTools: [VoiceToolName.showPanel.rawValue],
                sessions: [RosterSession(id: "s1")],
                open: { opened.append($0) }
            )
        )
        XCTAssertEqual(
            output, #"{"reason":"The service did not mint that tool for this call.","result":"rejected"}"#
        )
        XCTAssertTrue(opened.isEmpty)
    }

    func testAnOpenLandsOnlyOnARosterSessionAndIsCounted() async {
        var opened: [RosterSession] = []
        var counted: [(ProductSessionAct, String)] = []
        let ctx = context(
            mintedTools: everyTool,
            sessions: [RosterSession(id: "s1")],
            count: { counted.append(($0, $1)) },
            open: { opened.append($0) }
        )
        let refused = await dispatchVoiceToolCall(
            name: VoiceToolName.openSession.rawValue, arguments: identity("other"), context: ctx
        )
        XCTAssertEqual(
            refused, #"{"reason":"No observed session matches that identity.","result":"rejected"}"#
        )
        XCTAssertTrue(opened.isEmpty)

        let accepted = await dispatchVoiceToolCall(
            name: VoiceToolName.openSession.rawValue, arguments: identity(), context: ctx
        )
        XCTAssertEqual(accepted, #"{"result":"accepted"}"#)
        XCTAssertEqual(opened.map(\.sessionId), ["s1"])
        XCTAssertEqual(counted.count, 1)
        XCTAssertEqual(counted.first?.0, .sessionOpen)
        XCTAssertEqual(counted.first?.1, "conductor")
    }

    func testAListAskIsValidatedBeforeItIsShown() async {
        var shown: [VoiceAsks.SessionListAsk] = []
        let ctx = context(
            mintedTools: everyTool,
            sessions: [RosterSession(id: "s1", status: "waiting"), RosterSession(id: "s2")],
            showList: { shown.append($0) }
        )
        let refused = await dispatchVoiceToolCall(
            name: VoiceToolName.showPanel.rawValue, arguments: ["sort": "sideways"], context: ctx
        )
        XCTAssertEqual(
            refused, #"{"reason":"The list orders by urgency or by recency.","result":"rejected"}"#
        )
        XCTAssertTrue(shown.isEmpty)

        let accepted = await dispatchVoiceToolCall(
            name: VoiceToolName.showPanel.rawValue,
            arguments: ["filters": ["waiting"], "sort": "recency"],
            context: ctx
        )
        XCTAssertEqual(accepted, #"{"result":"accepted"}"#)
        XCTAssertEqual(shown, [VoiceAsks.SessionListAsk(filters: [.status("waiting")], sort: .recency)])
    }

    func testAMessageIsCarriedToTheActEndpointCountedAndFollowedByARefresh() async {
        let http = StubHTTPClient { request in
            XCTAssertEqual(request.url?.path, "/api/acts/message")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token")
            let body = try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: String]
            XCTAssertEqual(
                body, ["providerId": "conductor", "providerSessionId": "s1", "text": "ship it"]
            )
            return (jsonData(["result": "accepted"]), makeResponse(url: request.url!, status: 200))
        }
        var counted: [(ProductSessionAct, String)] = []
        var refreshes = 0
        let output = await dispatchVoiceToolCall(
            name: VoiceToolName.sendSessionMessage.rawValue,
            arguments: identity().merging(["text": " ship it "]) { $1 },
            context: context(
                mintedTools: everyTool,
                sessions: [RosterSession(id: "s1", canReceiveMessage: true)],
                http: http,
                count: { counted.append(($0, $1)) },
                refreshRoster: { refreshes += 1 }
            )
        )
        XCTAssertEqual(output, #"{"result":"accepted"}"#)
        XCTAssertEqual(counted.count, 1)
        XCTAssertEqual(counted.first?.0, .messageSend)
        XCTAssertEqual(counted.first?.1, "conductor")
        XCTAssertEqual(refreshes, 1)
    }

    func testAMessageTheServerRefusedCarriesItsReasonAndCountsNothing() async {
        let http = StubHTTPClient { request in
            (
                jsonData(["result": "rejected", "reason": "The session moved on."]),
                makeResponse(url: request.url!, status: 200)
            )
        }
        var counted = 0
        var refreshes = 0
        let output = await dispatchVoiceToolCall(
            name: VoiceToolName.sendSessionMessage.rawValue,
            arguments: identity().merging(["text": "hello"]) { $1 },
            context: context(
                mintedTools: everyTool,
                sessions: [RosterSession(id: "s1", canReceiveMessage: true)],
                http: http,
                count: { _, _ in counted += 1 },
                refreshRoster: { refreshes += 1 }
            )
        )
        XCTAssertEqual(output, #"{"reason":"The session moved on.","result":"rejected"}"#)
        XCTAssertEqual(counted, 0)
        XCTAssertEqual(refreshes, 0)
    }

    func testAMessageToAClosedInboxNeverReachesTheEndpoint() async {
        let http = StubHTTPClient { _ in
            XCTFail("A refused ask must not be sent.")
            throw URLError(.badServerResponse)
        }
        let output = await dispatchVoiceToolCall(
            name: VoiceToolName.sendSessionMessage.rawValue,
            arguments: identity().merging(["text": "hello"]) { $1 },
            context: context(mintedTools: everyTool, sessions: [RosterSession(id: "s1")], http: http)
        )
        XCTAssertEqual(
            output, #"{"reason":"That session does not take messages right now.","result":"rejected"}"#
        )
    }

    func testASignedOutCredentialIsSaidAsSuch() async {
        let output = await dispatchVoiceToolCall(
            name: VoiceToolName.sendSessionMessage.rawValue,
            arguments: identity().merging(["text": "hello"]) { $1 },
            context: context(
                mintedTools: everyTool,
                sessions: [RosterSession(id: "s1", canReceiveMessage: true)],
                accessToken: { throw AccountSessionError.signedOut }
            )
        )
        XCTAssertEqual(output, #"{"error":"signed out"}"#)
    }

    func testACreationAskWaitsForTheProjectsAnswer() async {
        let output = await dispatchVoiceToolCall(
            name: VoiceToolName.createWorkspace.rawValue,
            arguments: ["provider_id": "conductor", "project_id": "p1"],
            context: context(mintedTools: everyTool)
        )
        XCTAssertEqual(
            output,
            #"{"reason":"The projects a workspace can be created in have not loaded yet.","result":"rejected"}"#
        )
    }
}

private extension RosterSession {
    init(id: String, status: String = "working", canReceiveMessage: Bool = false) {
        self.init(
            providerId: "conductor",
            sessionId: id,
            title: "Session \(id)",
            status: status,
            canReceiveMessage: canReceiveMessage
        )
    }
}
