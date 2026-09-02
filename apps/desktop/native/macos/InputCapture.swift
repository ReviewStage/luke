import CoreAudio
import Foundation

/// Reports whether another app is using this Mac's microphone: one yes-or-no,
/// and nothing else.
///
/// CoreAudio is the reason this is a helper and the bound on what it does. The
/// HAL says of each input device whether any process has it running — the
/// same fact the orange dot in the menu bar draws from — and pushes a line
/// whenever the answer changes. No audio is read, no device or process is
/// named, and nothing is ever written back: the app holds spoken
/// announcements while the answer is yes, and that is the whole power.
///
/// Two facts are watched, and the answer is their OR:
///
/// 1. Any device with input streams is running somewhere. Every input device
///    is watched, not only the default: a call app may capture from a
///    non-default microphone.
/// 2. A Bluetooth headset is on its call codec. Bluetooth microphones do not
///    set the running flag while in use, but a headset whose mic opens drops
///    from A2DP to HFP/SCO, which pulls the default output's nominal sample
///    rate down to 8 or 16 kHz. That drop, on a Bluetooth output, is the
///    call.
///
/// One line per state: `capture running=<0|1>`, emitted once on start and again
/// on every change. A machine with no input device at all says `unavailable`
/// instead — the reader treats an answer it cannot see as "not capturing", so
/// a hold never comes from a guess.
private let CALL_CODEC_MAXIMUM_SAMPLE_RATE: Float64 = 16_000

private func emit(_ line: String) {
    guard let payload = "\(line)\n".data(using: .utf8) else { return }
    FileHandle.standardOutput.write(payload)
}

private func address(
    _ selector: AudioObjectPropertySelector,
    scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: scope,
        mElement: kAudioObjectPropertyElementMain
    )
}

private func readUInt32(_ device: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
    var query = address(selector)
    guard AudioObjectHasProperty(device, &query) else { return nil }
    var value = UInt32(0)
    var size = UInt32(MemoryLayout<UInt32>.size)
    guard AudioObjectGetPropertyData(device, &query, 0, nil, &size, &value) == noErr else {
        return nil
    }
    return value
}

private func readDefaultOutputDevice() -> AudioObjectID? {
    var query = address(kAudioHardwarePropertyDefaultOutputDevice)
    var device = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    let status = AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &query, 0, nil, &size, &device
    )
    guard status == noErr, device != kAudioObjectUnknown else { return nil }
    return device
}

private func allDevices() -> [AudioObjectID] {
    var query = address(kAudioHardwarePropertyDevices)
    var size = UInt32(0)
    let system = AudioObjectID(kAudioObjectSystemObject)
    guard AudioObjectGetPropertyDataSize(system, &query, 0, nil, &size) == noErr, size > 0 else {
        return []
    }
    var devices = [AudioObjectID](
        repeating: AudioObjectID(kAudioObjectUnknown),
        count: Int(size) / MemoryLayout<AudioObjectID>.size
    )
    guard AudioObjectGetPropertyData(system, &query, 0, nil, &size, &devices) == noErr else {
        return []
    }
    return devices
}

/// Whether the device can capture at all: the device list holds speakers and
/// displays too, and a microphone is the one with input streams.
private func hasInputStreams(_ device: AudioObjectID) -> Bool {
    var query = address(kAudioDevicePropertyStreams, scope: kAudioDevicePropertyScopeInput)
    var size = UInt32(0)
    guard AudioObjectGetPropertyDataSize(device, &query, 0, nil, &size) == noErr else {
        return false
    }
    return size > 0
}

private func isRunningSomewhere(_ device: AudioObjectID) -> Bool {
    readUInt32(device, kAudioDevicePropertyDeviceIsRunningSomewhere) == 1
}

private func isBluetooth(_ device: AudioObjectID) -> Bool {
    switch readUInt32(device, kAudioDevicePropertyTransportType) {
    case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE:
        return true
    default:
        return false
    }
}

private func nominalSampleRate(of device: AudioObjectID) -> Float64? {
    var query = address(kAudioDevicePropertyNominalSampleRate)
    guard AudioObjectHasProperty(device, &query) else { return nil }
    var rate = Float64(0)
    var size = UInt32(MemoryLayout<Float64>.size)
    guard AudioObjectGetPropertyData(device, &query, 0, nil, &size, &rate) == noErr else {
        return nil
    }
    return rate
}

@main
@MainActor
private struct InputCaptureCommand {
    /// The devices already wired, kept because a device is not new twice: a
    /// headset can come and go all day, and wiring the same one again would
    /// double every report it ever makes.
    static var wiredInputs = Set<AudioObjectID>()
    static var wiredOutputs = Set<AudioObjectID>()
    static var inputs: [AudioObjectID] = []
    static var output: AudioObjectID?
    static var lastLine: String?
    /// The queue every listener reports on, so a device swap and the swapped
    /// device's own last change cannot interleave.
    static let queue = DispatchQueue.main

    static func main() {
        let system = AudioObjectID(kAudioObjectSystemObject)
        var devices = address(kAudioHardwarePropertyDevices)
        AudioObjectAddPropertyListenerBlock(system, &devices, queue) { _, _ in
            MainActor.assumeIsolated { followInputs() }
        }
        var defaultOutput = address(kAudioHardwarePropertyDefaultOutputDevice)
        AudioObjectAddPropertyListenerBlock(system, &defaultOutput, queue) { _, _ in
            MainActor.assumeIsolated { followOutput() }
        }
        followInputs()
        followOutput()
        dispatchMain()
    }

    static func followInputs() {
        inputs = allDevices().filter(hasInputStreams)
        let change: AudioObjectPropertyListenerBlock = { _, _ in
            MainActor.assumeIsolated { report() }
        }
        for device in inputs where !wiredInputs.contains(device) {
            wiredInputs.insert(device)
            var running = address(kAudioDevicePropertyDeviceIsRunningSomewhere)
            AudioObjectAddPropertyListenerBlock(device, &running, queue, change)
        }
        report()
    }

    static func followOutput() {
        output = readDefaultOutputDevice()
        if let output, !wiredOutputs.contains(output) {
            wiredOutputs.insert(output)
            var rate = address(kAudioDevicePropertyNominalSampleRate)
            AudioObjectAddPropertyListenerBlock(output, &rate, queue) { _, _ in
                MainActor.assumeIsolated { report() }
            }
        }
        report()
    }

    static func headsetOnCallCodec() -> Bool {
        guard let output, isBluetooth(output), let rate = nominalSampleRate(of: output) else {
            return false
        }
        return rate <= CALL_CODEC_MAXIMUM_SAMPLE_RATE
    }

    static func report() {
        // Wired listeners on a device that has since left still fire, so the
        // answer is read only from the devices the last enumeration listed.
        let live = inputs.filter { device in
            var query = address(kAudioDevicePropertyDeviceIsRunningSomewhere)
            return AudioObjectHasProperty(device, &query)
        }
        guard !live.isEmpty else {
            say("unavailable no-input-device")
            return
        }
        let running = live.contains(where: isRunningSomewhere) || headsetOnCallCodec()
        say("capture running=\(running ? 1 : 0)")
    }

    /// Several listeners fire for one change, so only a changed answer is
    /// written: the reader debounces on edges and a repeat would be noise.
    static func say(_ line: String) {
        guard line != lastLine else { return }
        lastLine = line
        emit(line)
    }
}
