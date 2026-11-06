import CoreAudio
import Foundation
import IOKit

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
        AudioObjectAddPropertyListenerBlock(
            AudioObjectID(kAudioObjectSystemObject), &defaultInput, DispatchQueue.main
        ) { _, _ in
            MainActor.assumeIsolated { report() }
        }
        FileHandle.standardInput.readabilityHandler = { handle in
            let data = handle.availableData
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
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
