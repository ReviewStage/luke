import CoreAudio
import Foundation

/// Reports whether the Mac's output would let Luke be heard: the default
/// output device's mute switch and its volume, and nothing else.
///
/// CoreAudio is the reason this is a helper and the bound on what it does. The
/// HAL answers two questions about the device the user's volume keys move —
/// is it muted, and how loud is it — and pushes a line whenever either answer
/// changes, or the default device itself does. Nothing is ever written back:
/// the app draws captions and a hint from these lines, and turning the volume
/// up stays the user's own act on their own keys.
///
/// One line per state: `output muted=<0|1> volume=<0.00–1.00>`, emitted once
/// on start and again on every change. A machine with no output device, or one
/// whose device answers neither question, says `unavailable` instead — the
/// reader treats silence it cannot see as sound, so Luke never nags from a
/// guess.
private let VOLUME_UNKNOWN: Float = 1.0

/// `kAudioHardwareServiceDeviceProperty_VirtualMainVolume`: the level the
/// volume keys actually move, whatever channel layout the device has.
/// Declared by value because the framework marks the name deprecated while
/// the HAL keeps answering the selector — and the replacement the deprecation
/// points at (per-channel scalars) is exactly what this is not.
private let VIRTUAL_MAIN_VOLUME = AudioObjectPropertySelector(0x766D_7663) // 'vmvc'

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

private func readMute(of device: AudioObjectID) -> Bool? {
    var query = address(kAudioDevicePropertyMute, scope: kAudioDevicePropertyScopeOutput)
    guard AudioObjectHasProperty(device, &query) else { return nil }
    var muted = UInt32(0)
    var size = UInt32(MemoryLayout<UInt32>.size)
    guard AudioObjectGetPropertyData(device, &query, 0, nil, &size, &muted) == noErr else {
        return nil
    }
    return muted != 0
}

private func readVolume(of device: AudioObjectID) -> Float? {
    var query = address(VIRTUAL_MAIN_VOLUME, scope: kAudioDevicePropertyScopeOutput)
    guard AudioObjectHasProperty(device, &query) else { return nil }
    var volume = Float(0)
    var size = UInt32(MemoryLayout<Float>.size)
    guard AudioObjectGetPropertyData(device, &query, 0, nil, &size, &volume) == noErr else {
        return nil
    }
    return volume
}

@main
@MainActor
private struct OutputVolumeCommand {
    static var device: AudioObjectID?
    /// The devices already wired, kept because a device is not new twice: the
    /// user can move output between two live devices all day, and wiring the
    /// same one again would double every report it ever makes.
    static var wired = Set<AudioObjectID>()
    /// The queue every listener reports on, so a device swap and the swapped
    /// device's own last change cannot interleave.
    static let queue = DispatchQueue.main

    static func main() {
        var defaultDevice = address(kAudioHardwarePropertyDefaultOutputDevice)
        // AirPods arriving, a display leaving: the question follows whichever
        // device the volume keys now answer to.
        AudioObjectAddPropertyListenerBlock(
            AudioObjectID(kAudioObjectSystemObject), &defaultDevice, queue
        ) { _, _ in
            MainActor.assumeIsolated { follow() }
        }
        follow()
        dispatchMain()
    }

    /// Points the reporting at the current default device, wiring its two
    /// listeners the first time it is seen, and says where its switches stand.
    static func follow() {
        guard let next = readDefaultOutputDevice() else {
            device = nil
            emit("unavailable no-output-device")
            return
        }
        device = next
        if !wired.contains(next) {
            wired.insert(next)
            let change: AudioObjectPropertyListenerBlock = { _, _ in
                MainActor.assumeIsolated { report() }
            }
            var mute = address(kAudioDevicePropertyMute, scope: kAudioDevicePropertyScopeOutput)
            if AudioObjectHasProperty(next, &mute) {
                AudioObjectAddPropertyListenerBlock(next, &mute, queue, change)
            }
            var volume = address(VIRTUAL_MAIN_VOLUME, scope: kAudioDevicePropertyScopeOutput)
            if AudioObjectHasProperty(next, &volume) {
                AudioObjectAddPropertyListenerBlock(next, &volume, queue, change)
            }
        }
        report()
    }

    static func report() {
        guard let device else { return }
        let muted = readMute(of: device)
        let volume = readVolume(of: device)
        // A device that answers neither question is one this cannot watch:
        // an HDMI display with no controls of its own, say. The reader must
        // hear that as "assume audible", never as "muted".
        guard muted != nil || volume != nil else {
            emit("unavailable no-controls")
            return
        }
        let level = max(0, min(1, volume ?? VOLUME_UNKNOWN))
        emit("output muted=\(muted == true ? 1 : 0) volume=\(String(format: "%.2f", level))")
    }
}
