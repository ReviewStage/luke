import Foundation
import XCTest

@testable import LukeKit

private func makeResponse(url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

private func jsonData(_ dict: [String: Any]) -> Data {
    try! JSONSerialization.data(withJSONObject: dict)
}

// MARK: - Key shape validation

final class VaultKeyShapeTests: XCTestCase {
    func testAcceptsBoundedSingleToken() {
        XCTAssertTrue(VaultClient.isValidKey("sk-abc123"))
        XCTAssertTrue(VaultClient.isValidKey(String(repeating: "a", count: 512)))
    }

    func testRefusesEmptyOversizedAndWhitespace() {
        XCTAssertFalse(VaultClient.isValidKey(""))
        XCTAssertFalse(VaultClient.isValidKey(String(repeating: "a", count: 513)))
        XCTAssertFalse(VaultClient.isValidKey("sk abc"))
        XCTAssertFalse(VaultClient.isValidKey("sk-abc\n"))
        XCTAssertFalse(VaultClient.isValidKey("\tsk-abc"))
    }
}

// MARK: - Store

final class VaultStoreKeyTests: XCTestCase {
    private let base = URL(string: "https://tryluke.dev")!

    func testStoreSendsWireShape() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/api/vault/key")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer at-1")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            let body = try! JSONSerialization.jsonObject(
                with: request.httpBody ?? Data()
            ) as! [String: String]
            XCTAssertEqual(body, ["providerId": "cursor", "key": "sk-123"])
            return (jsonData(["stored": true]), makeResponse(url: request.url!, status: 200))
        }
        let client = VaultClient(baseURL: base, http: stub)
        try await client.storeKey("sk-123", for: .cursor, accessToken: "at-1")
    }

    func testStoreRefusesMalformedKeyBeforeItTravels() async {
        let stub = StubHTTPClient { request in
            XCTFail("A malformed key must never travel")
            return (Data(), makeResponse(url: request.url!, status: 500))
        }
        let client = VaultClient(baseURL: base, http: stub)
        do {
            try await client.storeKey("has a space", for: .cursor, accessToken: "at-1")
            XCTFail("Expected throw")
        } catch VaultClientError.invalidKey {
            // expected
        } catch {
            XCTFail("Unexpected: \(error)")
        }
    }

    func testStoreRejectsAnswerWithoutStored() async {
        let stub = StubHTTPClient { request in
            (jsonData(["ok": true]), makeResponse(url: request.url!, status: 200))
        }
        let client = VaultClient(baseURL: base, http: stub)
        do {
            try await client.storeKey("sk-123", for: .jules, accessToken: "at-1")
            XCTFail("Expected throw")
        } catch VaultClientError.invalidResponse {
            // expected
        } catch {
            XCTFail("Unexpected: \(error)")
        }
    }
}

// MARK: - List

final class VaultListKeysTests: XCTestCase {
    private let base = URL(string: "https://tryluke.dev")!

    func testListParsesEntries() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/api/vault/keys")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer at-1")
            XCTAssertNil(request.httpBody)
            let payload: [String: Any] = [
                "keys": [
                    ["providerId": "devin", "hint": "ab12", "updatedAt": 1_700_000_000_000],
                    ["providerId": "jules", "hint": "cd34", "updatedAt": 0],
                ],
            ]
            return (jsonData(payload), makeResponse(url: request.url!, status: 200))
        }
        let client = VaultClient(baseURL: base, http: stub)
        let entries = try await client.listKeys(accessToken: "at-1")
        XCTAssertEqual(entries.count, 2)
        XCTAssertEqual(entries[0].provider, .devin)
        XCTAssertEqual(entries[0].hint, "ab12")
        XCTAssertEqual(entries[0].updatedAt, Date(timeIntervalSince1970: 1_700_000_000))
        XCTAssertEqual(entries[1].provider, .jules)
    }

    func testUnknownProviderDropsWholeAnswer() async {
        let stub = StubHTTPClient { request in
            let payload: [String: Any] = [
                "keys": [
                    ["providerId": "cursor", "hint": "ab12", "updatedAt": 1000],
                    ["providerId": "not-a-provider", "hint": "cd34", "updatedAt": 1000],
                ],
            ]
            return (jsonData(payload), makeResponse(url: request.url!, status: 200))
        }
        let client = VaultClient(baseURL: base, http: stub)
        do {
            _ = try await client.listKeys(accessToken: "at-1")
            XCTFail("Expected throw")
        } catch VaultClientError.invalidResponse {
            // expected
        } catch {
            XCTFail("Unexpected: \(error)")
        }
    }

    func testMissingHintDropsWholeAnswer() async {
        let stub = StubHTTPClient { request in
            let payload: [String: Any] = [
                "keys": [["providerId": "cursor", "updatedAt": 1000]],
            ]
            return (jsonData(payload), makeResponse(url: request.url!, status: 200))
        }
        let client = VaultClient(baseURL: base, http: stub)
        do {
            _ = try await client.listKeys(accessToken: "at-1")
            XCTFail("Expected throw")
        } catch VaultClientError.invalidResponse {
            // expected
        } catch {
            XCTFail("Unexpected: \(error)")
        }
    }
}

// MARK: - Delete and refusals

final class VaultDeleteKeyTests: XCTestCase {
    private let base = URL(string: "https://tryluke.dev")!

    func testDeleteSendsProviderAndParsesAnswer() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "DELETE")
            XCTAssertEqual(request.url?.path, "/api/vault/key")
            let body = try! JSONSerialization.jsonObject(
                with: request.httpBody ?? Data()
            ) as! [String: String]
            XCTAssertEqual(body, ["providerId": "replicas"])
            return (jsonData(["deleted": true]), makeResponse(url: request.url!, status: 200))
        }
        let client = VaultClient(baseURL: base, http: stub)
        let deleted = try await client.deleteKey(for: .replicas, accessToken: "at-1")
        XCTAssertTrue(deleted)
    }

    func testRefusalCarriesHostedReason() async {
        let stub = StubHTTPClient { request in
            (jsonData(["error": "invalid-token"]), makeResponse(url: request.url!, status: 401))
        }
        let client = VaultClient(baseURL: base, http: stub)
        do {
            _ = try await client.deleteKey(for: .conductor, accessToken: "expired")
            XCTFail("Expected throw")
        } catch VaultClientError.serverError(let status, let apiError) {
            XCTAssertEqual(status, 401)
            XCTAssertEqual(apiError, .invalidToken)
        } catch {
            XCTFail("Unexpected: \(error)")
        }
    }
}
