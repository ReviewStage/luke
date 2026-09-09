import Foundation
import XCTest

@testable import LukeKit

private func makeResponse(url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

private func jsonData(_ dict: [String: Any]) -> Data {
    try! JSONSerialization.data(withJSONObject: dict)
}

private let installationId = "0f8fad5b-d9cb-469f-a165-70867728950e"
private let deviceId = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
private let token = String(repeating: "ab", count: 32)

// MARK: - Shapes

final class DeviceWireShapeTests: XCTestCase {
    func testWireIdIsTheCanonicalLowercaseUUID() {
        XCTAssertTrue(DeviceClient.isWireId(installationId))
        XCTAssertFalse(DeviceClient.isWireId(installationId.uppercased()))
        XCTAssertFalse(DeviceClient.isWireId(installationId.replacingOccurrences(of: "-", with: "")))
        XCTAssertFalse(DeviceClient.isWireId("phone-1"))
    }

    func testTokenIsBoundedLowercaseHex() {
        XCTAssertTrue(DeviceClient.isStorableToken(token))
        XCTAssertFalse(DeviceClient.isStorableToken(String(repeating: "ab", count: 15)))
        XCTAssertFalse(DeviceClient.isStorableToken(String(repeating: "ab", count: 257)))
        XCTAssertFalse(DeviceClient.isStorableToken(token.uppercased()))
        XCTAssertFalse(DeviceClient.isStorableToken(String(repeating: "ab", count: 31) + "g1"))
    }

    func testAppleBytesTravelAsLowercaseHex() {
        XCTAssertEqual(DeviceClient.hexToken(Data([0x0a, 0xff, 0x00, 0x1b])), "0aff001b")
    }

    func testEveryPlatformLukeRunsOnIsNamed() {
        XCTAssertEqual(
            DevicePlatform.allCases.map(\.rawValue).sorted(), ["ios", "macos", "watchos"]
        )
        XCTAssertEqual(PushEnvironment.allCases.map(\.rawValue).sorted(), ["production", "sandbox"])
    }
}

// MARK: - Register

final class DeviceRegisterTests: XCTestCase {
    private let base = URL(string: "https://tryluke.dev")!

    func testRegisterSendsWireShapeAndReadsTheDeviceId() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/api/devices")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer at-1")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            let body = try! JSONSerialization.jsonObject(
                with: request.httpBody ?? Data()
            ) as! [String: String]
            XCTAssertEqual(body, ["platform": "ios", "installationId": installationId])
            return (jsonData(["deviceId": deviceId]), makeResponse(url: request.url!, status: 200))
        }
        let client = DeviceClient(baseURL: base, http: stub)
        let answered = try await client.register(
            platform: .iOS, installationId: installationId, push: nil, accessToken: "at-1"
        )
        XCTAssertEqual(answered, deviceId)
    }

    func testRegisterCarriesThePushAddressAsAPair() async throws {
        let stub = StubHTTPClient { request in
            let body = try! JSONSerialization.jsonObject(
                with: request.httpBody ?? Data()
            ) as! [String: String]
            XCTAssertEqual(body, [
                "platform": "watchos",
                "installationId": installationId,
                "pushToken": token,
                "pushEnvironment": "sandbox",
            ])
            return (jsonData(["deviceId": deviceId]), makeResponse(url: request.url!, status: 200))
        }
        let client = DeviceClient(baseURL: base, http: stub)
        _ = try await client.register(
            platform: .watchOS,
            installationId: installationId,
            push: DevicePushAddress(token: token, environment: .sandbox),
            accessToken: "at-1"
        )
    }

    func testRegisterRefusesMalformedInputBeforeItTravels() async {
        let stub = StubHTTPClient { request in
            XCTFail("A malformed registration must never travel")
            return (Data(), makeResponse(url: request.url!, status: 500))
        }
        let client = DeviceClient(baseURL: base, http: stub)
        do {
            _ = try await client.register(
                platform: .iOS, installationId: "phone-1", push: nil, accessToken: "at-1"
            )
            XCTFail("Expected throw")
        } catch DeviceClientError.invalidRequest {
        } catch {
            XCTFail("Unexpected: \(error)")
        }
        do {
            _ = try await client.register(
                platform: .iOS,
                installationId: installationId,
                push: DevicePushAddress(token: "short", environment: .sandbox),
                accessToken: "at-1"
            )
            XCTFail("Expected throw")
        } catch DeviceClientError.invalidRequest {
        } catch {
            XCTFail("Unexpected: \(error)")
        }
    }

    func testRegisterRejectsAnAnswerWithoutAWellFormedId() async {
        let stub = StubHTTPClient { request in
            (jsonData(["deviceId": "row-1"]), makeResponse(url: request.url!, status: 200))
        }
        let client = DeviceClient(baseURL: base, http: stub)
        do {
            _ = try await client.register(
                platform: .iOS, installationId: installationId, push: nil, accessToken: "at-1"
            )
            XCTFail("Expected throw")
        } catch DeviceClientError.invalidResponse {
        } catch {
            XCTFail("Unexpected: \(error)")
        }
    }
}

// MARK: - Heartbeat

final class DeviceHeartbeatTests: XCTestCase {
    private let base = URL(string: "https://tryluke.dev")!

    func testBareHeartbeatNamesOnlyTheDevice() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(request.url?.path, "/api/devices")
            let body = try! JSONSerialization.jsonObject(
                with: request.httpBody ?? Data()
            ) as! [String: Any]
            XCTAssertEqual(body.keys.sorted(), ["deviceId"])
            XCTAssertEqual(body["deviceId"] as? String, deviceId)
            return (jsonData(["seen": true]), makeResponse(url: request.url!, status: 200))
        }
        let client = DeviceClient(baseURL: base, http: stub)
        let seen = try await client.heartbeat(
            deviceId: deviceId, pushToken: .unchanged, accessToken: "at-1"
        )
        XCTAssertTrue(seen)
    }

    func testHeartbeatCarriesAClearedOrReplacedToken() async throws {
        let cleared = StubHTTPClient { request in
            let body = try! JSONSerialization.jsonObject(
                with: request.httpBody ?? Data()
            ) as! [String: Any]
            XCTAssertTrue(body["pushToken"] is NSNull)
            XCTAssertNil(body["pushEnvironment"])
            return (jsonData(["seen": false]), makeResponse(url: request.url!, status: 200))
        }
        let seen = try await DeviceClient(baseURL: base, http: cleared).heartbeat(
            deviceId: deviceId, pushToken: .cleared, accessToken: "at-1"
        )
        XCTAssertFalse(seen)

        let replaced = StubHTTPClient { request in
            let body = try! JSONSerialization.jsonObject(
                with: request.httpBody ?? Data()
            ) as! [String: String]
            XCTAssertEqual(body, [
                "deviceId": deviceId, "pushToken": token, "pushEnvironment": "production",
            ])
            return (jsonData(["seen": true]), makeResponse(url: request.url!, status: 200))
        }
        _ = try await DeviceClient(baseURL: base, http: replaced).heartbeat(
            deviceId: deviceId,
            pushToken: .replaced(DevicePushAddress(token: token, environment: .production)),
            accessToken: "at-1"
        )
    }

    func testHeartbeatRejectsAnAnswerWithoutSeen() async {
        let stub = StubHTTPClient { request in
            (jsonData(["ok": true]), makeResponse(url: request.url!, status: 200))
        }
        do {
            _ = try await DeviceClient(baseURL: base, http: stub).heartbeat(
                deviceId: deviceId, pushToken: .unchanged, accessToken: "at-1"
            )
            XCTFail("Expected throw")
        } catch DeviceClientError.invalidResponse {
        } catch {
            XCTFail("Unexpected: \(error)")
        }
    }
}

// MARK: - Forget and refusals

final class DeviceForgetTests: XCTestCase {
    private let base = URL(string: "https://tryluke.dev")!

    func testForgetSendsTheDeviceAndParsesTheAnswer() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "DELETE")
            XCTAssertEqual(request.url?.path, "/api/devices")
            let body = try! JSONSerialization.jsonObject(
                with: request.httpBody ?? Data()
            ) as! [String: String]
            XCTAssertEqual(body, ["deviceId": deviceId])
            return (jsonData(["deleted": true]), makeResponse(url: request.url!, status: 200))
        }
        let deleted = try await DeviceClient(baseURL: base, http: stub).forget(
            deviceId: deviceId, accessToken: "at-1"
        )
        XCTAssertTrue(deleted)
    }

    func testRefusalCarriesTheHostedReasonAndSignalsUnauthorized() async {
        let stub = StubHTTPClient { request in
            (jsonData(["error": "invalid-token"]), makeResponse(url: request.url!, status: 401))
        }
        do {
            _ = try await DeviceClient(baseURL: base, http: stub).forget(
                deviceId: deviceId, accessToken: "expired"
            )
            XCTFail("Expected throw")
        } catch let error as DeviceClientError {
            XCTAssertEqual(error, .serverError(status: 401, apiError: .invalidToken))
            XCTAssertTrue(error.isUnauthorized)
        } catch {
            XCTFail("Unexpected: \(error)")
        }
        XCTAssertFalse(DeviceClientError.serverError(status: 400, apiError: .invalidRequest).isUnauthorized)
    }
}
