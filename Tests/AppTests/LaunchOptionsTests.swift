import Foundation
import Testing
@testable import Luke

@Suite("App launch options")
struct LaunchOptionsTests {
    @Test("enables fixture mode from a command-line flag")
    func fixtureFlag() {
        let options = LaunchOptions(arguments: ["Luke", "--fixture"], environment: [:])

        #expect(options.isFixtureMode)
        #expect(options.evidenceOutputURL == nil)
    }

    @Test("accepts a deterministic evidence destination")
    func evidenceDestination() {
        let options = LaunchOptions(
            arguments: ["Luke", "--fixture", "--render-evidence", "/tmp/app-evidence.png"],
            environment: [:]
        )

        #expect(options.evidenceOutputURL == URL(fileURLWithPath: "/tmp/app-evidence.png"))
    }
}
