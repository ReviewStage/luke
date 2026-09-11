import Foundation
import XCTest

@testable import LukeKit

/// What a briefing's notification carries for the tap, and which gateway a
/// build's tokens belong to.
final class BriefingPushTests: XCTestCase {
    private let messageId = "2b000000-0000-4000-8000-000000000032"

    func testATapReadsTheMessageIdAndNothingElse() {
        let tap = BriefingPushTap(userInfo: [
            BriefingPushTap.messageIdKey: messageId,
            "aps": ["alert": ["body": "One fixture agent finished."]],
        ])
        XCTAssertEqual(tap, BriefingPushTap(userInfo: [BriefingPushTap.messageIdKey: messageId]))
        XCTAssertEqual(tap?.messageId, messageId)
    }

    func testATapWithoutAWireIdOpensNothingInParticular() {
        XCTAssertNil(BriefingPushTap(userInfo: ["aps": ["alert": ["body": "Words alone."]]]))
        XCTAssertNil(BriefingPushTap(userInfo: [BriefingPushTap.messageIdKey: messageId.uppercased()]))
        XCTAssertNil(BriefingPushTap(userInfo: [BriefingPushTap.messageIdKey: "not-a-uuid"]))
        XCTAssertNil(BriefingPushTap(userInfo: [BriefingPushTap.messageIdKey: 42]))
        XCTAssertNil(BriefingPushTap(userInfo: [BriefingPushTap.messageIdKey: ""]))
    }

    private func profile(gateway: String?) -> Data {
        var entitlements = "<key>get-task-allow</key><true/>"
        if let gateway {
            entitlements += "<key>aps-environment</key><string>\(gateway)</string>"
        }
        let plist = """
            <?xml version="1.0" encoding="UTF-8"?>
            <plist version="1.0"><dict>
            <key>Name</key><string>Fixture profile</string>
            <key>Entitlements</key><dict>\(entitlements)</dict>
            </dict></plist>
            """
        // The signed envelope around the plist: bytes on either side that are not text.
        return Data([0x30, 0x82, 0x0a, 0xff, 0x00]) + Data(plist.utf8) + Data([0x00, 0xa0, 0x82])
    }

    func testADevelopmentProfileNamesTheSandboxGateway() {
        XCTAssertEqual(PushEnvironment.fromProvisioningProfile(profile(gateway: "development")), .sandbox)
    }

    func testAProductionProfileAndAnUnreadableOrAbsentOneNameProduction() {
        XCTAssertEqual(PushEnvironment.fromProvisioningProfile(profile(gateway: "production")), .production)
        XCTAssertEqual(PushEnvironment.fromProvisioningProfile(profile(gateway: nil)), .production)
        XCTAssertEqual(PushEnvironment.fromProvisioningProfile(nil), .production)
        XCTAssertEqual(PushEnvironment.fromProvisioningProfile(Data([0x30, 0x82, 0x00])), .production)
        XCTAssertEqual(PushEnvironment.fromProvisioningProfile(Data("<?xml not a plist".utf8)), .production)
    }
}
