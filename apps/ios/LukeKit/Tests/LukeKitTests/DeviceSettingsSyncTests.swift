import Foundation
import XCTest

@testable import LukeKit

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
        workspaceProviderId: "conductor",
        workspaceProjectIds: ["conductor": "proj-1", "codex": "https://github.com/o/r"],
        workspaceAgentDefaults: [
            "conductor": WorkspaceAgentDefault(agent: "claude", model: "fable-5", effort: "high"),
            "codex": WorkspaceAgentDefault(agent: "codex", model: "gpt"),
            "superset": WorkspaceAgentDefault(agent: "composer"),
        ]
    )

    @MainActor
    func testSnapshotRoundTripsThroughTheStore() async {
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

    @MainActor
    func testALocalChangePublishesOnceAndTheOtherDeviceApplies() async {
        let phoneStore = makeStore()
        let watchStore = makeStore()
        var phonePublished: [[String: Any]] = []
        var watchPublished: [[String: Any]] = []
        let phone = DeviceSettingsSync(store: phoneStore, role: .primary, now: tick) { phonePublished.append($0) }
        let watch = DeviceSettingsSync(store: watchStore, role: .secondary, now: tick) { watchPublished.append($0) }
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

    @MainActor
    func testEveryFieldTravels() async {
        let phoneStore = makeStore()
        let watchStore = makeStore()
        var published: [[String: Any]] = []
        let phone = DeviceSettingsSync(store: phoneStore, role: .primary, now: tick) { published.append($0) }
        let watch = DeviceSettingsSync(store: watchStore, role: .secondary, now: tick) { _ in }
        phone.start()
        watch.start()

        changed.write(to: phoneStore)
        XCTAssertFalse(published.isEmpty)
        watch.receive(published.last!)
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: watchStore), changed)
    }

    @MainActor
    func testAnOlderSnapshotIsIgnored() async {
        let phoneStore = makeStore()
        let watchStore = makeStore()
        var phonePublished: [[String: Any]] = []
        var watchPublished: [[String: Any]] = []
        let phone = DeviceSettingsSync(store: phoneStore, role: .primary, now: tick) { phonePublished.append($0) }
        let watch = DeviceSettingsSync(store: watchStore, role: .secondary, now: tick) { watchPublished.append($0) }
        phone.start()
        watch.start()

        phoneStore.set(LiveVoice.beacon.rawValue, forKey: VoiceSettingsKey.voice)
        WorkspaceCreationDefaults(store: watchStore).lastProviderId = "codex"

        phone.receive(watchPublished.last!)
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: phoneStore).workspaceProviderId, "codex")
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: phoneStore).voice, .default)

        watch.receive(phonePublished.last!)
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: watchStore).workspaceProviderId, "codex")
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: watchStore).voice, .default)
    }

    @MainActor
    func testSettingsChangedBeforeEverSyncingWinOverAFreshPair() async {
        let phoneStore = makeStore()
        changed.write(to: phoneStore)
        let watchStore = makeStore()
        var phonePublished: [[String: Any]] = []
        let phone = DeviceSettingsSync(store: phoneStore, role: .primary, now: tick) { phonePublished.append($0) }
        let watch = DeviceSettingsSync(store: watchStore, role: .secondary, now: tick) { _ in }
        phone.start()
        watch.start()

        phone.publishCurrent()
        watch.receive(phonePublished.last!)
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: watchStore), changed)
    }

    @MainActor
    func testTwoPreSyncCopiesSettleOnThePrimaryWhicheverActivatesFirst() async {
        for primaryFirst in [true, false] {
            let phoneStore = makeStore()
            let watchStore = makeStore()
            changed.write(to: phoneStore)
            var onWatch = changed
            onWatch.voice = .verse
            onWatch.workspaceProviderId = "codex"
            onWatch.write(to: watchStore)
            var phonePublished: [[String: Any]] = []
            var watchPublished: [[String: Any]] = []
            let phone = DeviceSettingsSync(store: phoneStore, role: .primary, now: tick) {
                phonePublished.append($0)
            }
            let watch = DeviceSettingsSync(store: watchStore, role: .secondary, now: tick) {
                watchPublished.append($0)
            }
            if primaryFirst {
                phone.start()
                watch.start()
            } else {
                watch.start()
                phone.start()
            }

            phone.publishCurrent()
            watch.publishCurrent()
            phone.receive(watchPublished.last!)
            watch.receive(phonePublished.last!)
            XCTAssertEqual(DeviceSettingsSnapshot.read(from: phoneStore), changed)
            XCTAssertEqual(DeviceSettingsSnapshot.read(from: watchStore), changed)
        }
    }

    @MainActor
    func testAChangeMadeAfterSyncingBeatsAPreSyncCopy() async {
        let phoneStore = makeStore()
        let watchStore = makeStore()
        changed.write(to: phoneStore)
        var phonePublished: [[String: Any]] = []
        var watchPublished: [[String: Any]] = []
        let phone = DeviceSettingsSync(store: phoneStore, role: .primary, now: tick) {
            phonePublished.append($0)
        }
        let watch = DeviceSettingsSync(store: watchStore, role: .secondary, now: tick) {
            watchPublished.append($0)
        }
        watch.start()
        watchStore.set(RealtimeVoice.verse.rawValue, forKey: VoiceSettingsKey.voice)
        phone.start()

        phone.publishCurrent()
        watch.receive(phonePublished.last!)
        phone.receive(watchPublished.last!)
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: watchStore).voice, .verse)
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: phoneStore).voice, .verse)
    }

    @MainActor
    func testAnUntouchedDeviceNeverOverwritesAChangedOne() async {
        let phoneStore = makeStore()
        let watchStore = makeStore()
        var watchPublished: [[String: Any]] = []
        let phone = DeviceSettingsSync(store: phoneStore, role: .primary, now: tick) { _ in }
        let watch = DeviceSettingsSync(store: watchStore, role: .secondary, now: tick) { watchPublished.append($0) }
        phone.start()
        watch.start()

        phoneStore.set(RealtimeVoice.sage.rawValue, forKey: VoiceSettingsKey.voice)
        watch.publishCurrent()
        phone.receive(watchPublished.last!)
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: phoneStore).voice, .sage)
    }

    @MainActor
    func testTheStampSurvivesARelaunch() async {
        let phoneStore = makeStore()
        let watchStore = makeStore()
        var watchPublished: [[String: Any]] = []
        let watch = DeviceSettingsSync(store: watchStore, role: .secondary, now: tick) { watchPublished.append($0) }
        watch.start()
        watchStore.set(RealtimeVoice.sage.rawValue, forKey: VoiceSettingsKey.voice)
        let stale = watchPublished.last!

        var phone: DeviceSettingsSync? = DeviceSettingsSync(store: phoneStore, role: .primary, now: tick) { _ in }
        phone?.start()
        phoneStore.set(RealtimeVoice.ash.rawValue, forKey: VoiceSettingsKey.voice)
        phone = nil

        let relaunched = DeviceSettingsSync(store: phoneStore, role: .primary, now: tick) { _ in }
        relaunched.start()
        relaunched.receive(stale)
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: phoneStore).voice, .ash)
    }

    @MainActor
    func testUnreadablePayloadsAreIgnored() async {
        let store = makeStore()
        let sync = DeviceSettingsSync(store: store, role: .primary, now: tick) { _ in }
        sync.start()
        sync.receive(["settingsVersion": 99, "changedAt": 5.0, "voice": "coral"])
        sync.receive(["settingsVersion": 2, "voice": "coral"])
        sync.receive(["settingsVersion": 2, "changedAt": 5.0, "speed": "fast"])
        sync.receive(["settingsVersion": 1, "changedAt": 5.0, "voice": "coral", "speed": "fast"])
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: store), DeviceSettingsSnapshot())

        sync.receive(["settingsVersion": 2, "changedAt": 5.0, "voice": "nobody"])
        XCTAssertEqual(DeviceSettingsSnapshot.read(from: store), DeviceSettingsSnapshot())
    }
}
