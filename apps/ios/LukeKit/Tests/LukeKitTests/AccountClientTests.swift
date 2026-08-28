import Foundation
import XCTest

@testable import LukeKit

// MARK: - HTTP stub

struct StubHTTPClient: HTTPClient {
    var handler: @Sendable (URLRequest) async throws -> (Data, URLResponse)

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await handler(request)
    }
}

private func makeResponse(url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

private func jsonData(_ dict: [String: Any]) -> Data {
    try! JSONSerialization.data(withJSONObject: dict)
}

// MARK: - Authorize URL tests

final class AuthorizeURLTests: XCTestCase {
    private let base = URL(string: "https://tryluke.dev/api/auth")!

    func testRequiredParams() {
        let client = AccountClient(baseURL: base, clientID: "luke-mobile")
        let url = client.authorizeURL(
            redirectURI: "dev.tryluke.ios://oauth/callback",
            state: "abc123",
            codeChallenge: "challenge"
        )
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
        let params = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })

        XCTAssertEqual(params["client_id"], "luke-mobile")
        XCTAssertEqual(params["response_type"], "code")
        XCTAssertEqual(params["redirect_uri"], "dev.tryluke.ios://oauth/callback")
        XCTAssertEqual(params["state"], "abc123")
        XCTAssertEqual(params["code_challenge"], "challenge")
        XCTAssertEqual(params["code_challenge_method"], "S256")
        XCTAssertEqual(params["prompt"], "login")
        XCTAssertTrue(params["scope"]?.contains("openid") == true)
        XCTAssertTrue(params["scope"]?.contains("offline_access") == true)
    }

    func testPath() {
        let client = AccountClient(baseURL: base, clientID: "luke-mobile")
        let url = client.authorizeURL(redirectURI: "", state: "", codeChallenge: "")
        XCTAssertTrue(url.absoluteString.hasPrefix("https://tryluke.dev/api/auth/oauth2/authorize"))
    }
}

// MARK: - Token response parsing tests

final class TokenResponseTests: XCTestCase {
    private let base = URL(string: "https://example.com")!

    func testSuccessfulExchange() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertTrue(request.url?.path.hasSuffix("oauth2/token") == true)
            let body = String(data: request.httpBody ?? Data(), encoding: .utf8) ?? ""
            XCTAssertTrue(body.contains("grant_type=authorization_code"))
            let payload: [String: Any] = [
                "access_token": "at-xyz",
                "refresh_token": "rt-xyz",
                "expires_in": 3600,
            ]
            return (jsonData(payload), makeResponse(url: request.url!, status: 200))
        }
        let client = AccountClient(baseURL: base, clientID: "c", http: stub)
        let tokens = try await client.exchangeCode(
            code: "code",
            codeVerifier: "verifier",
            redirectURI: "scheme://cb"
        )
        XCTAssertEqual(tokens.accessToken, "at-xyz")
        XCTAssertEqual(tokens.refreshToken, "rt-xyz")
        XCTAssertGreaterThan(tokens.expiry, Date())
    }

    func testMissingTokensThrows() async {
        let stub = StubHTTPClient { request in
            (jsonData(["token_type": "bearer"]), makeResponse(url: request.url!, status: 200))
        }
        let client = AccountClient(baseURL: base, clientID: "c", http: stub)
        do {
            _ = try await client.exchangeCode(code: "c", codeVerifier: "v", redirectURI: "s://cb")
            XCTFail("Expected throw")
        } catch AccountClientError.tokensMissing {
            // expected
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testServerErrorPropagates() async {
        let stub = StubHTTPClient { request in
            (jsonData(["error": "invalid_grant"]), makeResponse(url: request.url!, status: 400))
        }
        let client = AccountClient(baseURL: base, clientID: "c", http: stub)
        do {
            _ = try await client.exchangeCode(code: "c", codeVerifier: "v", redirectURI: "s://cb")
            XCTFail("Expected throw")
        } catch AccountClientError.serverError(let status, let oauthError) {
            XCTAssertEqual(status, 400)
            XCTAssertEqual(oauthError, "invalid_grant")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }
}

// MARK: - Refresh-retry logic tests

final class RefreshRetryTests: XCTestCase {
    private let base = URL(string: "https://example.com")!

    func testRefreshReturnsFreshTokens() async throws {
        let stub = StubHTTPClient { request in
            guard let body = String(data: request.httpBody ?? Data(), encoding: .utf8),
                  body.contains("grant_type=refresh_token")
            else {
                XCTFail("Expected refresh_token grant")
                return (Data(), makeResponse(url: request.url!, status: 500))
            }
            let payload: [String: Any] = [
                "access_token": "new-at",
                "refresh_token": "new-rt",
                "expires_in": 3600,
            ]
            return (jsonData(payload), makeResponse(url: request.url!, status: 200))
        }
        let client = AccountClient(baseURL: base, clientID: "c", http: stub)
        let tokens = try await client.refresh(refreshToken: "old-rt")
        XCTAssertEqual(tokens.accessToken, "new-at")
        XCTAssertEqual(tokens.refreshToken, "new-rt")
    }

    func testRejectedRefreshThrows401() async {
        let stub = StubHTTPClient { request in
            (jsonData(["error": "invalid_grant"]), makeResponse(url: request.url!, status: 401))
        }
        let client = AccountClient(baseURL: base, clientID: "c", http: stub)
        do {
            _ = try await client.refresh(refreshToken: "bad-rt")
            XCTFail("Expected throw")
        } catch AccountClientError.serverError(let status, _) {
            XCTAssertEqual(status, 401)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }
}
