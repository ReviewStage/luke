import LukeKit
import SwiftUI

/// The desktop's voice settings that apply on this device. The Mac-only rows
/// (microphone choice, media ducking, announcements, captions) are not drawn.
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

    // Each control counts its own change so a reset counts once, as a reset.

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
