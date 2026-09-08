import SwiftUI
import XCTest

@testable import Luke

/// The palette rests on one rendering assumption: a `Canvas` shading built
/// with `.color(_:)` from an appearance-resolved colour follows the colour
/// scheme it is drawn under, so a mark inked that way (the provider
/// silhouettes, the connected check) can never go stale against the surface
/// behind it. The assertion is made against the real `Color.ink` rather than
/// a reproduction of how it is built, which is what the app actually draws.
final class PaletteTests: XCTestCase {
    @MainActor
    func testInkFollowsTheSchemeItIsDrawnUnder() throws {
        let mark = Canvas { context, size in
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(.ink))
        }
        .frame(width: 4, height: 4)

        func centerLuminance(_ scheme: ColorScheme) throws -> Int {
            let renderer = ImageRenderer(content: mark.environment(\.colorScheme, scheme))
            let image = try XCTUnwrap(renderer.cgImage)
            let data = try XCTUnwrap(image.dataProvider?.data) as Data
            let offset = (image.height / 2) * image.bytesPerRow
                + (image.width / 2) * (image.bitsPerPixel / 8)
            return (Int(data[offset]) + Int(data[offset + 1]) + Int(data[offset + 2])) / 3
        }

        XCTAssertGreaterThan(try centerLuminance(.dark), 200)
        XCTAssertLessThan(try centerLuminance(.light), 55)
    }
}
