import Foundation
import XCTest

@testable import LukeKit

private func preferencesResponse(url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

private func preferencesJSONData(_ dict: [String: Any]) -> Data {
    try! JSONSerialization.data(withJSONObject: dict)
}

@MainActor
final class AccountPreferencesClientTests: XCTestCase {
    private let base = URL(string: "https://tryluke.dev")!

    func testAccountPreferencesWireOmitsDefaultValuesAndIncludesWorkspaceDefaults() {
        let snapshot = DeviceSettingsSnapshot(
            voice: .marin,
            speed: .default,
            workspaceProviderId: "conductor",
            workspaceProjectIds: ["conductor": "project-1"],
            workspaceAgentDefaults: [
                "conductor": WorkspaceAgentDefault(
                    agent: "codex", model: "gpt-5.6-sol", effort: "high"
                ),
                "superset": WorkspaceAgentDefault(agent: "composer"),
            ]
        )

        let wire = snapshot.accountPreferencesWire
        XCTAssertEqual(wire["voice"] as? String, "marin")
        XCTAssertNil(wire["voiceSpeed"])
        XCTAssertEqual(wire["defaultWorkspaceProvider"] as? String, "conductor")
        XCTAssertEqual(wire["workspaceProjectDefaults"] as? [String: String], [
            "conductor": "project-1",
        ])
        XCTAssertEqual(
            (wire["workspaceAgentDefaults"] as? [String: [String: String]])?["conductor"],
            ["agent": "codex", "model": "gpt-5.6-sol", "effort": "high"]
        )
        XCTAssertEqual(
            (wire["workspaceAgentDefaults"] as? [String: [String: String]])?["superset"],
            ["agent": "composer"]
        )
    }

    func testAccountPreferencesWireParsesUnknownAndInvalidValuesAsDefaults() {
        let snapshot = DeviceSettingsSnapshot(accountPreferencesWire: [
            "voice": "baritone",
            "voiceSpeed": 1.5,
            "futureSetting": "ignored",
            "workspaceAgentDefaults": [
                "conductor": ["agent": "codex", "model": "gpt-5.6-sol"],
                "superset": ["agent": "composer"],
                "broken": ["model": "gpt-5.6-sol"],
            ],
        ])

        XCTAssertEqual(snapshot.voice, .default)
        XCTAssertEqual(snapshot.speed, .fast)
        XCTAssertEqual(snapshot.workspaceAgentDefaults, [
            "conductor": WorkspaceAgentDefault(agent: "codex", model: "gpt-5.6-sol"),
            "superset": WorkspaceAgentDefault(agent: "composer"),
        ])
    }

    func testReadAccountPreferencesParsesSnapshotAndTimestamp() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/api/account/preferences")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer at-1")
            XCTAssertNil(request.httpBody)
            return (
                preferencesJSONData([
                    "preferences": [
                        "voice": "coral",
                        "voiceSpeed": 1.25,
                    ],
                    "updatedAt": 1_800_000_000_000,
                ]),
                preferencesResponse(url: request.url!, status: 200)
            )
        }
        let client = AccountPreferencesClient(baseURL: base, http: stub)
        let answer = try await client.readPreferences(accessToken: "at-1")

        XCTAssertEqual(answer.preferences.voice, .coral)
        XCTAssertEqual(answer.preferences.speed, .quick)
        XCTAssertEqual(answer.updatedAt, Date(timeIntervalSince1970: 1_800_000_000))
    }

    func testWriteAccountPreferencesSendsSnapshot() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(request.url?.path, "/api/account/preferences")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer at-1")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            let body = try! JSONSerialization.jsonObject(
                with: request.httpBody ?? Data()
            ) as! [String: Any]
            let preferences = body["preferences"] as? [String: Any]
            XCTAssertEqual(preferences?["voiceSpeed"] as? Double, 0.75)
            XCTAssertNil(preferences?["voice"])
            return (
                preferencesJSONData([
                    "preferences": ["voiceSpeed": 0.75],
                    "updatedAt": 1_800_000_000_000,
                ]),
                preferencesResponse(url: request.url!, status: 200)
            )
        }
        let client = AccountPreferencesClient(baseURL: base, http: stub)
        let answer = try await client.writePreferences(
            DeviceSettingsSnapshot(speed: .slow),
            accessToken: "at-1"
        )

        XCTAssertEqual(answer.preferences.speed, .slow)
    }

    func testReadWithoutStoredRowParsesAsDefaults() async throws {
        let stub = StubHTTPClient { request in
            (
                preferencesJSONData(["preferences": [:]]),
                preferencesResponse(url: request.url!, status: 200)
            )
        }
        let client = AccountPreferencesClient(baseURL: base, http: stub)
        let answer = try await client.readPreferences(accessToken: "at-1")

        XCTAssertEqual(answer.preferences, DeviceSettingsSnapshot())
        XCTAssertNil(answer.updatedAt)
    }

    func testRefusalCarriesHostedReason() async {
        let stub = StubHTTPClient { request in
            (
                preferencesJSONData(["error": "invalid-token"]),
                preferencesResponse(url: request.url!, status: 401)
            )
        }
        let client = AccountPreferencesClient(baseURL: base, http: stub)
        do {
            _ = try await client.readPreferences(accessToken: "expired")
            XCTFail("Expected throw")
        } catch AccountPreferencesClientError.serverError(let status, let apiError) {
            XCTAssertEqual(status, 401)
            XCTAssertEqual(apiError, .invalidToken)
        } catch {
            XCTFail("Unexpected: \(error)")
        }
    }
}
