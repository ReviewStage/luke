import Foundation
import XCTest

@testable import LukeKit

private func syncResponse(url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

private func syncJSONData(_ dict: [String: Any]) -> Data {
    try! JSONSerialization.data(withJSONObject: dict)
}

@MainActor
private final class AccountPreferencesTokenSource: AccountTokenProviding {
    var accountEmail: String? = "user@example.com"
    var token: String? = "at-1"
    var refreshedToken: String? = "at-2"
    var refreshes = 0

    func validAccessToken() async throws -> String {
        guard let token else { throw AccountSessionError.signedOut }
        return token
    }

    func refreshAccessToken() async throws -> String {
        refreshes += 1
        guard let refreshedToken else { throw AccountSessionError.signedOut }
        token = refreshedToken
        return refreshedToken
    }
}

@MainActor
final class AccountPreferencesSyncTests: XCTestCase {
    private var suites: [String] = []
    private let base = URL(string: "https://tryluke.dev")!

    override func tearDown() {
        for suite in suites { UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite) }
        super.tearDown()
    }

    private func makeStore() -> UserDefaults {
        let suite = "account-preferences-sync-tests-\(UUID().uuidString)"
        suites.append(suite)
        return UserDefaults(suiteName: suite)!
    }

    func testReconcileRestoresAccountPreferencesIntoUserDefaults() async {
        let store = makeStore()
        let tokenSource = AccountPreferencesTokenSource()
        let stub = StubHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            return (
                syncJSONData([
                    "preferences": [
                        "voice": "marin",
                        "voiceSpeed": 1.5,
                        "defaultWorkspaceProvider": "conductor",
                        "workspaceProjectDefaults": ["conductor": "project-1"],
                        "workspaceAgentDefaults": [
                            "conductor": [
                                "agent": "codex",
                                "model": "gpt-5.6-sol",
                                "effort": "high",
                            ],
                        ],
                    ],
                    "updatedAt": 1_800_000_000_000,
                ]),
                syncResponse(url: request.url!, status: 200)
            )
        }
        let sync = AccountPreferencesSync(
            store: store,
            client: AccountPreferencesClient(baseURL: base, http: stub),
            session: tokenSource
        )

        await sync.reconcile().value

        XCTAssertEqual(DeviceSettingsSnapshot.read(from: store), DeviceSettingsSnapshot(
            voice: .marin,
            speed: .fast,
            workspaceProviderId: "conductor",
            workspaceProjectIds: ["conductor": "project-1"],
            workspaceAgentDefaults: [
                "conductor": WorkspaceAgentDefault(
                    agent: "codex", model: "gpt-5.6-sol", effort: "high"
                ),
            ]
        ))
    }

    func testReconcilePublishesLocalPreferencesWhenTheAccountHasNoRow() async {
        let store = makeStore()
        DeviceSettingsSnapshot(
            voice: .sage,
            speed: .default,
            workspaceProjectIds: ["conductor": "project-local"]
        ).write(to: store)
        let tokenSource = AccountPreferencesTokenSource()
        var methods: [String] = []
        var writtenPreferences: [String: Any]?
        let stub = StubHTTPClient { request in
            methods.append(request.httpMethod ?? "")
            if request.httpMethod == "GET" {
                return (syncJSONData(["preferences": [:]]), syncResponse(url: request.url!, status: 200))
            }
            let body = try! JSONSerialization.jsonObject(
                with: request.httpBody ?? Data()
            ) as! [String: Any]
            writtenPreferences = body["preferences"] as? [String: Any]
            return (
                syncJSONData([
                    "preferences": writtenPreferences ?? [:],
                    "updatedAt": 1_800_000_000_000,
                ]),
                syncResponse(url: request.url!, status: 200)
            )
        }
        let sync = AccountPreferencesSync(
            store: store,
            client: AccountPreferencesClient(baseURL: base, http: stub),
            session: tokenSource
        )

        await sync.reconcile().value

        XCTAssertEqual(methods, ["GET", "PUT"])
        XCTAssertEqual(writtenPreferences?["voice"] as? String, "sage")
        XCTAssertNil(writtenPreferences?["voiceSpeed"])
        XCTAssertEqual(writtenPreferences?["workspaceProjectDefaults"] as? [String: String], [
            "conductor": "project-local",
        ])
    }

    func testReconcileDoesNotCreateARowForUntouchedDefaults() async {
        let store = makeStore()
        let tokenSource = AccountPreferencesTokenSource()
        var methods: [String] = []
        let stub = StubHTTPClient { request in
            methods.append(request.httpMethod ?? "")
            return (syncJSONData(["preferences": [:]]), syncResponse(url: request.url!, status: 200))
        }
        let sync = AccountPreferencesSync(
            store: store,
            client: AccountPreferencesClient(baseURL: base, http: stub),
            session: tokenSource
        )

        await sync.reconcile().value

        XCTAssertEqual(methods, ["GET"])
    }

    func testPublishCurrentUploadsTheLocalSnapshot() async {
        let store = makeStore()
        DeviceSettingsSnapshot(speed: .quick).write(to: store)
        let tokenSource = AccountPreferencesTokenSource()
        var writtenPreferences: [String: Any]?
        let stub = StubHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "PUT")
            let body = try! JSONSerialization.jsonObject(
                with: request.httpBody ?? Data()
            ) as! [String: Any]
            writtenPreferences = body["preferences"] as? [String: Any]
            return (
                syncJSONData([
                    "preferences": writtenPreferences ?? [:],
                    "updatedAt": 1_800_000_000_000,
                ]),
                syncResponse(url: request.url!, status: 200)
            )
        }
        let sync = AccountPreferencesSync(
            store: store,
            client: AccountPreferencesClient(baseURL: base, http: stub),
            session: tokenSource
        )

        await sync.publishCurrent().value

        XCTAssertEqual(writtenPreferences?["voiceSpeed"] as? Double, 1.25)
        XCTAssertNil(writtenPreferences?["voice"])
    }

    func testReconcileLeavesNewerLocalPreferenceWhenItChangesDuringTheRead() async {
        let store = makeStore()
        DeviceSettingsSnapshot(voice: .sage).write(to: store)
        let tokenSource = AccountPreferencesTokenSource()
        let stub = StubHTTPClient { request in
            await MainActor.run {
                DeviceSettingsSnapshot(voice: .coral).write(to: store)
            }
            return (
                syncJSONData([
                    "preferences": ["voice": "marin"],
                    "updatedAt": 1_800_000_000_000,
                ]),
                syncResponse(url: request.url!, status: 200)
            )
        }
        let sync = AccountPreferencesSync(
            store: store,
            client: AccountPreferencesClient(baseURL: base, http: stub),
            session: tokenSource
        )

        await sync.reconcile().value

        XCTAssertEqual(DeviceSettingsSnapshot.read(from: store).voice, .coral)
    }

    func testA401RefreshesAndRetriesOnce() async {
        let store = makeStore()
        let tokenSource = AccountPreferencesTokenSource()
        var tokens: [String?] = []
        let stub = StubHTTPClient { request in
            tokens.append(request.value(forHTTPHeaderField: "Authorization"))
            if tokens.count == 1 {
                return (
                    syncJSONData(["error": "invalid-token"]),
                    syncResponse(url: request.url!, status: 401)
                )
            }
            return (
                syncJSONData(["preferences": ["voice": "ash"], "updatedAt": 1_800_000_000_000]),
                syncResponse(url: request.url!, status: 200)
            )
        }
        let sync = AccountPreferencesSync(
            store: store,
            client: AccountPreferencesClient(baseURL: base, http: stub),
            session: tokenSource
        )

        await sync.reconcile().value

        XCTAssertEqual(tokenSource.refreshes, 1)
        XCTAssertEqual(tokens, ["Bearer at-1", "Bearer at-2"])
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: store).voice, .ash)
    }
}
