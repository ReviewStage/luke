import CoreAudio
import Foundation
import IOKit

/// Reports where the developer's voice would be captured from — and nothing
/// else. Three read-only facts: the default input device's transport, whether
/// this Mac has a built-in microphone (and its name, so the renderer can find
/// the same device in the browser's list), and whether the lid that microphone
/// sits under is open. No audio is ever read, and nothing is ever written
/// back: what the facts decide is only which device the renderer asks the
/// browser to open when a press takes a turn, so a Bluetooth headset is not
/// pulled onto its call codec when the Mac's own microphone can listen
/// instead — and is left alone when a shut lid would muffle that microphone.
///
/// One line per state: `input transport=<built-in|bluetooth|other|none>
/// lid=<open|shut|unknown> builtin=<name>` — emitted once on start, on every
/// default-input change, and in answer to `probe` on stdin. The app probes at
/// each press because a lid can close without any device changing. The
/// `builtin` token is omitted on a machine with no built-in microphone, and it
/// is always the line's tail, so the name may contain anything.
private let MICROPHONE_ROUTE_COMMAND = "probe"

private let TRANSPORT_WORD = (
    builtIn: "built-in",
    bluetooth: "bluetooth",
    other: "other",
    none: "none"
)

private let LID_WORD = (open: "open", shut: "shut", unknown: "unknown")

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

private func readDefaultInputDevice() -> AudioObjectID? {
    var query = address(kAudioHardwarePropertyDefaultInputDevice)
    var device = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    let status = AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &query, 0, nil, &size, &device
    )
    guard status == noErr, device != kAudioObjectUnknown else { return nil }
    return device
}

private func transportType(of device: AudioObjectID) -> UInt32? {
    var query = address(kAudioDevicePropertyTransportType)
    guard AudioObjectHasProperty(device, &query) else { return nil }
    var transport = UInt32(0)
    var size = UInt32(MemoryLayout<UInt32>.size)
    guard AudioObjectGetPropertyData(device, &query, 0, nil, &size, &transport) == noErr else {
        return nil
    }
    return transport
}

private func transportWord(of device: AudioObjectID) -> String {
    switch transportType(of: device) {
    case kAudioDeviceTransportTypeBuiltIn:
        return TRANSPORT_WORD.builtIn
    case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE:
        return TRANSPORT_WORD.bluetooth
    default:
        return TRANSPORT_WORD.other
    }
}

/// Whether the device can capture at all: a built-in device list holds
/// speakers too, and the microphone is the one with input streams.
private func hasInputStreams(_ device: AudioObjectID) -> Bool {
    var query = address(kAudioDevicePropertyStreams, scope: kAudioDevicePropertyScopeInput)
    var size = UInt32(0)
    guard AudioObjectGetPropertyDataSize(device, &query, 0, nil, &size) == noErr else {
        return false
    }
    return size > 0
}

private func name(of device: AudioObjectID) -> String? {
    var query = address(kAudioObjectPropertyName)
    guard AudioObjectHasProperty(device, &query) else { return nil }
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    let status = withUnsafeMutablePointer(to: &value) { pointer in
        AudioObjectGetPropertyData(device, &query, 0, nil, &size, pointer)
    }
    guard status == noErr, let value else { return nil }
    return value.takeRetainedValue() as String
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

private func builtInInputDevice() -> AudioObjectID? {
    allDevices().first { device in
        transportType(of: device) == kAudioDeviceTransportTypeBuiltIn && hasInputStreams(device)
    }
}

/// The lid, read from the power domain's own record of it. A machine that
/// keeps no such record — a desktop — answers `unknown`, which the reader
/// treats as open: an iMac's microphone has no lid to be shut under.
private func lidWord() -> String {
    let service = IOServiceGetMatchingService(
        kIOMainPortDefault, IOServiceMatching("IOPMrootDomain")
    )
    guard service != 0 else { return LID_WORD.unknown }
    defer { IOObjectRelease(service) }
    guard
        let value = IORegistryEntryCreateCFProperty(
            service, "AppleClamshellState" as CFString, kCFAllocatorDefault, 0
        )?.takeRetainedValue()
    else { return LID_WORD.unknown }
    guard let shut = value as? Bool else { return LID_WORD.unknown }
    return shut ? LID_WORD.shut : LID_WORD.open
}

@main
@MainActor
private struct MicrophoneRouteCommand {
    static var buffer = ""

    static func main() {
        var defaultInput = address(kAudioHardwarePropertyDefaultInputDevice)
        // AirPods connecting, a USB interface unplugged: the answer follows
        // whichever device the system would hand a capture to next.
        AudioObjectAddPropertyListenerBlock(
            AudioObjectID(kAudioObjectSystemObject), &defaultInput, DispatchQueue.main
        ) { _, _ in
            MainActor.assumeIsolated { report() }
        }
        FileHandle.standardInput.readabilityHandler = { handle in
            let data = handle.availableData
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    // Stdin closing is the app going away; there is nothing to
                    // restore, because nothing was ever changed.
                    if data.isEmpty {
                        FileHandle.standardInput.readabilityHandler = nil
                        exit(0)
                    }
                    read(data)
                }
            }
        }
        report()
        dispatchMain()
    }

    static func read(_ data: Data) {
        buffer += String(decoding: data, as: UTF8.self)
        var lines = buffer.components(separatedBy: "\n")
        // Whatever follows the last newline is the start of a line still
        // arriving, exactly as the media duck's reader holds it.
        buffer = lines.removeLast()
        for line in lines
        where line.trimmingCharacters(in: .whitespaces) == MICROPHONE_ROUTE_COMMAND {
            report()
        }
    }

    static func report() {
        let transport = readDefaultInputDevice().map { transportWord(of: $0) }
        var line = "input transport=\(transport ?? TRANSPORT_WORD.none) lid=\(lidWord())"
        if let builtIn = builtInInputDevice(), let builtInName = name(of: builtIn) {
            line += " builtin=\(builtInName)"
        }
        emit(line)
    }
}
