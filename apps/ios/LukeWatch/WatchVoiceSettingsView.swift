import LukeKit
import SwiftUI

/// The watch's copy of the voice settings the phone draws: the voice used for
/// the next mint, the speed heard from the next reply, and the debug tool list
/// read from the current watch call and roster.
struct WatchVoiceSettingsView: View {
    let toolReport: VoiceToolReport

    @AppStorage(VoiceSettingsKey.voice) private var voice = RealtimeVoice.default
    @AppStorage(VoiceSettingsKey.speed) private var speed = RealtimeVoiceSpeed.default
    @Environment(ProductEventSender.self) private var events

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Voice", selection: voiceChoice) {
                        ForEach(RealtimeVoice.allCases) { candidate in
                            Text(candidate.displayName).tag(candidate)
                        }
                    }
                }

                Section {
                    Picker("Speed", selection: speedChoice) {
                        ForEach(RealtimeVoiceSpeed.allCases) { candidate in
                            Text(candidate.multipleLabel).tag(candidate)
                        }
                    }
                }

                if isChanged {
                    Section {
                        Button("Reset to Defaults") { resetToDefaults() }
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
                            ? "Every tool Luke can be asked for on the Mac, and why one is not available here right now."
                            : "Which tools the service minted is known once a call connects."
                    )
                }
            }
            .animation(.default, value: isChanged)
            .navigationTitle("Voice Settings")
        }
    }

    private var isChanged: Bool {
        voice != RealtimeVoice.default || speed != RealtimeVoiceSpeed.default
    }

    private func toolRow(_ standing: VoiceToolStanding) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(standing.name)
                    .font(.caption2.monospaced())
                Text(standing.unavailableReason ?? standing.summary)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Image(systemName: standing.isAvailable ? "checkmark.circle.fill" : "minus.circle")
                .foregroundStyle(standing.isAvailable ? Color.green : Color.secondary)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(standing.isAvailable ? "Available" : "Not available")
    }

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

    private var speedChoice: Binding<RealtimeVoiceSpeed> {
        Binding(
            get: { speed },
            set: { chosen in
                guard chosen != speed else { return }
                speed = chosen
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
