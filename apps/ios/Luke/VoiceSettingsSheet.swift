import LukeKit
import SwiftUI

/// The voice settings the desktop's Voice page offers that reach this
/// device's own conversation: the voice Luke speaks with and how fast. In the
/// system's own sheet vocabulary like the Filter & Sort sheet — inline title,
/// toolbar Done, grouped form — and presented at a half height that expands.
/// The Mac-only rows (the microphone choice, quieting Music and Spotify,
/// pausing announcements, captions) are about a machine this app does not
/// run on, so they are not drawn rather than drawn disabled. The two values
/// live in UserDefaults under keys the voice screen reads too, so a change
/// here is heard there: the voice at once, by a fresh connection, and the
/// speed from the next reply on.
struct VoiceSettingsSheet: View {
    @AppStorage(VoiceSettingsKey.voice) private var voice = RealtimeVoice.default
    @AppStorage(VoiceSettingsKey.speed) private var speed = RealtimeVoiceSpeed.default
    @Environment(ProductEventSender.self) private var events
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Voice", selection: $voice) {
                        ForEach(RealtimeVoice.allCases) { candidate in
                            Text(candidate.displayName).tag(candidate)
                        }
                    }
                } footer: {
                    Text("A change is heard right away; a conversation under way starts afresh in the new voice.")
                }

                Section {
                    Picker("Speed", selection: $speed) {
                        ForEach(RealtimeVoiceSpeed.allCases) { candidate in
                            Text(candidate.displayName).tag(candidate)
                        }
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text("Speed")
                } footer: {
                    Text(speedFooter)
                }

                if isChanged {
                    Section {
                        Button("Reset to Defaults") { resetToDefaults() }
                            .frame(maxWidth: .infinity)
                            .tint(Color.ink)
                    }
                }
            }
            .animation(.default, value: isChanged)
            .navigationTitle("Voice Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .tint(Color.ink)
                }
            }
        }
        .onChange(of: voice) { events.record(.settingUpdate(setting: .voice, value: .set)) }
        .onChange(of: speed) { events.record(.settingUpdate(setting: .voiceSpeed, value: .set)) }
    }

    private var isChanged: Bool {
        voice != RealtimeVoice.default || speed != RealtimeVoiceSpeed.default
    }

    /// The chosen pace as a multiple of the voice's natural rate, so the
    /// segment's one word is explained in the footer beneath it.
    private var speedFooter: String {
        let rate = speed == .normal
            ? "The voice's natural rate."
            : "\(speed.multipleLabel) the voice's natural rate."
        return "\(rate) A change is heard from the next reply on."
    }

    private func resetToDefaults() {
        voice = RealtimeVoice.default
        speed = RealtimeVoiceSpeed.default
        events.record(.settingsReset)
    }
}
