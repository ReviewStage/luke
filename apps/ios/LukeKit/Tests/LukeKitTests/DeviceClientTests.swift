import Foundation
import XCTest

@testable import LukeKit

private let serviceURL = URL(string: "https://tryluke.dev")!
private let token = String(repeating: "0a", count: 32)

private func answer(_ body: [String: Any], status: Int = 200, for request: URLRequest) -> (Data, URLResponse) {
    let data = try! JSONSerialization.data(withJSONObject: body)
    let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    return (data, response)
}

final class DeviceTokenTests: XCTestCase {
    func testHexIsLowercaseAndZeroPadded() {
        XCTAssertEqual(DeviceToken.hex(from: Data([0x00, 0x0a, 0xff, 0x10])), "000aff10")
    }

    func testStorableMirrorsTheServerBounds() {
        XCTAssertTrue(DeviceToken.isStorable(token))
        XCTAssertFalse(DeviceToken.isStorable(String(repeating: "0a", count: 15)))
        XCTAssertFalse(DeviceToken.isStorable(String(repeating: "0a", count: 257)))
        XCTAssertFalse(DeviceToken.isStorable(String(repeating: "0A", count: 32)))
        XCTAssertFalse(DeviceToken.isStorable(String(repeating: "0a", count: 31) + "g1"))
    }
}

final class DeviceClientTests: XCTestCase {
    func testRegisterPostsTheContractBody() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/api/devices/token")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer at-1")
            let body = try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: String]
            XCTAssertEqual(body, ["token": token, "platform": "ios", "environment": "sandbox"])
            return answer(["stored": true], for: request)
        }
        let client = DeviceClient(baseURL: serviceURL, http: stub)
        try await client.register(token: token, environment: .sandbox, accessToken: "at-1")
    }

    func testRegisterRefusesAnUnstorableTokenBeforeItTravels() async {
        let stub = StubHTTPClient { _ in
            XCTFail("nothing should travel")
            throw URLError(.badURL)
        }
        let client = DeviceClient(baseURL: serviceURL, http: stub)
        do {
            try await client.register(token: "short", environment: .sandbox, accessToken: "at-1")
            XCTFail("expected a refusal")
        } catch let error as DeviceClientError {
            XCTAssertEqual(error, .invalidToken)
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testRegisterRejectsAnAnswerOffTheContract() async {
        let stub = StubHTTPClient { request in answer(["stored": false], for: request) }
        let client = DeviceClient(baseURL: serviceURL, http: stub)
        do {
            try await client.register(token: token, environment: .production, accessToken: "at-1")
            XCTFail("expected a refusal")
        } catch let error as DeviceClientError {
            XCTAssertEqual(error, .invalidResponse)
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testAServerRefusalCarriesItsReasonAndSignalsUnauthorized() async {
        let stub = StubHTTPClient { request in
            answer(["error": "invalid-token"], status: 401, for: request)
        }
        let client = DeviceClient(baseURL: serviceURL, http: stub)
        do {
            try await client.register(token: token, environment: .production, accessToken: "at-1")
            XCTFail("expected a refusal")
        } catch let error as DeviceClientError {
            XCTAssertEqual(error, .serverError(status: 401, apiError: .invalidToken))
            XCTAssertTrue(error.isUnauthorized)
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testUnregisterDeletesAndAnswersWhetherARowWent() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "DELETE")
            XCTAssertEqual(request.url?.path, "/api/devices/token")
            let body = try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: String]
            XCTAssertEqual(body, ["token": token])
            return answer(["deleted": false], for: request)
        }
        let client = DeviceClient(baseURL: serviceURL, http: stub)
        let deleted = try await client.unregister(token: token, accessToken: "at-1")
        XCTAssertFalse(deleted)
    }
}
