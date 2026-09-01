import LukeKit
import SwiftUI

/// The Send Message sheet, in the system's own sheet vocabulary like the
/// vault key editor and the workspace creator: inline title, toolbar Cancel
/// and Send, grouped form, with the session's recap under the field so the
/// reply is written against where the turn actually stands. The server
/// re-observes the session before the write lands, so a refusal comes back
/// with the provider's own reason and nothing is retried on its behalf.
struct SessionComposerSheet: View {
    let session: RosterSession
    let actClient: ActClient
    /// Called on Cancel and after a successful send, so the presenter closes.
    let onDone: () -> Void

    @Environment(AccountSession.self) private var account
    @State private var text = ""
    @State private var sending = false
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Message", text: $text, axis: .vertical)
                        .lineLimit(5 ... 12)
                } footer: {
                    if let recap = session.recap {
                        Text(recap)
                    }
                }
            }
            .disabled(sending)
            .navigationTitle(session.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onDone)
                        .disabled(sending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if sending {
                        ProgressView()
                    } else {
                        Button("Send") { send() }
                            .disabled(!canSend)
                    }
                }
            }
        }
        .interactiveDismissDisabled(sending)
        .alert(
            "Not Delivered",
            isPresented: Binding(presence: $failure),
            presenting: failure
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { reason in
            Text(reason)
        }
    }

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func send() {
        guard canSend else { return }
        let messageText = text
        sending = true
        failure = nil
        Task {
            defer { sending = false }
            do {
                let answer = try await account.authorized { token in
                    try await actClient.sendMessage(
                        accessToken: token,
                        providerId: session.providerId,
                        providerSessionId: session.sessionId,
                        text: messageText
                    )
                }
                if answer.result == .accepted {
                    onDone()
                } else {
                    failure = answer.reason ?? "The message was not delivered."
                }
            } catch is AccountSessionError {
                ()  // Signed out — the state change redraws automatically.
            } catch {
                failure = error.localizedDescription
            }
        }
    }
}
