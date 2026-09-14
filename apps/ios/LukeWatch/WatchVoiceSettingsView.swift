import LukeKit
import SwiftUI

/// The watch's copy of the voice settings the phone draws: the voice the next
/// session is created in, chosen from every Live voice, and a reset. The Live
/// model has no speed, and the service's tools are not the watch's to list.
struct WatchVoiceSettingsView: View {
    @AppStorage(VoiceSettingsKey.voice) private var voice = LiveVoice.default
    @Environment(ProductEventSender.self) private var events

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Voice", selection: voiceChoice) {
                        ForEach(LiveVoice.allCases) { candidate in
                            Text(candidate.displayName).tag(candidate)
                        }
                    }
                }

                if isChanged {
                    Section {
                        Button("Reset to Defaults") { resetToDefaults() }
                    }
                }
            }
            .animation(.default, value: isChanged)
            .navigationTitle("Voice Settings")
        }
    }

    private var isChanged: Bool {
        voice != LiveVoice.default
    }

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
