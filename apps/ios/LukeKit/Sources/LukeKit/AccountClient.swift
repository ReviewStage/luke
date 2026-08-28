import Foundation

public enum AccountClientError: Error, Equatable {
    case invalidResponse
    case tokensMissing
    case serverError(status: Int, oauthError: String?)
}

/// Protocol-based HTTP abstraction so tests can inject stubs without network access.
public protocol HTTPClient: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: HTTPClient {
    public func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await data(for: request, delegate: nil)
    }
}

public struct AccountTokens: Sendable {
    public let accessToken: String
    public let refreshToken: String
    public let expiry: Date

    public init(accessToken: String, refreshToken: String, expiry: Date) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiry = expiry
    }
}

public struct AccountIdentity: Sendable {
    public let id: String?
    public let email: String
    public let name: String?

    public init(id: String?, email: String, name: String?) {
        self.id = id
        self.email = email
        self.name = name
    }
}

public final class AccountClient: Sendable {
    private let baseURL: URL
    private let clientID: String
    private let http: HTTPClient

    public init(baseURL: URL, clientID: String, http: HTTPClient = URLSession.shared) {
        self.baseURL = baseURL
        self.clientID = clientID
        self.http = http
    }

    public func authorizeURL(redirectURI: String, state: String, codeChallenge: String) -> URL {
        var components = URLComponents(
            url: baseURL.appendingPathComponent("oauth2/authorize"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: codeChallenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "scope", value: AccountConstants.scopes),
            URLQueryItem(name: "prompt", value: "login"),
        ]
        return components.url!
    }

    public func exchangeCode(code: String, codeVerifier: String, redirectURI: String) async throws
        -> AccountTokens
    {
        try await tokenRequest(fields: [
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": codeVerifier,
            "client_id": clientID,
            "redirect_uri": redirectURI,
        ])
    }

    public func refresh(refreshToken: String) async throws -> AccountTokens {
        try await tokenRequest(
            fields: [
                "grant_type": "refresh_token",
                "refresh_token": refreshToken,
                "client_id": clientID,
            ],
            fallbackRefreshToken: refreshToken
        )
    }

    /// Revokes the long-lived credential; local sign-out never depends on this succeeding.
    public func revoke(refreshToken: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("oauth2/revoke"))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = formEncode([
            "client_id": clientID,
            "token": refreshToken,
            "token_type_hint": "refresh_token",
        ])
        let (_, response) = try await http.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if !(200 ..< 300).contains(status) {
            throw AccountClientError.serverError(status: status, oauthError: nil)
        }
    }

    public func userInfo(accessToken: String) async throws -> AccountIdentity {
        var request = URLRequest(url: baseURL.appendingPathComponent("oauth2/userinfo"))
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await http.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ..< 300).contains(status) else {
            throw AccountClientError.serverError(status: status, oauthError: nil)
        }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let email = json["email"] as? String
        else {
            throw AccountClientError.invalidResponse
        }
        return AccountIdentity(
            id: json["sub"] as? String,
            email: email,
            name: json["name"] as? String
        )
    }

    // `fallbackRefreshToken` is used when the server does not rotate the token on refresh.
    private func tokenRequest(
        fields: [String: String],
        fallbackRefreshToken: String? = nil
    ) async throws -> AccountTokens {
        var request = URLRequest(url: baseURL.appendingPathComponent("oauth2/token"))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = formEncode(fields)
        let (data, response) = try await http.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        guard (200 ..< 300).contains(status) else {
            throw AccountClientError.serverError(status: status, oauthError: json["error"] as? String)
        }
        guard let accessToken = json["access_token"] as? String,
              let refreshToken = (json["refresh_token"] as? String) ?? fallbackRefreshToken
        else {
            throw AccountClientError.tokensMissing
        }
        let expiresIn = json["expires_in"] as? TimeInterval ?? 3600
        return AccountTokens(
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiry: Date(timeIntervalSinceNow: expiresIn)
        )
    }

    private func formEncode(_ fields: [String: String]) -> Data {
        // urlQueryAllowed leaves +, &, and = unescaped; remove them so field values
        // containing those characters are not misread by the server.
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "+&=")
        return fields
            .map { k, v in
                let ek = k.addingPercentEncoding(withAllowedCharacters: allowed) ?? k
                let ev = v.addingPercentEncoding(withAllowedCharacters: allowed) ?? v
                return "\(ek)=\(ev)"
            }
            .joined(separator: "&")
            .data(using: .utf8)!
    }
}
