import XCTest

@testable import LukeKit

// MARK: - PKCE

final class PKCETests: XCTestCase {
    func testVerifierLength() {
        let pkce = PKCE()
        XCTAssertGreaterThanOrEqual(pkce.verifier.count, 43)
        XCTAssertLessThanOrEqual(pkce.verifier.count, 128)
    }

    func testVerifierCharset() {
        let pkce = PKCE()
        let allowed = CharacterSet(
            charactersIn:
                "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
        )
        XCTAssertTrue(pkce.verifier.unicodeScalars.allSatisfy { allowed.contains($0) })
    }

    func testChallengeNoPadding() {
        let pkce = PKCE()
        XCTAssertFalse(pkce.challenge.contains("="))
    }

    /// RFC 7636 Appendix B known vector.
    func testKnownVector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        let expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        XCTAssertEqual(PKCE.challenge(for: verifier), expected)
    }
}

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

// MARK: - Authorize URL

final class AuthorizeURLTests: XCTestCase {
    private let base = URL(string: "https://tryluke.dev/api/auth")!

    func testRequiredParams() {
        let client = AccountClient(baseURL: base, clientID: "luke-mobile")
        let url = client.authorizeURL(
            redirectURI: "dev.tryluke.ios://oauth/callback",
            state: "state123",
            codeChallenge: "challenge"
        )
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
        let params = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })

        XCTAssertEqual(params["client_id"], "luke-mobile")
        XCTAssertEqual(params["response_type"], "code")
        XCTAssertEqual(params["redirect_uri"], "dev.tryluke.ios://oauth/callback")
        XCTAssertEqual(params["state"], "state123")
        XCTAssertEqual(params["code_challenge"], "challenge")
        XCTAssertEqual(params["code_challenge_method"], "S256")
        XCTAssertEqual(params["prompt"], "login")
        XCTAssertTrue(params["scope"]?.contains("openid") == true)
        XCTAssertTrue(params["scope"]?.contains("offline_access") == true)
    }
}

// MARK: - Token response parsing

final class TokenResponseTests: XCTestCase {
    private let base = URL(string: "https://example.com")!

    func testSuccessfulParse() async throws {
        let stub = StubHTTPClient { request in
            let payload: [String: Any] = [
                "access_token": "at-xyz",
                "refresh_token": "rt-xyz",
                "expires_in": 3600,
            ]
            return (jsonData(payload), makeResponse(url: request.url!, status: 200))
        }
        let client = AccountClient(baseURL: base, clientID: "c", http: stub)
        let tokens = try await client.exchangeCode(
            code: "code", codeVerifier: "verifier", redirectURI: "s://cb"
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
            XCTFail("Unexpected: \(error)")
        }
    }

    func testServerErrorCarriesOAuthError() async {
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
            XCTFail("Unexpected: \(error)")
        }
    }
}

// MARK: - Userinfo identity

final class UserInfoTests: XCTestCase {
    private let base = URL(string: "https://example.com")!

    private func identity(fromUserInfo payload: [String: Any]) async throws -> AccountIdentity {
        let stub = StubHTTPClient { request in
            (jsonData(payload), makeResponse(url: request.url!, status: 200))
        }
        let client = AccountClient(baseURL: base, clientID: "c", http: stub)
        return try await client.userInfo(accessToken: "at")
    }

    func testCarriesProviderHostedPicture() async throws {
        let identity = try await identity(fromUserInfo: [
            "email": "dev@example.com",
            "picture": "https://avatars.githubusercontent.com/u/1?v=4",
        ])
        XCTAssertEqual(
            identity.pictureURL?.absoluteString,
            "https://avatars.githubusercontent.com/u/1?v=4"
        )
    }

    func testDropsPictureFromOtherHosts() async throws {
        let identity = try await identity(fromUserInfo: [
            "email": "dev@example.com",
            "picture": "https://example.com/photo.png",
        ])
        XCTAssertNil(identity.pictureURL)
    }

    func testInitialsFallBackFromNameToEmail() {
        let named = AccountIdentity(id: nil, email: "x@example.com", name: "Ada King Lovelace")
        XCTAssertEqual(named.initials, "AL")
        let unnamed = AccountIdentity(id: nil, email: "ada.lovelace@example.com", name: nil)
        XCTAssertEqual(unnamed.initials, "AL")
    }
}

// MARK: - Refresh retry decision

final class RefreshRetryTests: XCTestCase {
    private let base = URL(string: "https://example.com")!

    func testRefreshSendsCorrectGrant() async throws {
        let stub = StubHTTPClient { request in
            let body = String(data: request.httpBody ?? Data(), encoding: .utf8) ?? ""
            XCTAssertTrue(body.contains("grant_type=refresh_token"))
            XCTAssertTrue(body.contains("refresh_token=old-rt"))
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
    }

    func testRejectedRefreshThrows() async {
        let stub = StubHTTPClient { request in
            (jsonData(["error": "invalid_grant"]), makeResponse(url: request.url!, status: 401))
        }
        let client = AccountClient(baseURL: base, clientID: "c", http: stub)
        do {
            _ = try await client.refresh(refreshToken: "bad")
            XCTFail("Expected throw")
        } catch AccountClientError.serverError(let status, _) {
            XCTAssertEqual(status, 401)
        } catch {
            XCTFail("Unexpected: \(error)")
        }
    }
}
