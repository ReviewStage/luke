import XCTest

@testable import LukeKit

final class MobileSentryConfigurationTests: XCTestCase {
    func testAnEmptyConfigurationDisablesSentry() {
        XCTAssertNil(
            MobileSentryConfiguration.resolve(
                platform: .iOS,
                appVersion: "0.1.0",
                infoDictionary: [:],
                environment: [:]
            )
        )
    }

    func testTheInfoDictionaryBuildsAnIOSConfiguration() {
        let configuration = MobileSentryConfiguration.resolve(
            platform: .iOS,
            appVersion: "0.1.0",
            infoDictionary: [
                MobileSentryConfiguration.dsnInfoDictionaryKey: " https://public@example.invalid/1 ",
                "CFBundleVersion": "42",
            ],
            environment: [:]
        )

        XCTAssertEqual(
            configuration,
            MobileSentryConfiguration(
                dsn: "https://public@example.invalid/1",
                dist: "42",
                enableCrashHandler: true,
                environment: "development",
                releaseName: "Luke@0.1.0"
            )
        )
    }

    func testAWatchConfigurationLeavesTheCrashHandlerOff() {
        let configuration = MobileSentryConfiguration.resolve(
            platform: .watchOS,
            appVersion: "0.1.0",
            infoDictionary: [
                MobileSentryConfiguration.dsnInfoDictionaryKey: "https://public@example.invalid/1",
            ],
            environment: [:]
        )

        XCTAssertEqual(configuration?.enableCrashHandler, false)
    }

    func testTheDebugEnvironmentOverrideWins() {
        let configuration = MobileSentryConfiguration.resolve(
            platform: .iOS,
            appVersion: "0.1.0",
            infoDictionary: [
                MobileSentryConfiguration.dsnInfoDictionaryKey: "https://plist@example.invalid/1",
            ],
            environment: [
                MobileSentryConfiguration.dsnEnvironmentKey: " https://env@example.invalid/1 ",
            ]
        )

        XCTAssertEqual(configuration?.dsn, "https://env@example.invalid/1")
    }
}
