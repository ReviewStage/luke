import Foundation
import XCTest

@testable import LukeKit

final class ProductEventsTests: XCTestCase {
    /// The bucket ladder must match the shared vocabulary's rung for rung:
    /// the service refuses any count that is not a rung, so a drifted ladder
    /// is a provider that quietly stops counting.
    func testBucketLadderMatchesTheSharedVocabulary() {
        XCTAssertEqual(
            ProductSessionCountBucket.allCases.map(\.rawValue),
            [0, 1, 2, 5, 10, 25]
        )
        XCTAssertEqual(ProductSessionCountBucket.bucket(for: -3), .none)
        XCTAssertEqual(ProductSessionCountBucket.bucket(for: 0), .none)
        XCTAssertEqual(ProductSessionCountBucket.bucket(for: 1), .one)
        XCTAssertEqual(ProductSessionCountBucket.bucket(for: 4), .few)
        XCTAssertEqual(ProductSessionCountBucket.bucket(for: 9), .several)
        XCTAssertEqual(ProductSessionCountBucket.bucket(for: 24), .many)
        XCTAssertEqual(ProductSessionCountBucket.bucket(for: 137), .crowd)
    }

    func testEventsCarryExactlyTheirAllowlistedProperties() {
        XCTAssertEqual(ProductEvent.appLaunch.name, "app:launch")
        XCTAssertEqual(
            ProductEvent.appLaunch.wireProperties(appVersion: "0.1.1") as? [String: String],
            ["app_version": "0.1.1"]
        )
        XCTAssertEqual(ProductEvent.accountSignIn.name, "account:sign_in")
        XCTAssertTrue(ProductEvent.accountSignIn.wireProperties(appVersion: "0.1.1").isEmpty)
        XCTAssertEqual(
            ProductEvent.accountAct(.signOut).wireProperties(appVersion: "0.1.1") as? [String: String],
            ["account_act": "sign_out"]
        )

        let observe = ProductEvent.sessionObserve(provider: .claudeCode, sessions: .few)
        XCTAssertEqual(observe.name, "session:observe")
        XCTAssertEqual(observe.wireProperties(appVersion: "0.1.1")["provider_id"] as? String, "claude-code")
        XCTAssertEqual(observe.wireProperties(appVersion: "0.1.1")["session_count"] as? Int, 2)

        let act = ProductEvent.sessionActSend(provider: .conductor, act: .messageSend)
        XCTAssertEqual(act.name, "session:act_send")
        XCTAssertEqual(
            act.wireProperties(appVersion: "0.1.1") as? [String: String],
            ["provider_id": "conductor", "session_act": "message_send"]
        )
    }

    /// A roster row's provider id reaches a count only through this set, so
    /// an id the vocabulary has not answered for must fail the read.
    func testAnUnlistedProviderIdDoesNotRead() {
        XCTAssertNil(ProductProviderID(rawValue: "codex — /Users/me/luke on feature/x"))
        XCTAssertEqual(ProductProviderID(rawValue: "claude-code"), .claudeCode)
        XCTAssertNil(ProductProviderID(rawValue: "gemini-cli"))
    }
}
