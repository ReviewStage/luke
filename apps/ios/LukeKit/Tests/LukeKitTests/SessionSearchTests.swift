import XCTest

@testable import LukeKit

private func makeSession(
    providerId: String = "conductor",
    title: String = "Ship the roster",
    status: String = "working",
    workspace: String? = nil,
    branch: String? = nil,
    recap: String? = nil,
    error: String? = nil
) -> RosterSession {
    var json: [String: Any] = [
        "providerId": providerId,
        "sessionId": "s1",
        "title": title,
        "status": status,
    ]
    if let workspace { json["workspace"] = workspace }
    if let branch { json["branch"] = branch }
    if let recap { json["recap"] = recap }
    if let error { json["error"] = error }
    return RosterSession(json: json)!
}

final class SessionSearchTokenTests: XCTestCase {
    func testLowercasesAndSplitsOnWhitespace() {
        XCTAssertEqual(SessionSearch.tokens(from: "  Fix\tLogin\nBug "), ["fix", "login", "bug"])
    }

    func testBlankQueryHasNoTokens() {
        XCTAssertEqual(SessionSearch.tokens(from: ""), [])
        XCTAssertEqual(SessionSearch.tokens(from: "   \n\t"), [])
    }
}

final class SessionSearchMatchTests: XCTestCase {
    func testNoTokensMatchesEverything() {
        XCTAssertTrue(SessionSearch.matches(makeSession(), tokens: []))
    }

    func testMatchIsCaseBlindSubstring() {
        let session = makeSession(title: "Ship the Roster")
        XCTAssertTrue(SessionSearch.matches(session, tokens: SessionSearch.tokens(from: "ROST")))
        XCTAssertFalse(SessionSearch.matches(session, tokens: SessionSearch.tokens(from: "rooster")))
    }

    func testEveryTokenMustLandSomewhere() {
        let session = makeSession(title: "Fix login", branch: "feature/auth")
        XCTAssertTrue(SessionSearch.matches(session, tokens: SessionSearch.tokens(from: "fix auth")))
        XCTAssertFalse(SessionSearch.matches(session, tokens: SessionSearch.tokens(from: "fix payments")))
    }

    func testMatchesEachField() {
        XCTAssertTrue(SessionSearch.matches(makeSession(title: "Rework onboarding"), tokens: ["onboard"]))
        XCTAssertTrue(SessionSearch.matches(makeSession(recap: "Opened a draft PR"), tokens: ["draft"]))
        XCTAssertTrue(SessionSearch.matches(makeSession(error: "Rate limit reached"), tokens: ["rate"]))
        XCTAssertTrue(SessionSearch.matches(makeSession(workspace: "luke-ios"), tokens: ["luke-ios"]))
        XCTAssertTrue(SessionSearch.matches(makeSession(branch: "feat/search-header"), tokens: ["search-header"]))
        XCTAssertTrue(SessionSearch.matches(makeSession(status: "waiting"), tokens: ["waiting"]))
    }

    func testMatchesProviderByWireId() {
        XCTAssertTrue(SessionSearch.matches(makeSession(providerId: "cursor", title: "Untitled"), tokens: ["cursor"]))
        // A provider the vault does not list still matches on its wire id.
        XCTAssertTrue(SessionSearch.matches(makeSession(providerId: "claude-code", title: "Untitled"), tokens: ["claude"]))
    }

    func testAbsentOptionalFieldsNeverMatch() {
        let bare = makeSession(title: "Untitled")
        XCTAssertFalse(SessionSearch.matches(bare, tokens: ["main"]))
    }
}
