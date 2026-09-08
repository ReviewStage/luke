import Foundation
import XCTest

@testable import LukeKit

/// The phone's and the watch's stores are one type over two service strings.
/// What matters is that they never see each other's rows and that a round trip
/// keeps every field, including the three optional ones.
final class KeychainStoreTests: XCTestCase {
    // A service of its own, so a run of these tests cannot disturb a
    // signed-in build's real credentials on the same machine.
    private let store = KeychainStore(
        service: "dev.tryluke.tests.keychain-store",
        accessibility: .whenUnlocked
    )
    private let other = KeychainStore(
        service: "dev.tryluke.tests.keychain-store.other",
        accessibility: .afterFirstUnlock
    )

    override func setUp() {
        super.setUp()
        store.clearAll()
        other.clearAll()
    }

    override func tearDown() {
        store.clearAll()
        other.clearAll()
        super.tearDown()
    }

    private func makeTokens() -> StoredTokens {
        StoredTokens(
            accessToken: "access",
            refreshToken: "refresh",
            expiry: Date(timeIntervalSinceReferenceDate: 1_000),
            email: "developer@example.com",
            name: "Developer",
            accountID: "account-1",
            pictureURL: "https://example.com/photo.png"
        )
    }

    func testAValueRoundTrips() throws {
        try XCTSkipUnless(store.set("access", for: .accessToken), "this keychain refuses writes")
        XCTAssertEqual(store.get(.accessToken), "access")
        store.delete(.accessToken)
        XCTAssertNil(store.get(.accessToken))
    }

    func testTwoServicesNeverShareARow() throws {
        try XCTSkipUnless(store.set("mine", for: .accessToken), "this keychain refuses writes")
        other.set("theirs", for: .accessToken)
        XCTAssertEqual(store.get(.accessToken), "mine")
        XCTAssertEqual(other.get(.accessToken), "theirs")
        other.clearAll()
        XCTAssertEqual(store.get(.accessToken), "mine")
    }

    func testClearingLeavesNoKeyBehind() throws {
        try XCTSkipUnless(store.save(makeTokens()), "this keychain refuses writes")
        store.clearAll()
        for key in KeychainStore.Key.allCases {
            XCTAssertNil(store.get(key), key.rawValue)
        }
    }

    func testSavedTokensLoadBackWhole() throws {
        let tokens = makeTokens()
        try XCTSkipUnless(store.save(tokens), "this keychain refuses writes")
        XCTAssertEqual(store.load(), tokens)
    }

    func testTheOptionalFieldsSurviveTheirAbsence() throws {
        var tokens = makeTokens()
        try XCTSkipUnless(store.save(tokens), "this keychain refuses writes")
        tokens.name = nil
        tokens.accountID = nil
        tokens.pictureURL = nil
        store.save(tokens)
        XCTAssertEqual(store.load(), tokens)
    }

    func testNothingLoadsWithoutAnAccessToken() throws {
        try XCTSkipUnless(store.set("developer@example.com", for: .email), "refuses writes")
        XCTAssertNil(store.load())
    }

    func testAnUnreadableExpiryReadsAsSpentRatherThanValid() throws {
        var tokens = makeTokens()
        try XCTSkipUnless(store.save(tokens), "this keychain refuses writes")
        store.set("not a number", for: .expiry)
        let loaded = try XCTUnwrap(store.load())
        XCTAssertEqual(loaded.expiry.timeIntervalSinceNow, 0, accuracy: 5)
        tokens.expiry = loaded.expiry
        XCTAssertEqual(loaded, tokens)
    }
}
