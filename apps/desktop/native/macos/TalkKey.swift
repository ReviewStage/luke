import AppKit
import Carbon.HIToolbox
import Foundation

/// Reports the talk key being held down and let go of, from wherever the user
/// happens to be working.
///
/// `RegisterEventHotKey` is the reason this exists. It is the one way to learn
/// about a key from another app without asking for Accessibility or Input
/// Monitoring: the system is told the single chord to watch for and reports
/// nothing else, so this process never sees another keystroke and cannot. An
/// event tap would have given the same two edges and everything else the user
/// ever types along with them, which is not a trade Luke may make.
///
/// Electron registers hot keys through the same API but surfaces only the
/// press, which is why the release has to come from here. A held key is what
/// makes a turn feel like a walkie-talkie rather than a switch.
private enum TalkKey {
    /// The chords a talk key may be. Deliberately small: this maps the
    /// accelerators the app already names, and nothing it does not.
    static let keyCodes: [String: UInt32] = [
        "space": UInt32(kVK_Space),
        "a": UInt32(kVK_ANSI_A), "b": UInt32(kVK_ANSI_B), "c": UInt32(kVK_ANSI_C),
        "d": UInt32(kVK_ANSI_D), "e": UInt32(kVK_ANSI_E), "f": UInt32(kVK_ANSI_F),
        "g": UInt32(kVK_ANSI_G), "h": UInt32(kVK_ANSI_H), "i": UInt32(kVK_ANSI_I),
        "j": UInt32(kVK_ANSI_J), "k": UInt32(kVK_ANSI_K), "l": UInt32(kVK_ANSI_L),
        "m": UInt32(kVK_ANSI_M), "n": UInt32(kVK_ANSI_N), "o": UInt32(kVK_ANSI_O),
        "p": UInt32(kVK_ANSI_P), "q": UInt32(kVK_ANSI_Q), "r": UInt32(kVK_ANSI_R),
        "s": UInt32(kVK_ANSI_S), "t": UInt32(kVK_ANSI_T), "u": UInt32(kVK_ANSI_U),
        "v": UInt32(kVK_ANSI_V), "w": UInt32(kVK_ANSI_W), "x": UInt32(kVK_ANSI_X),
        "y": UInt32(kVK_ANSI_Y), "z": UInt32(kVK_ANSI_Z),
    ]

    static let modifiers: [String: UInt32] = [
        "alt": UInt32(optionKey),
        "option": UInt32(optionKey),
        "shift": UInt32(shiftKey),
        "control": UInt32(controlKey),
        "ctrl": UInt32(controlKey),
        "command": UInt32(cmdKey),
        "commandorcontrol": UInt32(cmdKey),
    ]

    /// Reads an Electron accelerator such as `Alt+Space`. A chord this does not
    /// know is refused rather than guessed at, so the app can move on to the
    /// next candidate instead of registering something the user was never told
    /// about.
    static func parse(accelerator: String) -> (keyCode: UInt32, modifiers: UInt32)? {
        var mask: UInt32 = 0
        var keyCode: UInt32?
        for part in accelerator.split(separator: "+") {
            let name = part.lowercased()
            if let modifier = modifiers[name] {
                mask |= modifier
                continue
            }
            // A second key in one chord is not a chord this can register.
            guard keyCode == nil, let code = keyCodes[name] else { return nil }
            keyCode = code
        }
        // Carbon hot keys are a key plus modifiers. A bare modifier — holding
        // Control-Option alone — cannot be registered this way at all, and the
        // only APIs that can see one want Accessibility.
        guard let keyCode, mask != 0 else { return nil }
        return (keyCode, mask)
    }
}

private func emit(_ line: String) {
    guard let payload = "\(line)\n".data(using: .utf8) else { return }
    FileHandle.standardOutput.write(payload)
}

@main
@MainActor
private struct TalkKeyCommand {
    static func main() {
        // A background app rather than a command-line tool: hot keys are
        // delivered to a process the window server knows about. `.prohibited`
        // keeps it out of the Dock and menu bar, so this helper adds no icon.
        let application = NSApplication.shared
        application.setActivationPolicy(.prohibited)

        let candidates = Array(CommandLine.arguments.dropFirst())
        guard !candidates.isEmpty else {
            emit("unavailable no-accelerator-given")
            exit(1)
        }

        var handler: EventHandlerRef?
        var eventTypes = [
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased)),
        ]
        let installed = InstallEventHandler(
            GetEventDispatcherTarget(),
            { _, event, _ -> OSStatus in
                var kind = UInt32(0)
                if let event { kind = GetEventKind(event) }
                // One line per edge, in the order the user produced them. The
                // reader turns a short press and a long one into different
                // things; this only reports what the key did.
                emit(kind == UInt32(kEventHotKeyPressed) ? "down" : "up")
                return noErr
            },
            eventTypes.count,
            &eventTypes,
            nil,
            &handler
        )
        guard installed == noErr else {
            emit("unavailable handler-refused")
            exit(1)
        }

        // One hot key is ever registered, so it is named once: 'LUKE', and the
        // first and only id under it.
        let identifier = EventHotKeyID(signature: OSType(0x4C55_4B45), id: 1)

        // Tried in order, exactly as the app lists them, so the fallback is the
        // app's choice rather than this helper's.
        var hotKey: EventHotKeyRef?
        var registered: String?
        for accelerator in candidates {
            guard let chord = TalkKey.parse(accelerator: accelerator) else { continue }
            let status = RegisterEventHotKey(
                chord.keyCode,
                chord.modifiers,
                identifier,
                GetEventDispatcherTarget(),
                0,
                &hotKey
            )
            if status == noErr {
                registered = accelerator
                break
            }
        }

        guard let registered else {
            // Every candidate refused: something else on this Mac owns them.
            emit("unavailable already-owned")
            exit(1)
        }

        emit("registered \(registered)")
        application.run()
    }
}
