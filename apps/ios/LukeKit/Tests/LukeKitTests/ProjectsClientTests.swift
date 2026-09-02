import Foundation
import XCTest

@testable import LukeKit

// MARK: - Helpers (StubHTTPClient from AccountClientTests is @testable so no re-declare)

private let serviceURL = URL(string: "https://tryluke.dev")!

private func makeProjectsResponse(json: [String: Any], status: Int = 200) -> (Data, URLResponse) {
    let body = try! JSONSerialization.data(withJSONObject: json)
    let response = HTTPURLResponse(
        url: serviceURL.appendingPathComponent("api/projects"),
        statusCode: status,
        httpVersion: nil,
        headerFields: nil
    )!
    return (body, response)
}

// MARK: - RosterProject parsing

final class RosterProjectTests: XCTestCase {
    func testRequiredFieldsMissing() {
        XCTAssertNil(RosterProject(json: [:]))
        XCTAssertNil(
            RosterProject(json: [
                "providerId": "conductor",
                "providerProjectId": "proj-1",
                "repository": "owner/repo",
                // taskSupport missing
            ])
        )
    }

    func testUnknownTaskSupportIsRefused() {
        XCTAssertNil(
            RosterProject(json: [
                "providerId": "conductor",
                "providerProjectId": "proj-1",
                "repository": "owner/repo",
                "taskSupport": "sometimes",
            ])
        )
    }

    func testAllFields() {
        let project = RosterProject(json: [
            "providerId": "conductor",
            "providerProjectId": "env-1",
            "repository": "owner/repo",
            "taskSupport": "required",
            "targetName": "Staging",
        ])
        XCTAssertEqual(project?.id, "conductor:env-1")
        XCTAssertEqual(project?.taskSupport, .required)
        XCTAssertEqual(project?.targetName, "Staging")
        XCTAssertEqual(project?.namesItself, false)
    }

    func testNamesItselfCrossesOnlyAsABoolean() {
        let base: [String: Any] = [
            "providerId": "codex",
            "providerProjectId": "env-1",
            "repository": "owner/repo",
            "taskSupport": "required",
        ]
        XCTAssertEqual(RosterProject(json: base.merging(["namesItself": true]) { $1 })?.namesItself, true)
        XCTAssertEqual(RosterProject(json: base.merging(["namesItself": "yes"]) { $1 })?.namesItself, false)
        XCTAssertEqual(RosterProject(json: base)?.namesItself, false)
    }
}

// MARK: - WorkspaceAgentOption parsing

final class WorkspaceAgentOptionTests: XCTestCase {
    func testDecodesModelsAndEfforts() {
        let option = WorkspaceAgentOption(json: [
            "providerId": "conductor",
            "agent": "claude",
            "models": [
                ["id": "fable-5", "label": "Fable 5"],
                ["id": "", "label": "nameless"],  // malformed: skipped
            ],
            "efforts": ["low", "high"],
        ])
        XCTAssertEqual(option?.id, "conductor:claude")
        XCTAssertEqual(option?.models, [WorkspaceAgentModelChoice(id: "fable-5", label: "Fable 5")])
        XCTAssertEqual(option?.efforts, ["low", "high"])
    }

    func testNoUsableModelsIsNoOption() {
        XCTAssertNil(
            WorkspaceAgentOption(json: [
                "providerId": "conductor",
                "agent": "claude",
                "models": [],
                "efforts": [],
            ])
        )
    }
}

// MARK: - ProjectsClient

final class ProjectsClientTests: XCTestCase {
    func testFetchesProjectsAndAgentModelsWithBearer() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertEqual(request.url?.path, "/api/projects")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-1")
            return makeProjectsResponse(json: [
                "projects": [
                    [
                        "providerId": "conductor",
                        "providerProjectId": "proj-1",
                        "repository": "owner/repo",
                        "taskSupport": "optional",
                    ],
                    ["providerId": "conductor"],  // malformed: skipped
                ],
                "agentModels": [
                    [
                        "providerId": "conductor",
                        "agent": "claude",
                        "models": [["id": "fable-5", "label": "Fable 5"]],
                        "efforts": ["low"],
                    ],
                    ["providerId": "conductor"],  // malformed: skipped
                ],
            ])
        }
        let client = ProjectsClient(serviceURL: serviceURL, http: stub)
        let answer = try await client.projects(bearerToken: "token-1")
        XCTAssertEqual(answer.projects.count, 1)
        XCTAssertEqual(answer.projects.first?.providerProjectId, "proj-1")
        XCTAssertEqual(answer.projects.first?.taskSupport, .optional)
        XCTAssertEqual(answer.agentModels.count, 1)
        XCTAssertEqual(answer.agentModels.first?.agent, "claude")
    }

    func testServerErrorThrows() async {
        let stub = StubHTTPClient { request in
            (Data(), HTTPURLResponse(
                url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!)
        }
        let client = ProjectsClient(serviceURL: serviceURL, http: stub)
        do {
            _ = try await client.projects(bearerToken: "token-1")
            XCTFail("expected a thrown error")
        } catch let ProjectsClientError.serverError(status) {
            XCTAssertEqual(status, 401)
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testMissingKeysAreEmpty() async throws {
        let stub = StubHTTPClient { _ in
            makeProjectsResponse(json: [String: Any]())
        }
        let client = ProjectsClient(serviceURL: serviceURL, http: stub)
        let answer = try await client.projects(bearerToken: "token-1")
        XCTAssertEqual(answer.projects, [])
        XCTAssertEqual(answer.agentModels, [])
    }
}
