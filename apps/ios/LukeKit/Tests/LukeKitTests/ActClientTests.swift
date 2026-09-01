import Foundation
import XCTest

@testable import LukeKit

// MARK: - Wire shape tests

final class ActMessageAnswerWireTests: XCTestCase {
    func testAcceptedDecodesWithoutReason() throws {
        let data = Data(#"{"result":"accepted"}"#.utf8)
        let answer = try JSONDecoder().decode(ActMessageAnswer.self, from: data)
        XCTAssertEqual(answer.result, .accepted)
        XCTAssertNil(answer.reason)
    }

    func testRejectedDecodesWithReason() throws {
        let data = Data(#"{"result":"rejected","reason":"Session is not accepting messages."}"#.utf8)
        let answer = try JSONDecoder().decode(ActMessageAnswer.self, from: data)
        XCTAssertEqual(answer.result, .rejected)
        XCTAssertEqual(answer.reason, "Session is not accepting messages.")
    }

    func testUnsupportedDecodesCorrectly() throws {
        let data = Data(#"{"result":"unsupported","reason":"Mobile message acts are not yet available for this provider."}"#.utf8)
        let answer = try JSONDecoder().decode(ActMessageAnswer.self, from: data)
        XCTAssertEqual(answer.result, .unsupported)
        XCTAssertNotNil(answer.reason)
    }
}

final class ActWorkspaceAnswerWireTests: XCTestCase {
    func testAcceptedWithSessionId() throws {
        let data = Data(#"{"result":"accepted","providerSessionId":"sess-abc123"}"#.utf8)
        let answer = try JSONDecoder().decode(ActWorkspaceAnswer.self, from: data)
        XCTAssertEqual(answer.result, .accepted)
        XCTAssertNil(answer.reason)
        XCTAssertEqual(answer.providerSessionId, "sess-abc123")
    }

    func testRejectedSurfacesReason() throws {
        let data = Data(#"{"result":"rejected","reason":"Project not found."}"#.utf8)
        let answer = try JSONDecoder().decode(ActWorkspaceAnswer.self, from: data)
        XCTAssertEqual(answer.result, .rejected)
        XCTAssertEqual(answer.reason, "Project not found.")
        XCTAssertNil(answer.providerSessionId)
    }

    func testUnsupportedDecodesWithoutSessionId() throws {
        let data = Data(#"{"result":"unsupported","reason":"Workspace acts are not yet available for this provider."}"#.utf8)
        let answer = try JSONDecoder().decode(ActWorkspaceAnswer.self, from: data)
        XCTAssertEqual(answer.result, .unsupported)
        XCTAssertNil(answer.providerSessionId)
    }

    func testAcceptedWithPartialSuccessReason() throws {
        let data = Data(#"{"result":"accepted","reason":"Workspace created; opening task delivery failed.","providerSessionId":"sess-xyz"}"#.utf8)
        let answer = try JSONDecoder().decode(ActWorkspaceAnswer.self, from: data)
        XCTAssertEqual(answer.result, .accepted)
        XCTAssertNotNil(answer.reason)
        XCTAssertEqual(answer.providerSessionId, "sess-xyz")
    }
}

// MARK: - ActClient HTTP behaviour tests

private func makeResponse(url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

private func jsonData(_ dict: [String: Any]) -> Data {
    try! JSONSerialization.data(withJSONObject: dict)
}

final class ActClientSendMessageTests: XCTestCase {
    private let base = URL(string: "https://example.com")!

    func testSendsAuthorizationHeader() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
            return (jsonData(["result": "accepted"]), makeResponse(url: request.url!, status: 200))
        }
        let client = ActClient(baseURL: base, http: stub)
        let answer = try await client.sendMessage(
            accessToken: "test-token",
            providerId: "conductor",
            providerSessionId: "sess-1",
            text: "hello"
        )
        XCTAssertEqual(answer.result, .accepted)
    }

    func testHitsCorrectPath() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertTrue(request.url?.path.hasSuffix("api/acts/message") == true)
            return (jsonData(["result": "accepted"]), makeResponse(url: request.url!, status: 200))
        }
        let client = ActClient(baseURL: base, http: stub)
        _ = try await client.sendMessage(
            accessToken: "tok",
            providerId: "conductor",
            providerSessionId: "sess-1",
            text: "hi"
        )
    }

    func testUnauthorizedThrows() async {
        let stub = StubHTTPClient { request in
            (Data(), makeResponse(url: request.url!, status: 401))
        }
        let client = ActClient(baseURL: base, http: stub)
        do {
            _ = try await client.sendMessage(
                accessToken: "expired",
                providerId: "conductor",
                providerSessionId: "sess-1",
                text: "hi"
            )
            XCTFail("Expected ActClientError.unauthorized")
        } catch ActClientError.unauthorized {
            // expected
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testServerErrorPropagates() async {
        let stub = StubHTTPClient { request in
            (jsonData(["error": "internal"]), makeResponse(url: request.url!, status: 500))
        }
        let client = ActClient(baseURL: base, http: stub)
        do {
            _ = try await client.sendMessage(
                accessToken: "tok",
                providerId: "conductor",
                providerSessionId: "sess-1",
                text: "hi"
            )
            XCTFail("Expected ActClientError.serverError")
        } catch ActClientError.serverError(let status) {
            XCTAssertEqual(status, 500)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testNetworkErrorPropagates() async {
        struct NetworkError: Error {}
        let stub = StubHTTPClient { _ in throw NetworkError() }
        let client = ActClient(baseURL: base, http: stub)
        do {
            _ = try await client.sendMessage(
                accessToken: "tok",
                providerId: "conductor",
                providerSessionId: "sess-1",
                text: "hi"
            )
            XCTFail("Expected throw")
        } catch is NetworkError {
            // expected
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testRejectedAnswerSurfacesReason() async throws {
        let stub = StubHTTPClient { request in
            (jsonData(["result": "rejected", "reason": "Session is working."]),
             makeResponse(url: request.url!, status: 200))
        }
        let client = ActClient(baseURL: base, http: stub)
        let answer = try await client.sendMessage(
            accessToken: "tok",
            providerId: "conductor",
            providerSessionId: "sess-1",
            text: "hi"
        )
        XCTAssertEqual(answer.result, .rejected)
        XCTAssertEqual(answer.reason, "Session is working.")
    }
}

final class ActClientCreateWorkspaceTests: XCTestCase {
    private let base = URL(string: "https://example.com")!

    func testHitsCorrectPath() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertTrue(request.url?.path.hasSuffix("api/acts/workspace") == true)
            return (jsonData(["result": "accepted", "providerSessionId": "sess-new"]),
                    makeResponse(url: request.url!, status: 200))
        }
        let client = ActClient(baseURL: base, http: stub)
        _ = try await client.createWorkspace(
            accessToken: "tok",
            providerId: "conductor",
            providerProjectId: "proj-1"
        )
    }

    func testUnauthorizedThrows() async {
        let stub = StubHTTPClient { _ in
            (Data(), makeResponse(url: URL(string: "https://example.com")!, status: 401))
        }
        let client = ActClient(baseURL: base, http: stub)
        do {
            _ = try await client.createWorkspace(
                accessToken: "expired",
                providerId: "conductor",
                providerProjectId: "proj-1"
            )
            XCTFail("Expected ActClientError.unauthorized")
        } catch ActClientError.unauthorized {
            // expected
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testAcceptedWithSessionIdDecodes() async throws {
        let stub = StubHTTPClient { _ in
            (jsonData(["result": "accepted", "providerSessionId": "sess-new"]),
             makeResponse(url: URL(string: "https://example.com")!, status: 200))
        }
        let client = ActClient(baseURL: base, http: stub)
        let answer = try await client.createWorkspace(
            accessToken: "tok",
            providerId: "conductor",
            providerProjectId: "proj-1",
            name: "My workspace",
            task: "Implement the feature"
        )
        XCTAssertEqual(answer.result, .accepted)
        XCTAssertEqual(answer.providerSessionId, "sess-new")
    }

    func testUnsupportedSurfacesReason() async throws {
        let stub = StubHTTPClient { _ in
            (jsonData(["result": "unsupported", "reason": "Workspace acts are not yet available for this provider."]),
             makeResponse(url: URL(string: "https://example.com")!, status: 200))
        }
        let client = ActClient(baseURL: base, http: stub)
        let answer = try await client.createWorkspace(
            accessToken: "tok",
            providerId: "other",
            providerProjectId: "proj-1"
        )
        XCTAssertEqual(answer.result, .unsupported)
        XCTAssertNotNil(answer.reason)
        XCTAssertNil(answer.providerSessionId)
    }
}

// MARK: - Row acts

final class ActClientRowActTests: XCTestCase {
    private let base = URL(string: "https://example.com")!

    private func bodyJSON(_ request: URLRequest) -> [String: Any] {
        guard
            let body = request.httpBody,
            let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
        else { return [:] }
        return json
    }

    func testExecuteControlHitsPathWithControlId() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertTrue(request.url?.path.hasSuffix("api/acts/control") == true)
            let body = self.bodyJSON(request)
            XCTAssertEqual(body["providerId"] as? String, "jules")
            XCTAssertEqual(body["providerSessionId"] as? String, "sess-1")
            XCTAssertEqual(body["controlId"] as? String, "approve-plan")
            return (jsonData(["result": "accepted"]), makeResponse(url: request.url!, status: 200))
        }
        let client = ActClient(baseURL: base, http: stub)
        let answer = try await client.executeControl(
            accessToken: "tok",
            providerId: "jules",
            providerSessionId: "sess-1",
            controlId: "approve-plan"
        )
        XCTAssertEqual(answer.result, .accepted)
    }

    func testSpawnAgentOmitsEmptyNameAndTask() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertTrue(request.url?.path.hasSuffix("api/acts/agent") == true)
            let body = self.bodyJSON(request)
            XCTAssertEqual(body["agent"] as? String, "claude")
            XCTAssertNil(body["name"])
            XCTAssertNil(body["task"])
            return (
                jsonData(["result": "accepted", "providerSessionId": "chat-2"]),
                makeResponse(url: request.url!, status: 200)
            )
        }
        let client = ActClient(baseURL: base, http: stub)
        let answer = try await client.spawnAgent(
            accessToken: "tok",
            providerId: "replicas",
            providerSessionId: "chat-1",
            agent: "claude",
            name: "   ",
            task: ""
        )
        XCTAssertEqual(answer.result, .accepted)
        XCTAssertEqual(answer.providerSessionId, "chat-2")
    }

    func testSpawnAgentCarriesTrimmedNameAndTask() async throws {
        let stub = StubHTTPClient { request in
            let body = self.bodyJSON(request)
            XCTAssertEqual(body["name"] as? String, "Second opinion")
            XCTAssertEqual(body["task"] as? String, "Review the diff")
            return (jsonData(["result": "accepted"]), makeResponse(url: request.url!, status: 200))
        }
        let client = ActClient(baseURL: base, http: stub)
        _ = try await client.spawnAgent(
            accessToken: "tok",
            providerId: "conductor",
            providerSessionId: "sess-1",
            agent: "claude",
            name: " Second opinion ",
            task: " Review the diff "
        )
    }

    func testRenameSessionHitsPathWithTrimmedName() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertTrue(request.url?.path.hasSuffix("api/acts/rename-session") == true)
            let body = self.bodyJSON(request)
            XCTAssertEqual(body["name"] as? String, "Better title")
            return (jsonData(["result": "accepted"]), makeResponse(url: request.url!, status: 200))
        }
        let client = ActClient(baseURL: base, http: stub)
        _ = try await client.renameSession(
            accessToken: "tok",
            providerId: "conductor",
            providerSessionId: "sess-1",
            name: " Better title "
        )
    }

    func testRenameWorkspaceHitsPath() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertTrue(request.url?.path.hasSuffix("api/acts/rename-workspace") == true)
            return (jsonData(["result": "accepted"]), makeResponse(url: request.url!, status: 200))
        }
        let client = ActClient(baseURL: base, http: stub)
        _ = try await client.renameWorkspace(
            accessToken: "tok",
            providerId: "conductor",
            providerSessionId: "sess-1",
            name: "Renamed"
        )
    }

    func testControlUnauthorizedThrows() async {
        let stub = StubHTTPClient { request in
            (Data(), makeResponse(url: request.url!, status: 401))
        }
        let client = ActClient(baseURL: base, http: stub)
        do {
            _ = try await client.executeControl(
                accessToken: "tok",
                providerId: "cursor",
                providerSessionId: "agent-1",
                controlId: "cancel-run"
            )
            XCTFail("expected a thrown error")
        } catch let error as ActClientError {
            XCTAssertEqual(error, .unauthorized)
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }
}

// MARK: - Agent selection on creation

final class ActClientCreateWorkspaceSelectionTests: XCTestCase {
    private let base = URL(string: "https://example.com")!

    func testCarriesAgentModelAndEffort() async throws {
        let stub = StubHTTPClient { request in
            let body =
                (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data()))
                as? [String: Any] ?? [:]
            XCTAssertEqual(body["agent"] as? String, "claude")
            XCTAssertEqual(body["model"] as? String, "fable-5")
            XCTAssertEqual(body["effort"] as? String, "high")
            return (jsonData(["result": "accepted"]), makeResponse(url: request.url!, status: 200))
        }
        let client = ActClient(baseURL: base, http: stub)
        _ = try await client.createWorkspace(
            accessToken: "tok",
            providerId: "conductor",
            providerProjectId: "proj-1",
            task: "build it",
            agent: "claude",
            model: "fable-5",
            effort: "high"
        )
    }

    func testOmitsSelectionFieldsWhenNoneChosen() async throws {
        let stub = StubHTTPClient { request in
            let body =
                (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data()))
                as? [String: Any] ?? [:]
            XCTAssertNil(body["agent"])
            XCTAssertNil(body["model"])
            XCTAssertNil(body["effort"])
            return (jsonData(["result": "accepted"]), makeResponse(url: request.url!, status: 200))
        }
        let client = ActClient(baseURL: base, http: stub)
        _ = try await client.createWorkspace(
            accessToken: "tok",
            providerId: "replicas",
            providerProjectId: "env-1",
            task: "build it"
        )
    }
}
