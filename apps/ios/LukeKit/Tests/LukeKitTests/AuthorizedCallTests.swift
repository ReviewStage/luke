import Foundation
import XCTest

@testable import LukeKit

/// The one retry every hosted client on the phone shares, and the fence on
/// it: a retry is a second request, and the account can change between the
/// two.
@MainActor
final class AuthorizedCallTests: XCTestCase {
    private struct Refusal: Error, HostedUnauthorizedSignaling {
        var isUnauthorized: Bool { true }
    }

    /// A session whose holder a test moves between the first attempt and the refresh.
    private final class Session: AccountTokenProviding {
        var accountEmail: String?
        var holderAfterRefresh: String?
        var refreshes = 0

        init(holder: String?) {
            accountEmail = holder
            holderAfterRefresh = holder
        }

        func validAccessToken() async throws -> String { "first" }

        func refreshAccessToken() async throws -> String {
            refreshes += 1
            accountEmail = holderAfterRefresh
            return "fresh"
        }
    }

    func testAnUnauthorizedAnswerRefreshesAndRetriesOnceUnderTheSameHolder() async throws {
        let session = Session(holder: "dev@example.invalid")
        var tokens: [String] = []
        let answer = try await session.authorized { token -> Int in
            tokens.append(token)
            if token == "first" { throw Refusal() }
            return 42
        }
        XCTAssertEqual(answer, 42)
        XCTAssertEqual(tokens, ["first", "fresh"])
        XCTAssertEqual(session.refreshes, 1)
    }

    func testARetryUnderAnotherHolderIsRefusedBeforeItTravels() async {
        let session = Session(holder: "first@example.invalid")
        session.holderAfterRefresh = "second@example.invalid"
        var tokens: [String] = []
        do {
            _ = try await session.authorized { token -> Int in
                tokens.append(token)
                throw Refusal()
            }
            XCTFail("a refused retry")
        } catch let error as AccountSessionError {
            XCTAssertEqual(error, .signedOut)
        } catch {
            XCTFail("\(error)")
        }
        XCTAssertEqual(tokens, ["first"])
    }

    func testARetryAfterASignOutIsRefused() async {
        let session = Session(holder: "first@example.invalid")
        session.holderAfterRefresh = nil
        var attempts = 0
        do {
            _ = try await session.authorized { _ -> Int in
                attempts += 1
                throw Refusal()
            }
            XCTFail("a refused retry")
        } catch let error as AccountSessionError {
            XCTAssertEqual(error, .signedOut)
        } catch {
            XCTFail("\(error)")
        }
        XCTAssertEqual(attempts, 1)
    }

    func testASignedOutSessionMakesNoCall() async {
        let session = Session(holder: nil)
        var attempts = 0
        do {
            _ = try await session.authorized { _ -> Int in
                attempts += 1
                return 0
            }
            XCTFail("a refused call")
        } catch let error as AccountSessionError {
            XCTAssertEqual(error, .signedOut)
        } catch {
            XCTFail("\(error)")
        }
        XCTAssertEqual(attempts, 0)
    }

    func testAnErrorThatIsNotUnauthorizedIsNotRetried() async {
        struct Other: Error {}
        let session = Session(holder: "dev@example.invalid")
        var attempts = 0
        do {
            _ = try await session.authorized { _ -> Int in
                attempts += 1
                throw Other()
            }
            XCTFail("a thrown error")
        } catch is Other {
        } catch {
            XCTFail("\(error)")
        }
        XCTAssertEqual(attempts, 1)
        XCTAssertEqual(session.refreshes, 0)
    }
}
