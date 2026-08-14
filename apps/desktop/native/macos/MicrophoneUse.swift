import AppKit
import CoreAudio
import Foundation

/// Reports which apps are listening through the microphone, and says so again
/// whenever that set changes.
///
/// This is the signal behind the orange dot macOS draws in Control Centre, read
/// the documented way: CoreAudio's process objects, each asked whether it is
/// running input. Public API, no entitlement, and no consent prompt of its own
/// — it asks which processes hold the device, never for a sample of what they
/// hear, so nothing here can learn who is on the call or what is being said.
///
/// Naming them is what the ignore list is built on, and it is the whole reason
/// this went past a boolean: a developer whose dictation app trips the hold all
/// day needs to be able to say "not that one", and a hold with no way to say so
/// is a hold that gets switched off.
///
/// Luke opens the same device himself for the length of a conversation, not
/// just a turn, so his own processes are dropped here by bundle identifier —
/// the prefixes arrive on argv, because a packaged Luke and an unpackaged
/// Electron answer to different ones.
private struct CallApp {
    let id: String
    let name: String
}

/// Faster than the Focus watcher's backstop was, because this one is load
/// bearing: a prompt the developer has seconds to answer cannot wait five of
/// them to appear. The reads are a handful of properties, so a second is cheap
/// — and the listeners below are known not to fire reliably for the input
/// properties, which is why the poll is the spine rather than the fallback.
private let POLL_SECONDS = 1.0

private func emit(_ line: String) {
    guard let payload = "\(line)\n".data(using: .utf8) else { return }
    FileHandle.standardOutput.write(payload)
}

/// Says why, on the channel that is not the protocol — the same bargain the
/// other helpers strike. It earns the channel because everything this reads is
/// invisible from outside: "nobody is on a call" and "this build cannot see
/// processes at all" are the same empty list otherwise.
private func diagnose(_ line: String) {
    guard let payload = "microphone-use: \(line)\n".data(using: .utf8) else { return }
    FileHandle.standardError.write(payload)
}

private func propertyAddress(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
}

private func defaultInputDevice() -> AudioObjectID? {
    var query = propertyAddress(kAudioHardwarePropertyDefaultInputDevice)
    var device = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    let status = AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &query, 0, nil, &size, &device
    )
    guard status == noErr, device != kAudioObjectUnknown else { return nil }
    return device
}

/// Whether the device the next app would open is running at all. Kept beside
/// the per-process reading rather than replaced by it: a device that is running
/// while no process can be named is the one case that must not read as "nobody
/// is on a call", and only this can see it.
private func deviceIsRunning() -> Bool? {
    guard let device = defaultInputDevice() else { return nil }
    var query = propertyAddress(kAudioDevicePropertyDeviceIsRunningSomewhere)
    guard AudioObjectHasProperty(device, &query) else { return nil }
    var running = UInt32(0)
    var size = UInt32(MemoryLayout<UInt32>.size)
    guard AudioObjectGetPropertyData(device, &query, 0, nil, &size, &running) == noErr else {
        return nil
    }
    return running != 0
}

private func audioProcessObjects() -> [AudioObjectID]? {
    var query = propertyAddress(kAudioHardwarePropertyProcessObjectList)
    guard AudioObjectHasProperty(AudioObjectID(kAudioObjectSystemObject), &query) else {
        return nil
    }
    var size = UInt32(0)
    guard
        AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject), &query, 0, nil, &size
        ) == noErr
    else {
        return nil
    }
    let count = Int(size) / MemoryLayout<AudioObjectID>.size
    guard count > 0 else { return [] }
    var objects = [AudioObjectID](repeating: AudioObjectID(kAudioObjectUnknown), count: count)
    guard
        AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &query, 0, nil, &size, &objects
        ) == noErr
    else {
        return nil
    }
    return objects
}

private func isRunningInput(_ process: AudioObjectID) -> Bool {
    var query = propertyAddress(kAudioProcessPropertyIsRunningInput)
    guard AudioObjectHasProperty(process, &query) else { return false }
    var running = UInt32(0)
    var size = UInt32(MemoryLayout<UInt32>.size)
    guard AudioObjectGetPropertyData(process, &query, 0, nil, &size, &running) == noErr else {
        return false
    }
    return running != 0
}

private func processIdentifier(_ process: AudioObjectID) -> pid_t? {
    var query = propertyAddress(kAudioProcessPropertyPID)
    guard AudioObjectHasProperty(process, &query) else { return nil }
    var pid = pid_t(-1)
    var size = UInt32(MemoryLayout<pid_t>.size)
    guard AudioObjectGetPropertyData(process, &query, 0, nil, &size, &pid) == noErr else {
        return nil
    }
    return pid > 0 ? pid : nil
}

private func bundleIdentifier(_ process: AudioObjectID) -> String? {
    var query = propertyAddress(kAudioProcessPropertyBundleID)
    guard AudioObjectHasProperty(process, &query) else { return nil }
    var size = UInt32(MemoryLayout<CFString?>.size)
    var value: CFString?
    let status = withUnsafeMutablePointer(to: &value) {
        AudioObjectGetPropertyData(process, &query, 0, nil, &size, $0)
    }
    guard status == noErr, let value else { return nil }
    let identifier = value as String
    return identifier.isEmpty ? nil : identifier
}

/// Names one process, or refuses to.
///
/// A process with no bundle identifier is dropped rather than reported under
/// its pid: the identifier is what an ignore list is keyed by, and an entry
/// keyed by a number that changes every launch would be an entry the developer
/// could never usefully have made. In practice that filter is also what keeps
/// the system's own audio processes off the list.
private func callApp(for process: AudioObjectID, ignoring prefixes: [String]) -> CallApp? {
    guard isRunningInput(process) else { return nil }

    var identifier = bundleIdentifier(process)
    var displayName: String?
    // The running application is asked second and trusted first: it carries the
    // name a developer would recognise, where the audio process carries only
    // the identifier.
    if let pid = processIdentifier(process),
       let running = NSRunningApplication(processIdentifier: pid) {
        identifier = running.bundleIdentifier ?? identifier
        displayName = running.localizedName
    }

    guard let identifier, !identifier.isEmpty else { return nil }
    // Luke's own processes. An Electron app opens the device from a helper, so
    // this is a prefix test rather than an equality one.
    if prefixes.contains(where: { identifier == $0 || identifier.hasPrefix("\($0).") }) {
        return nil
    }
    return CallApp(id: identifier, name: displayName ?? identifier)
}

@main
@MainActor
private struct MicrophoneUseCommand {
    /// The last line said, so only changes are said again.
    static var reported: String?
    static var poll: DispatchSourceTimer?
    static var wired = Set<AudioObjectID>()
    static var prefixes: [String] = []
    static let queue = DispatchQueue.main

    static func main() {
        prefixes = Array(CommandLine.arguments.dropFirst())
        if prefixes.isEmpty {
            // Without them Luke's own conversation reads as a call the developer
            // just joined, for as long as it is connected.
            diagnose("no bundle prefixes given — Luke's own microphone use cannot be told apart")
        }

        // The process list changing is the one listener worth having: the
        // per-process input properties are documented to fire unreliably, which
        // is what the poll below is for.
        var processList = propertyAddress(kAudioHardwarePropertyProcessObjectList)
        AudioObjectAddPropertyListenerBlock(
            AudioObjectID(kAudioObjectSystemObject), &processList, queue
        ) { _, _ in
            MainActor.assumeIsolated { report() }
        }

        report()

        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + POLL_SECONDS, repeating: POLL_SECONDS)
        timer.setEventHandler {
            MainActor.assumeIsolated { report() }
        }
        poll = timer
        timer.resume()

        dispatchMain()
    }

    /// Says the answer, but only when it is news, so the app upstream reads one
    /// line per change and nothing else.
    ///
    /// The line is JSON rather than a word because it carries a set of names,
    /// and a name is the developer's own text: an app called `Zoom | Work` must
    /// not be able to look like two fields.
    static func report() {
        let running = deviceIsRunning()
        let processes = audioProcessObjects()

        var payload: [String: Any] = [:]
        if running == nil, processes == nil {
            payload = ["unavailable": true]
        } else {
            var apps: [CallApp] = []
            for process in processes ?? [] {
                guard let app = callApp(for: process, ignoring: prefixes) else { continue }
                if apps.contains(where: { $0.id == app.id }) { continue }
                apps.append(app)
                wire(process)
            }
            apps.sort { $0.id < $1.id }
            payload = [
                "running": running ?? !apps.isEmpty,
                "apps": apps.map { ["id": $0.id, "name": $0.name] },
            ]
        }

        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let line = String(data: data, encoding: .utf8)
        else {
            return
        }
        guard line != reported else { return }
        reported = line
        diagnose(line)
        emit(line)
    }

    /// Wires a process the first time it is seen, so a call ending is noticed
    /// before the next poll. Listeners are never taken off — every one of them
    /// ends in the same full read, so a stale one costs a property read.
    static func wire(_ process: AudioObjectID) {
        guard !wired.contains(process) else { return }
        var query = propertyAddress(kAudioProcessPropertyIsRunningInput)
        guard AudioObjectHasProperty(process, &query) else { return }
        wired.insert(process)
        AudioObjectAddPropertyListenerBlock(process, &query, queue) { _, _ in
            MainActor.assumeIsolated { report() }
        }
    }
}
