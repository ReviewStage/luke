import Foundation
import XCTest

@testable import LukeKit

// MARK: - Helpers (StubHTTPClient from AccountClientTests is @testable so no re-declare)

private let serviceURL = URL(string: "https://tryluke.dev")!

private func makeProjectsResponse(projects: [[String: Any]], status: Int = 200) -> (Data, URLResponse) {
    let body = try! JSONSerialization.data(withJSONObject: ["projects": projects])
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
            "providerId": "replicas",
            "providerProjectId": "env-1",
            "repository": "owner/repo",
            "taskSupport": "required",
            "targetName": "Staging",
        ])
        XCTAssertEqual(project?.id, "replicas:env-1")
        XCTAssertEqual(project?.taskSupport, .required)
        XCTAssertEqual(project?.targetName, "Staging")
    }
}

// MARK: - ProjectsClient

final class ProjectsClientTests: XCTestCase {
    func testFetchesProjectsWithBearer() async throws {
        let stub = StubHTTPClient { request in
            XCTAssertEqual(request.url?.path, "/api/projects")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-1")
            return makeProjectsResponse(projects: [
                [
                    "providerId": "conductor",
                    "providerProjectId": "proj-1",
                    "repository": "owner/repo",
                    "taskSupport": "optional",
                ],
                ["providerId": "conductor"],  // malformed: skipped
            ])
        }
        let client = ProjectsClient(serviceURL: serviceURL, http: stub)
        let projects = try await client.projects(bearerToken: "token-1")
        XCTAssertEqual(projects.count, 1)
        XCTAssertEqual(projects.first?.providerProjectId, "proj-1")
        XCTAssertEqual(projects.first?.taskSupport, .optional)
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

    func testMissingProjectsKeyIsEmpty() async throws {
        let stub = StubHTTPClient { request in
            (
                try! JSONSerialization.data(withJSONObject: [String: Any]()),
                HTTPURLResponse(
                    url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            )
        }
        let client = ProjectsClient(serviceURL: serviceURL, http: stub)
        let projects = try await client.projects(bearerToken: "token-1")
        XCTAssertEqual(projects, [])
    }
}
