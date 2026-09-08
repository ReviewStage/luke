import LukeKit
import UIKit
import XCTest

@testable import Luke

/// A `Menu` draws only an image beside each title and drops a custom label
/// view, so every provider the vault offers needs a rasterized mark or its
/// row appears without one.
final class MarksTests: XCTestCase {
    @MainActor
    func testEveryVaultProviderHasAMenuIcon() {
        for provider in VaultProviderID.allCases {
            let icon = ProviderMark.menuIcon(for: provider)
            XCTAssertGreaterThan(icon.size.width, 0, provider.rawValue)
            XCTAssertGreaterThan(icon.size.height, 0, provider.rawValue)
            XCTAssertEqual(icon.renderingMode, .alwaysTemplate, provider.rawValue)
        }
    }
}
