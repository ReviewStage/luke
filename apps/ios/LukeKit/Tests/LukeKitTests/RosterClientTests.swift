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
            "providerId": "devin",
            "sessionId": "sess-2",
            "title": "Task",
            "status": "waiting",
            "workspace": "my-repo",
            "branch": "main",
            "recap": "Waiting for approval",
        ])
        XCTAssertEqual(s?.workspace, "my-repo")
        XCTAssertEqual(s?.branch, "main")
        XCTAssertEqual(s?.recap, "Waiting for approval")
        XCTAssertNil(s?.error)
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
