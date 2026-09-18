import LukeKit
import SwiftUI

/// The account surface the top-left avatar opens, the phone's Profile sheet
/// on the wrist: the account's avatar and name, and the voice the next
/// session is created in, chosen from every Live voice and synced with the
/// phone. No sign-out, since the watch signs in and out with the phone; no
/// reset, and the Live model has no speed.
struct WatchAccountView: View {
    @AppStorage(VoiceSettingsKey.voice) private var voice = LiveVoice.default
    @Environment(ProductEventSender.self) private var events
    let identity: AccountIdentity

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 6) {
                        AccountAvatar(identity: identity, diameter: 44, http: WatchNetwork.session)
                        Text(identity.name ?? identity.email)
                            .font(.headline)
                            .multilineTextAlignment(.center)
                        if identity.name != nil {
                            Text(identity.email)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }

                Section {
                    Picker("Voice", selection: voiceChoice) {
                        ForEach(LiveVoice.allCases) { candidate in
                            Text(candidate.displayName).tag(candidate)
                        }
                    }
                }
            }
            .navigationTitle("Profile")
        }
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
}
