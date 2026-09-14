import LukeKit
import SwiftUI

/// The desktop's voice settings that apply on this device: the voice, chosen
/// from every voice a Live session speaks, and a reset. The Mac-only rows
/// (microphone choice, media ducking, announcements, captions) are not drawn,
/// and the Live model has no speed, so no slider stands where the Realtime
/// pace once did.
struct VoiceSettingsSheet: View {
    @AppStorage(VoiceSettingsKey.voice) private var voice = LiveVoice.default
    @Environment(ProductEventSender.self) private var events
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Voice", selection: voiceChoice) {
                        ForEach(LiveVoice.allCases) { candidate in
                            Text(candidate.displayName).tag(candidate)
                        }
                    }
                } footer: {
                    Text("A conversation under way ends; the next press opens one in the new voice.")
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
    }

    private var isChanged: Bool {
        voice != LiveVoice.default
    }

    // Each control counts its own change so a reset counts once, as a reset.

    private var voiceChoice: Binding<LiveVoice> {
        Binding(
            get: { voice },
            set: { chosen in
                guard chosen != voice else { return }
                voice = chosen
                events.record(.settingUpdate(setting: .voice, value: .set))
            }
        )
    }

    private func resetToDefaults() {
        voice = LiveVoice.default
        events.record(.settingsReset)
    }
}
