import Foundation
import XCTest

@testable import LukeKit

// MARK: - Helpers

private func makeResponse(url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

private func jsonData(_ dict: [String: Any]) -> Data {
    try! JSONSerialization.data(withJSONObject: dict)
}

private let baseURL = URL(string: "https://tryluke.dev")!

private final class StubHTTP: HTTPClient, @unchecked Sendable {
    var data: Data
    var response: URLResponse

    init(json: [String: Any], status: Int = 200) {
        data = jsonData(json)
        response = makeResponse(url: baseURL, status: status)
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        (data, response)
    }
}

// MARK: - Tests

final class VoiceMintClientResponseTests: XCTestCase {
    private let client = VoiceMintClient(baseURL: baseURL, http: StubHTTP(json: [:]))

    func testAcceptsWellFormedResponse() async throws {
        let stub = StubHTTP(json: validPayload())
        let client = VoiceMintClient(baseURL: baseURL, http: stub)
        let conn = try await client.mint(accessToken: "tok")
        XCTAssertEqual(conn.ephemeralKey, "ek_test")
        XCTAssertEqual(conn.model, "gpt-4o-realtime")
        XCTAssertTrue(conn.wsURL.scheme == "wss")
        XCTAssertEqual(conn.sessionsContext.itemId, "luke_ctx_sessions_0")
        XCTAssertFalse(conn.sessionsContext.text.isEmpty)
    }

    func testRejectsResponseMissingConnectionBlock() async {
        let payload: [String: Any] = ["context": contextBlock()]
        let stub = StubHTTP(json: payload)
        let client = VoiceMintClient(baseURL: baseURL, http: stub)
        do {
            _ = try await client.mint(accessToken: "tok")
            XCTFail("Expected invalidResponse")
        } catch VoiceMintClientError.invalidResponse {
            // expected
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testRejectsResponseMissingContextBlock() async {
        let payload: [String: Any] = ["connection": connectionBlock()]
        let stub = StubHTTP(json: payload)
        let client = VoiceMintClient(baseURL: baseURL, http: stub)
        do {
            _ = try await client.mint(accessToken: "tok")
            XCTFail("Expected invalidResponse")
        } catch VoiceMintClientError.invalidResponse {
            // expected
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testThrowsQuotaExhaustedOnQuotaError() async {
        let stub = StubHTTP(
            json: ["error": "quota-exhausted"],
            status: 429
        )
        let client = VoiceMintClient(baseURL: baseURL, http: stub)
        do {
            _ = try await client.mint(accessToken: "tok")
            XCTFail("Expected quotaExhausted")
        } catch VoiceMintClientError.quotaExhausted {
            // expected
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testThrowsServerErrorOnHTTPFailure() async {
        let stub = StubHTTP(
            json: ["error": "invalid-token"],
            status: 401
        )
        let client = VoiceMintClient(baseURL: baseURL, http: stub)
        do {
            _ = try await client.mint(accessToken: "bad-token")
            XCTFail("Expected serverError")
        } catch VoiceMintClientError.serverError(let status, let reason) {
            XCTAssertEqual(status, 401)
            XCTAssertEqual(reason, .invalidToken)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testRejectsNonWssScheme() async {
        var conn = connectionBlock()
        conn["wsUrl"] = "http://example.com/realtime"
        let stub = StubHTTP(json: ["connection": conn, "context": contextBlock()])
        let client = VoiceMintClient(baseURL: baseURL, http: stub)
        do {
            _ = try await client.mint(accessToken: "tok")
            XCTFail("Expected invalidResponse")
        } catch VoiceMintClientError.invalidResponse {
            // expected
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testRejectsEmptyEphemeralKey() async {
        var conn = connectionBlock()
        conn["value"] = ""
        let stub = StubHTTP(json: ["connection": conn, "context": contextBlock()])
        let client = VoiceMintClient(baseURL: baseURL, http: stub)
        do {
            _ = try await client.mint(accessToken: "tok")
            XCTFail("Expected invalidResponse")
        } catch VoiceMintClientError.invalidResponse {
            // expected
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    // MARK: - Fixtures

    private func connectionBlock() -> [String: Any] {
        [
            "value": "ek_test",
            "expiresAt": Double(Date().timeIntervalSince1970 * 1000 + 60_000),
            "model": "gpt-4o-realtime",
            "wsUrl": "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime",
            "callsUrl": "https://api.openai.com/v1/realtime/calls",
        ]
    }

    private func contextBlock() -> [String: Any] {
        ["sessions": ["itemId": "luke_ctx_sessions_0", "text": "No sessions observed."]]
    }

    private func validPayload() -> [String: Any] {
        [
            "connection": connectionBlock(),
            "quota": ["used": 1, "limit": 10, "remaining": 9, "resetsAt": 0],
            "context": contextBlock(),
        ]
    }
}
