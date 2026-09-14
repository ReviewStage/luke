import Foundation
import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

@testable import LukeKit

private func preferencesResponse(url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

private func preferencesJSONData(_ dict: [String: Any]) -> Data {
    try! JSONSerialization.data(withJSONObject: dict)
}

final class AccountPreferencesClientTests: XCTestCase {
    private let base = URL(string: "https://tryluke.dev")!

    @MainActor
    func testAccountPreferencesWireOmitsDefaultValuesAndIncludesWorkspaceDefaults() async {
        let snapshot = DeviceSettingsSnapshot(
            voice: .coral,
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
        XCTAssertEqual(wire["voice"] as? String, "coral")
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

    @MainActor
    func testAccountPreferencesWireParsesHostedSnapshot() async {
        let snapshot = DeviceSettingsSnapshot(accountPreferencesWire: [
            "voice": "beacon",
            "defaultWorkspaceProvider": "conductor",
            "workspaceProjectDefaults": ["conductor": "project-1"],
            "workspaceAgentDefaults": [
                "conductor": ["agent": "codex", "model": "gpt-5.6-sol"],
                "superset": ["agent": "composer"],
            ],
        ])

        XCTAssertEqual(snapshot?.voice, .beacon, "every Live voice is the phone's to speak")
        XCTAssertEqual(snapshot?.workspaceProviderId, "conductor")
        XCTAssertEqual(snapshot?.workspaceProjectIds, ["conductor": "project-1"])
        XCTAssertEqual(snapshot?.workspaceAgentDefaults, [
            "conductor": WorkspaceAgentDefault(agent: "codex", model: "gpt-5.6-sol"),
            "superset": WorkspaceAgentDefault(agent: "composer"),
        ])
    }

    @MainActor
    func testAccountPreferencesWireRejectsUnknownAndInvalidHostedValues() async {
        XCTAssertNil(DeviceSettingsSnapshot(accountPreferencesWire: ["futureSetting": "ignored"]))
        XCTAssertNil(DeviceSettingsSnapshot(accountPreferencesWire: ["voice": "baritone"]))
        XCTAssertNil(
            DeviceSettingsSnapshot(accountPreferencesWire: [
                "workspaceProjectDefaults": ["unknown": "project-1"],
            ])
        )
        XCTAssertNil(
            DeviceSettingsSnapshot(accountPreferencesWire: [
                "workspaceAgentDefaults": ["superset": ["agent": "composer", "model": "gpt"]],
            ])
        )
    }

    @MainActor
    func testReadAccountPreferencesParsesSnapshotAndStoredMarker() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/api/account/preferences")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer at-1")
            XCTAssertNil(request.httpBody)
            return (
                preferencesJSONData([
                    "preferences": ["voice": "coral"],
                    "updatedAt": 1_800_000_000_000,
                ]),
                preferencesResponse(url: request.url!, status: 200)
            )
        }
        let client = AccountPreferencesClient(baseURL: base, http: stub)
        let answer = try await client.readPreferences(accessToken: "at-1")

        XCTAssertEqual(answer.preferences.voice, .coral)
        XCTAssertTrue(answer.hasStoredSnapshot)
    }

    @MainActor
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
            XCTAssertEqual(preferences?["voice"] as? String, "willow")
            return (
                preferencesJSONData([
                    "preferences": ["voice": "willow"],
                    "updatedAt": 1_800_000_000_000,
                ]),
                preferencesResponse(url: request.url!, status: 200)
            )
        }
        let client = AccountPreferencesClient(baseURL: base, http: stub)
        let answer = try await client.writePreferences(
            DeviceSettingsSnapshot(voice: .willow),
            accessToken: "at-1"
        )

        XCTAssertEqual(answer.preferences.voice, .willow)
    }

    @MainActor
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
        XCTAssertFalse(answer.hasStoredSnapshot)
    }

    @MainActor
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
