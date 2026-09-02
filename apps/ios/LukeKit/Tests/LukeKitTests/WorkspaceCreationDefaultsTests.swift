import Foundation
import XCTest

@testable import LukeKit

final class WorkspaceCreationDefaultsTests: XCTestCase {
    private var store: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "workspace-creation-defaults-tests-\(UUID().uuidString)"
        store = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        store.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    func testProviderRoundTripsAndClears() {
        let defaults = WorkspaceCreationDefaults(store: store)
        XCTAssertNil(defaults.lastProviderId)
        defaults.lastProviderId = "conductor"
        XCTAssertEqual(defaults.lastProviderId, "conductor")
        defaults.lastProviderId = nil
        XCTAssertNil(defaults.lastProviderId)
    }

    func testProjectIsRememberedPerProvider() {
        let defaults = WorkspaceCreationDefaults(store: store)
        defaults.setLastProjectId("proj-1", for: "conductor")
        defaults.setLastProjectId("https://github.com/o/r", for: "codex")
        XCTAssertEqual(defaults.lastProjectId(for: "conductor"), "proj-1")
        XCTAssertEqual(defaults.lastProjectId(for: "codex"), "https://github.com/o/r")
        XCTAssertNil(defaults.lastProjectId(for: "conductor"))
    }

    func testAgentSelectionRoundTripsWithAndWithoutEffort() {
        let defaults = WorkspaceCreationDefaults(store: store)
        defaults.setAgentDefault(
            WorkspaceAgentDefault(agent: "claude", model: "fable-5", effort: "high"),
            for: "conductor"
        )
        XCTAssertEqual(
            defaults.agentDefault(for: "conductor"),
            WorkspaceAgentDefault(agent: "claude", model: "fable-5", effort: "high")
        )

        defaults.setAgentDefault(
            WorkspaceAgentDefault(agent: "cursor", model: "auto"), for: "conductor")
        XCTAssertEqual(
            defaults.agentDefault(for: "conductor"),
            WorkspaceAgentDefault(agent: "cursor", model: "auto", effort: nil)
        )
    }

    func testChoosingTheProviderDefaultForgetsTheStoredChoice() {
        let defaults = WorkspaceCreationDefaults(store: store)
        defaults.setAgentDefault(
            WorkspaceAgentDefault(agent: "claude", model: "fable-5"), for: "conductor")
        defaults.setAgentDefault(nil, for: "conductor")
        XCTAssertNil(defaults.agentDefault(for: "conductor"))
    }
}
