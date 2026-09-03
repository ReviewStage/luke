import LukeKit
import SwiftUI

/// The desktop's voice settings that apply on this device. The Mac-only rows
/// (microphone choice, media ducking, announcements, captions) are not drawn.
/// Under them, a debug section lists every tool the desktop's conversation
/// carries and why Luke cannot be asked for one here right now, read from
/// the current call and the observed roster.
struct VoiceSettingsSheet: View {
    let toolReport: VoiceToolReport

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

                Section {
                    ForEach(toolReport.standings) { standing in
                        toolRow(standing)
                    }
                } header: {
                    Text("Debug")
                } footer: {
                    Text(
                        toolReport.mintedKnown
                            ? "Every tool Luke can be asked for on the Mac, and why one is not available here right now. Read from the current call's minted tools and the observed sessions."
                            : "Every tool Luke can be asked for on the Mac, and why one is not available here right now. Which tools the service minted is known once a call connects."
                    )
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

    /// One tool: its name as the model calls it, what it does or why it is
    /// not available, and a mark for which of the two the second line is.
    private func toolRow(_ standing: VoiceToolStanding) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(standing.name)
                    .font(.subheadline.monospaced())
                    .foregroundStyle(Color.ink)
                Text(standing.unavailableReason ?? standing.summary)
                    .font(.footnote)
                    .foregroundStyle(Color.inkSecondary)
            }
            Spacer(minLength: 0)
            Image(systemName: standing.isAvailable ? "checkmark.circle.fill" : "minus.circle")
                .foregroundStyle(standing.isAvailable ? Color.stateComplete : Color.inkTertiary)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(standing.isAvailable ? "Available" : "Not available")
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
