import Foundation

/// The platforms the service registers push tokens for. Mirrors
/// `DEVICE_PLATFORM` in `@sidecar/hosted`.
public enum DevicePlatform: String, Sendable {
    case ios
}

/// Which of Apple's two push gateways issued this installation's token.
/// Mirrors `PUSH_ENVIRONMENT` in `@sidecar/hosted`: a build run from Xcode
/// registers with the sandbox gateway, one from TestFlight or the App Store
/// with production, and a token sent to the wrong gateway is refused, so the
/// registration says which.
public enum PushEnvironment: String, Sendable, Equatable {
    case sandbox
    case production
}

/// The device token as the service stores it: Apple's bytes as lowercase
/// hex, bounded the way `deviceTokenIsStorable` bounds it.
public enum DeviceToken {
    public static let minimumLength = 32
    public static let maximumLength = 512

    public static func hex(from data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    /// The server's own shape check, applied here so a token it would refuse
    /// never travels.
    public static func isStorable(_ token: String) -> Bool {
        token.count >= minimumLength
            && token.count <= maximumLength
            && token.allSatisfy { $0.isHexDigit && ($0.isNumber || $0.isLowercase) }
    }
}

public enum DeviceClientError: Error, Equatable, HostedUnauthorizedSignaling {
    /// The answer was not the shape the wire contract promises.
    case invalidResponse
    /// The token failed the same shape check the server applies.
    case invalidToken
    case serverError(status: Int, apiError: HostedAPIError?)

    public var isUnauthorized: Bool {
        if case .serverError(let status, _) = self { return status == 401 }
        return false
    }
}

/// Client for the device-token endpoint. Paths, body shapes, and answer
/// validation mirror the wire contract in `@sidecar/hosted` and the handler
/// in `apps/web/server/hosted/devices.ts`.
public final class DeviceClient: Sendable {
    private let baseURL: URL
    private let http: HTTPClient

    /// `baseURL` is the hosted service origin; the endpoint lives under `/api/devices` on it.
    public init(baseURL: URL, http: HTTPClient = URLSession.shared) {
        self.baseURL = baseURL
        self.http = http
    }

    /// Registers this installation's token under the signed-in account. POST
    /// /api/devices/token. A token already on file moves to this account.
    public func register(
        token: String, environment: PushEnvironment, accessToken: String
    ) async throws {
        guard DeviceToken.isStorable(token) else { throw DeviceClientError.invalidToken }
        let json = try await send(
            method: "POST",
            body: [
                "token": token,
                "platform": DevicePlatform.ios.rawValue,
                "environment": environment.rawValue,
            ],
            accessToken: accessToken
        )
        guard json["stored"] as? Bool == true else { throw DeviceClientError.invalidResponse }
    }

    /// Forgets this installation's token at sign-out. DELETE /api/devices/token.
    /// Returns whether the account held it.
    public func unregister(token: String, accessToken: String) async throws -> Bool {
        guard DeviceToken.isStorable(token) else { throw DeviceClientError.invalidToken }
        let json = try await send(method: "DELETE", body: ["token": token], accessToken: accessToken)
        guard let deleted = json["deleted"] as? Bool else { throw DeviceClientError.invalidResponse }
        return deleted
    }

    private func send(
        method: String, body: [String: String], accessToken: String
    ) async throws -> [String: Any] {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/devices/token"))
        request.httpMethod = method
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await http.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        guard (200 ..< 300).contains(status) else {
            let reason = (json["error"] as? String).flatMap(HostedAPIError.init(rawValue:))
            throw DeviceClientError.serverError(status: status, apiError: reason)
        }
        return json
    }
}
