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
/// speed from the next reply on. The speed is a slider over the vocabulary's
/// four multiples, labelled in numbers, stepping so it lands on nothing between.
struct VoiceSettingsSheet: View {
    @AppStorage(VoiceSettingsKey.voice) private var voice = RealtimeVoice.default
    @AppStorage(VoiceSettingsKey.speed) private var speed = RealtimeVoiceSpeed.default
    @Environment(ProductEventSender.self) private var events
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Voice", selection: voiceChoice) {
                        ForEach(RealtimeVoice.allCases) { candidate in
                            Text(candidate.displayName).tag(candidate)
                        }
                    }
                } footer: {
                    Text("A change is heard right away; a conversation under way starts afresh in the new voice.")
                }

                Section {
                    LabeledContent("Speed", value: speed.multipleLabel)
                    Slider(
                        value: speedMultiplier,
                        in: RealtimeVoiceSpeed.multiplierRange,
                        step: RealtimeVoiceSpeed.multiplierStep
                    ) {
                        Text("Speed")
                    } minimumValueLabel: {
                        Text(RealtimeVoiceSpeed.slow.multipleLabel)
                    } maximumValueLabel: {
                        Text(RealtimeVoiceSpeed.fast.multipleLabel)
                    }
                    .font(.footnote)
                    .foregroundStyle(Color.inkSecondary)
                    .accessibilityValue(speed.multipleLabel)
                } footer: {
                    Text("Times the voice's natural rate. A change is heard from the next reply on.")
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
        voice != RealtimeVoice.default || speed != RealtimeVoiceSpeed.default
    }

    // Each control counts its own change, so a reset counts once as a reset
    // rather than once more per field it moved, the way the desktop counts.

    private var voiceChoice: Binding<RealtimeVoice> {
        Binding(
            get: { voice },
            set: { chosen in
                guard chosen != voice else { return }
                voice = chosen
                events.record(.settingUpdate(setting: .voice, value: .set))
            }
        )
    }

    /// The slider's steps are the vocabulary's multiples and nothing between,
    /// so every value it can settle on reads back as a speed; one that does
    /// not is left unstored rather than sent for the mint to refuse.
    private var speedMultiplier: Binding<Double> {
        Binding(
            get: { speed.multiplier },
            set: { value in
                guard let step = RealtimeVoiceSpeed(multiplier: value), step != speed else { return }
                speed = step
                events.record(.settingUpdate(setting: .voiceSpeed, value: .set))
            }
        )
    }

    private func resetToDefaults() {
        voice = RealtimeVoice.default
        speed = RealtimeVoiceSpeed.default
        events.record(.settingsReset)
    }
}
