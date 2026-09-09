import Foundation

/// The platforms a device row may name — `DEVICE_PLATFORM` in
/// `@sidecar/hosted`. Every app that registers itself names one, and the
/// desktop names the third.
public enum DevicePlatform: String, CaseIterable, Sendable {
    case macOS = "macos"
    case iOS = "ios"
    case watchOS = "watchos"
}

/// Which of Apple's two push gateways issued a token — `PUSH_ENVIRONMENT` in
/// `@sidecar/hosted`. A build run from Xcode registers with the sandbox and one
/// from TestFlight or the App Store with production; a token sent to the wrong
/// gateway is refused, so the registration says which.
public enum PushEnvironment: String, CaseIterable, Sendable {
    case sandbox
    case production
}

/// A push token with the gateway that issued it, as a row stores the pair.
public struct DevicePushAddress: Sendable, Equatable {
    public let token: String
    public let environment: PushEnvironment

    public init(token: String, environment: PushEnvironment) {
        self.token = token
        self.environment = environment
    }
}

/// What a heartbeat says about the push token on file: nothing, that it is
/// gone, or what it is now. Mirrors the heartbeat request's `pushToken` field,
/// which is absent, `null`, or a token with its gateway.
public enum PushTokenChange: Sendable, Equatable {
    case unchanged
    case cleared
    case replaced(DevicePushAddress)
}

public enum DeviceClientError: Error, Equatable, HostedUnauthorizedSignaling {
    /// The answer was not the shape the wire contract promises. A malformed
    /// answer is discarded rather than repaired, the same posture as the wire
    /// readers in `@sidecar/hosted`.
    case invalidResponse
    /// An id or token failed the same shape check the server applies. Refused
    /// here so a request the service would refuse never travels.
    case invalidRequest
    case serverError(status: Int, apiError: HostedAPIError?)

    public var isUnauthorized: Bool {
        if case .serverError(let status, _) = self { return status == 401 }
        return false
    }
}

/// Client for the one hosted devices path and its three methods. Paths, body
/// shapes, and answer validation mirror `device-wire.ts` in `@sidecar/hosted`
/// and the handler in `apps/web/server/hosted/devices.ts`.
public final class DeviceClient: Sendable {
    private let baseURL: URL
    private let http: HTTPClient

    /// `baseURL` is the hosted service origin; the endpoint lives at `/api/devices` on it.
    public init(baseURL: URL, http: HTTPClient = URLSession.shared) {
        self.baseURL = baseURL
        self.http = http
    }

    /// `HOSTED_SERVICE_PATH.DEVICES`, without its leading slash.
    public static let path = "api/devices"

    /// The bounds a push token sits inside — `DEVICE_TOKEN_BOUNDS`.
    public static let tokenMinLength = 32
    public static let tokenMaxLength = 512

    /// Every id on this wire is a lowercase hyphenated UUID, which is the one
    /// form either side ever writes.
    public static func isWireId(_ value: String) -> Bool {
        value.range(
            of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            options: .regularExpression
        ) != nil
    }

    /// The server's own shape check on a token: bounded lowercase hex.
    public static func isStorableToken(_ token: String) -> Bool {
        (tokenMinLength ... tokenMaxLength).contains(token.count)
            && token.range(of: "^[0-9a-f]+$", options: .regularExpression) != nil
    }

    /// Apple hands the app its token as bytes; the wire carries the lowercase hex.
    public static func hexToken(_ token: Data) -> String {
        token.map { String(format: "%02x", $0) }.joined()
    }

    /// Registers this installation under the signed-in account and answers the
    /// row's id. POST /api/devices. A row already standing under the
    /// installation id moves to this account.
    public func register(
        platform: DevicePlatform,
        installationId: String,
        push: DevicePushAddress?,
        accessToken: String
    ) async throws -> String {
        guard Self.isWireId(installationId) else { throw DeviceClientError.invalidRequest }
        var body: [String: Any] = [
            "platform": platform.rawValue,
            "installationId": installationId,
        ]
        if let push {
            guard Self.isStorableToken(push.token) else { throw DeviceClientError.invalidRequest }
            body["pushToken"] = push.token
            body["pushEnvironment"] = push.environment.rawValue
        }
        let json = try await send(method: "POST", body: body, accessToken: accessToken)
        guard let deviceId = json["deviceId"] as? String, Self.isWireId(deviceId) else {
            throw DeviceClientError.invalidResponse
        }
        return deviceId
    }

    /// Moves the row's last-seen instant and carries a push token change.
    /// PUT /api/devices. Answers whether the account still holds the row;
    /// `false` means the caller registers again.
    public func heartbeat(
        deviceId: String,
        pushToken: PushTokenChange,
        accessToken: String
    ) async throws -> Bool {
        guard Self.isWireId(deviceId) else { throw DeviceClientError.invalidRequest }
        var body: [String: Any] = ["deviceId": deviceId]
        switch pushToken {
        case .unchanged:
            break
        case .cleared:
            body["pushToken"] = NSNull()
        case .replaced(let push):
            guard Self.isStorableToken(push.token) else { throw DeviceClientError.invalidRequest }
            body["pushToken"] = push.token
            body["pushEnvironment"] = push.environment.rawValue
        }
        let json = try await send(method: "PUT", body: body, accessToken: accessToken)
        guard let seen = json["seen"] as? Bool else { throw DeviceClientError.invalidResponse }
        return seen
    }

    /// Forgets the row at sign-out. DELETE /api/devices. Answers whether a row went.
    public func forget(deviceId: String, accessToken: String) async throws -> Bool {
        guard Self.isWireId(deviceId) else { throw DeviceClientError.invalidRequest }
        let json = try await send(
            method: "DELETE", body: ["deviceId": deviceId], accessToken: accessToken
        )
        guard let deleted = json["deleted"] as? Bool else { throw DeviceClientError.invalidResponse }
        return deleted
    }

    private func send(
        method: String,
        body: [String: Any],
        accessToken: String
    ) async throws -> [String: Any] {
        var request = URLRequest(url: baseURL.appendingPathComponent(Self.path))
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
