import Foundation
import XCTest

@testable import LukeKit

// MARK: - Helpers (StubHTTPClient from AccountClientTests is @testable so no re-declare)

private let serviceURL = URL(string: "https://tryluke.dev")!

private func makeObserveResponse(sessions: [[String: Any]], status: Int = 200) -> (Data, URLResponse) {
    let body = try! JSONSerialization.data(withJSONObject: ["sessions": sessions])
    let response = HTTPURLResponse(
        url: serviceURL.appendingPathComponent("api/observe"),
        statusCode: status,
        httpVersion: nil,
        headerFields: nil
    )!
    return (body, response)
}

// MARK: - RosterSession parsing

final class RosterSessionTests: XCTestCase {
    func testRequiredFieldsMissing() {
        XCTAssertNil(RosterSession(json: [:]))
        XCTAssertNil(RosterSession(json: ["providerId": "conductor"]))
        XCTAssertNil(
            RosterSession(json: [
                "providerId": "conductor",
                "sessionId": "s1",
                // title missing
                "status": "working",
            ])
        )
    }

    func testAllRequiredFields() {
        let s = RosterSession(json: [
            "providerId": "conductor",
            "sessionId": "sess-1",
            "title": "My PR",
            "status": "working",
        ])
        XCTAssertNotNil(s)
        XCTAssertEqual(s?.id, "conductor:sess-1")
        XCTAssertEqual(s?.title, "My PR")
        XCTAssertNil(s?.workspace)
        XCTAssertNil(s?.recap)
    }

    func testOptionalFields() {
        let s = RosterSession(json: [
            "providerId": "codex",
            "sessionId": "sess-2",
            "title": "Task",
            "status": "waiting",
            "workspace": "my-repo",
            "branch": "main",
            "change": "https://github.com/ReviewStage/luke/pull/642",
            "link": "conductor://workspace?id=ws-1&session=sess-2",
            "recap": "Waiting for approval",
        ])
        XCTAssertEqual(s?.workspace, "my-repo")
        XCTAssertEqual(s?.branch, "main")
        XCTAssertEqual(s?.change, URL(string: "https://github.com/ReviewStage/luke/pull/642"))
        XCTAssertEqual(s?.link, URL(string: "conductor://workspace?id=ws-1&session=sess-2"))
        XCTAssertEqual(s?.recap, "Waiting for approval")
        XCTAssertNil(s?.error)
    }

    func testLastActivityReadsTheNewNameAndFallsBackToTheOld() {
        let base: [String: Any] = [
            "providerId": "codex",
            "sessionId": "sess-3",
            "title": "Task",
            "status": "working",
        ]
        var renamed = base
        renamed["lastActivityAt"] = 2_000.0
        renamed["observedAt"] = 1_000.0
        XCTAssertEqual(RosterSession(json: renamed)?.lastActivityAt, Date(timeIntervalSince1970: 2))

        var legacy = base
        legacy["observedAt"] = 1_000.0
        XCTAssertEqual(RosterSession(json: legacy)?.lastActivityAt, Date(timeIntervalSince1970: 1))

        XCTAssertNil(RosterSession(json: base)?.lastActivityAt)
    }

    func testPublishedChangeMustBeAnHTTPSAddress() {
        let base: [String: Any] = [
            "providerId": "codex",
            "sessionId": "sess-change",
            "title": "Task",
            "status": "complete",
        ]

        for invalid in ["/relative", "http://github.com/owner/repo/pull/1", "javascript:alert(1)"] {
            var json = base
            json["change"] = invalid
            XCTAssertNil(RosterSession(json: json)?.change)
        }
    }

    func testSessionLinkMustWearAnOpenableScheme() {
        let base: [String: Any] = [
            "providerId": "conductor",
            "sessionId": "sess-link",
            "title": "Deep-linked chat",
            "status": "working",
        ]

        for valid in [
            "conductor://workspace?id=ws-1&session=sess-link",
            "https://app.conductor.build/sessions/sess-link",
        ] {
            var json = base
            json["link"] = valid
            XCTAssertEqual(RosterSession(json: json)?.link, URL(string: valid))
        }

        for invalid in ["/relative", "javascript:alert(1)", "file:///etc/passwd"] {
            var json = base
            json["link"] = invalid
            XCTAssertNil(RosterSession(json: json)?.link)
        }
    }
}

// MARK: - RosterClient

final class RosterClientTests: XCTestCase {
    func testObserveReturnsSessionsOnSuccess() async throws {
        let stub = StubHTTPClient { _ in
            makeObserveResponse(sessions: [
                ["providerId": "conductor", "sessionId": "s1", "title": "PR review", "status": "working"],
            ])
        }
        let client = RosterClient(serviceURL: serviceURL, http: stub)
        let sessions = try await client.observe(bearerToken: "tok-1")
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions[0].title, "PR review")
    }

    func testObserveSendsAuthorizationHeader() async throws {
        var capturedRequest: URLRequest?
        let stub = StubHTTPClient { request in
            capturedRequest = request
            return makeObserveResponse(sessions: [])
        }
        let client = RosterClient(serviceURL: serviceURL, http: stub)
        _ = try await client.observe(bearerToken: "tok-xyz")
        XCTAssertEqual(capturedRequest?.value(forHTTPHeaderField: "Authorization"), "Bearer tok-xyz")
    }

    func testObserveThrowsOnNonSuccess() async {
        let stub = StubHTTPClient { _ in
            makeObserveResponse(sessions: [], status: 401)
        }
        let client = RosterClient(serviceURL: serviceURL, http: stub)
        do {
            _ = try await client.observe(bearerToken: "bad-token")
            XCTFail("Expected throw")
        } catch RosterClientError.serverError(let status) {
            XCTAssertEqual(status, 401)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testObserveSkipsMalformedSessionEntries() async throws {
        let stub = StubHTTPClient { _ in
            makeObserveResponse(sessions: [
                ["providerId": "conductor", "sessionId": "s1", "title": "Good", "status": "complete"],
                ["providerId": "conductor"],  // missing required fields — skipped
            ])
        }
        let client = RosterClient(serviceURL: serviceURL, http: stub)
        let sessions = try await client.observe(bearerToken: "tok-1")
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions[0].sessionId, "s1")
    }
}

// MARK: - Act advertisements

final class RosterSessionActAdvertisementTests: XCTestCase {
    func testAdvertisementsAbsentByDefault() {
        let s = RosterSession(json: [
            "providerId": "conductor",
            "sessionId": "task-1",
            "title": "Read-only task",
            "status": "working",
        ])
        XCTAssertEqual(s?.canReceiveMessage, false)
        XCTAssertEqual(s?.controls, [])
        XCTAssertEqual(s?.spawnableAgents, [])
        XCTAssertEqual(s?.canRename, false)
        XCTAssertEqual(s?.canRenameWorkspace, false)
    }

    func testAdvertisementsDecodeAndMalformedControlsAreSkipped() {
        let s = RosterSession(json: [
            "providerId": "conductor",
            "sessionId": "sess-1",
            "title": "My PR",
            "status": "working",
            "canReceiveMessage": true,
            "controls": [
                ["id": "cancel-turn", "label": "Stop", "kind": "stop"],
                ["id": "archive-workspace", "label": "Archive", "kind": "archive"],
                ["id": "approve-plan", "label": "Approve the plan", "kind": "someday-kind"],
                ["id": "", "label": "nameless"],
                ["id": "no-label"],
            ],
            "spawnableAgents": ["claude", "codex", ""],
            "canRename": true,
            "canRenameWorkspace": true,
        ])
        XCTAssertEqual(s?.canReceiveMessage, true)
        XCTAssertEqual(
            s?.controls,
            [
                RosterSessionControl(id: "cancel-turn", label: "Stop", kind: .stop),
                RosterSessionControl(id: "archive-workspace", label: "Archive", kind: .archive),
                // A kind this build does not know is dropped; the control stays.
                RosterSessionControl(id: "approve-plan", label: "Approve the plan"),
            ]
        )
        XCTAssertEqual(s?.spawnableAgents, ["claude", "codex"])
        XCTAssertEqual(s?.canRename, true)
        XCTAssertEqual(s?.canRenameWorkspace, true)
    }
}
