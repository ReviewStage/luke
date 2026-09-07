import Foundation
import XCTest

@testable import LukeKit

@MainActor
final class DeviceSettingsSyncTests: XCTestCase {
    private var suites: [String] = []
    private var clock = Date(timeIntervalSinceReferenceDate: 1_000)

    override func tearDown() {
        for suite in suites { UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite) }
        super.tearDown()
    }

    private func makeStore() -> UserDefaults {
        let suite = "device-settings-sync-tests-\(UUID().uuidString)"
        suites.append(suite)
        return UserDefaults(suiteName: suite)!
    }

    private func tick() -> Date {
        clock = clock.addingTimeInterval(1)
        return clock
    }

    private let changed = DeviceSettingsSnapshot(
        voice: .coral,
        speed: .fast,
        workspaceProviderId: "conductor",
        workspaceProjectIds: ["conductor": "proj-1", "codex": "https://github.com/o/r"],
        workspaceAgentDefaults: [
            "conductor": WorkspaceAgentDefault(agent: "claude", model: "fable-5", effort: "high"),
            "codex": WorkspaceAgentDefault(agent: "codex", model: "gpt"),
        ]
    )

    func testSnapshotRoundTripsThroughTheStore() {
        let store = makeStore()
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: store), DeviceSettingsSnapshot())
        changed.write(to: store)
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: store), changed)
        XCTAssertEqual(store.string(forKey: VoiceSettingsKey.voice), "coral")
        XCTAssertEqual(WorkspaceCreationDefaults(store: store).agentDefault(for: "codex")?.model, "gpt")

        DeviceSettingsSnapshot().write(to: store)
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: store), DeviceSettingsSnapshot())
        XCTAssertNil(WorkspaceCreationDefaults(store: store).lastProviderId)
    }

    func testALocalChangePublishesOnceAndTheOtherDeviceApplies() {
        let phoneStore = makeStore()
        let watchStore = makeStore()
        var phonePublished: [[String: Any]] = []
        var watchPublished: [[String: Any]] = []
        let phone = DeviceSettingsSync(store: phoneStore, now: tick) { phonePublished.append($0) }
        let watch = DeviceSettingsSync(store: watchStore, now: tick) { watchPublished.append($0) }
        phone.start()
        watch.start()

        phoneStore.set(RealtimeVoice.sage.rawValue, forKey: VoiceSettingsKey.voice)
        XCTAssertEqual(phonePublished.count, 1)
        XCTAssertEqual(phonePublished[0]["voice"] as? String, "sage")
        XCTAssertEqual(phonePublished[0]["settingsVersion"] as? Int, DeviceSettingsSync.payloadVersion)

        watch.receive(phonePublished[0])
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: watchStore).voice, .sage)
        XCTAssertTrue(watchPublished.isEmpty, "applying a received snapshot must not echo it back")
    }

    func testEveryFieldTravels() {
        let phoneStore = makeStore()
        let watchStore = makeStore()
        var published: [[String: Any]] = []
        let phone = DeviceSettingsSync(store: phoneStore, now: tick) { published.append($0) }
        let watch = DeviceSettingsSync(store: watchStore, now: tick) { _ in }
        phone.start()
        watch.start()

        changed.write(to: phoneStore)
        XCTAssertFalse(published.isEmpty)
        watch.receive(published.last!)
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: watchStore), changed)
    }

    func testAnOlderSnapshotIsIgnored() {
        let phoneStore = makeStore()
        let watchStore = makeStore()
        var phonePublished: [[String: Any]] = []
        var watchPublished: [[String: Any]] = []
        let phone = DeviceSettingsSync(store: phoneStore, now: tick) { phonePublished.append($0) }
        let watch = DeviceSettingsSync(store: watchStore, now: tick) { watchPublished.append($0) }
        phone.start()
        watch.start()

        phoneStore.set(RealtimeVoice.sage.rawValue, forKey: VoiceSettingsKey.voice)
        watchStore.set(RealtimeVoiceSpeed.slow.rawValue, forKey: VoiceSettingsKey.speed)

        phone.receive(watchPublished.last!)
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: phoneStore).speed, .slow)
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: phoneStore).voice, .default)

        watch.receive(phonePublished.last!)
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: watchStore).speed, .slow)
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: watchStore).voice, .default)
    }

    func testSettingsChangedBeforeEverSyncingWinOverAFreshPair() {
        let phoneStore = makeStore()
        changed.write(to: phoneStore)
        let watchStore = makeStore()
        var phonePublished: [[String: Any]] = []
        let phone = DeviceSettingsSync(store: phoneStore, now: tick) { phonePublished.append($0) }
        let watch = DeviceSettingsSync(store: watchStore, now: tick) { _ in }
        phone.start()
        watch.start()

        phone.publishCurrent()
        watch.receive(phonePublished.last!)
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: watchStore), changed)
    }

    func testAnUntouchedDeviceNeverOverwritesAChangedOne() {
        let phoneStore = makeStore()
        let watchStore = makeStore()
        var watchPublished: [[String: Any]] = []
        let phone = DeviceSettingsSync(store: phoneStore, now: tick) { _ in }
        let watch = DeviceSettingsSync(store: watchStore, now: tick) { watchPublished.append($0) }
        phone.start()
        watch.start()

        phoneStore.set(RealtimeVoice.sage.rawValue, forKey: VoiceSettingsKey.voice)
        watch.publishCurrent()
        phone.receive(watchPublished.last!)
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: phoneStore).voice, .sage)
    }

    func testTheStampSurvivesARelaunch() {
        let phoneStore = makeStore()
        let watchStore = makeStore()
        var watchPublished: [[String: Any]] = []
        let watch = DeviceSettingsSync(store: watchStore, now: tick) { watchPublished.append($0) }
        watch.start()
        watchStore.set(RealtimeVoice.sage.rawValue, forKey: VoiceSettingsKey.voice)
        let stale = watchPublished.last!

        var phone: DeviceSettingsSync? = DeviceSettingsSync(store: phoneStore, now: tick) { _ in }
        phone?.start()
        phoneStore.set(RealtimeVoice.ash.rawValue, forKey: VoiceSettingsKey.voice)
        phone = nil

        let relaunched = DeviceSettingsSync(store: phoneStore, now: tick) { _ in }
        relaunched.start()
        relaunched.receive(stale)
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: phoneStore).voice, .ash)
    }

    func testUnreadablePayloadsAreIgnored() {
        let store = makeStore()
        let sync = DeviceSettingsSync(store: store, now: tick) { _ in }
        sync.start()
        sync.receive(["settingsVersion": 99, "changedAt": 5.0, "voice": "coral", "speed": "fast"])
        sync.receive(["settingsVersion": 1, "voice": "coral", "speed": "fast"])
        sync.receive(["settingsVersion": 1, "changedAt": 5.0, "voice": "coral"])
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: store), DeviceSettingsSnapshot())

        sync.receive(["settingsVersion": 1, "changedAt": 5.0, "voice": "nobody", "speed": "warp"])
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: store), DeviceSettingsSnapshot())
    }
}
