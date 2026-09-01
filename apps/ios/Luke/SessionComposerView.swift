import LukeKit
import SwiftUI

/// A text composer for sending a message to a cloud session that is accepting input.
///
/// Embed this view where the read path's roster surfaces a session with
/// `canReceiveMessage`. Pass the session's `providerId` and `providerSessionId`
/// from the observed roster row; the composer is not shown for sessions that
/// the server reports as unable to receive messages.
struct SessionComposerView: View {
    let providerId: String
    let providerSessionId: String
    let actClient: ActClient
    /// Called shortly after a successful send so a containing sheet can dismiss.
    var onDelivered: (() -> Void)? = nil

    @Environment(AccountSession.self) private var session
    @Environment(ProductEventSender.self) private var events
    @State private var text = ""
    @State private var state: ComposerState = .idle

    private enum ComposerState: Equatable {
        case idle
        case sending
        case result(ActMessageAnswer)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                TextField("Message", text: $text, axis: .vertical)
                    .lineLimit(3, reservesSpace: false)
                    .textFieldStyle(.plain)
                    .font(.system(size: 15))
                    .foregroundStyle(Color.ink)
                    .disabled(state == .sending)

                Button(action: send) {
                    if state == .sending {
                        ProgressView()
                            .tint(Color.ink)
                            .frame(width: 24, height: 24)
                    } else {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 24))
                            .foregroundStyle(canSend ? Color.ink : Color.inkTertiary)
                    }
                }
                .disabled(!canSend || state == .sending)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.cardFill)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(Color.controlStroke, lineWidth: 1)
                    )
            )

            if case .result(let answer) = state {
                resultBanner(answer)
            }
        }
        // Bound to the view's lifetime, unlike an unstructured Task: dismissing
        // the sheet cancels the wait, so a slow send from a closed composer can
        // never dismiss a sheet opened later for another session.
        .task(id: state) {
            guard case .result(let answer) = state, answer.result == .accepted,
                  let onDelivered else { return }
            try? await Task.sleep(for: .seconds(0.8))
            guard !Task.isCancelled else { return }
            onDelivered()
        }
    }

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func send() {
        guard canSend else { return }
        let messageText = text
        state = .sending
        text = ""
        Task {
            do {
                let token = try await session.validAccessToken()
                let answer: ActMessageAnswer
                do {
                    answer = try await actClient.sendMessage(
                        accessToken: token,
                        providerId: providerId,
                        providerSessionId: providerSessionId,
                        text: messageText
                    )
                } catch ActClientError.unauthorized {
                    // validAccessToken() refreshes near-expiry tokens; a 401
                    // here means the server rejected the token outright — refresh and retry once.
                    let fresh = try await session.refreshAccessToken()
                    answer = try await actClient.sendMessage(
                        accessToken: fresh,
                        providerId: providerId,
                        providerSessionId: providerSessionId,
                        text: messageText
                    )
                }
                if answer.result == .accepted,
                   let provider = ProductProviderID(rawValue: providerId)
                {
                    events.record(.sessionActSend(provider: provider, act: .messageSend))
                }
                state = .result(answer)
            } catch {
                state = .result(ActMessageAnswer(
                    result: .rejected,
                    reason: error.localizedDescription
                ))
            }
        }
    }

    @ViewBuilder
    private func resultBanner(_ answer: ActMessageAnswer) -> some View {
        HStack(spacing: 6) {
            Image(systemName: answer.result == .accepted ? "checkmark.circle" : "exclamationmark.circle")
                .font(.system(size: 13, weight: .semibold))
            Text(answer.result == .accepted ? "Sent" : (answer.reason ?? "Not delivered"))
                .font(.system(size: 13))
                .lineLimit(2)
        }
        .foregroundStyle(answer.result == .accepted ? Color.stateComplete : Color.errorInk)
        .padding(.horizontal, 10)
        .onTapGesture { state = .idle }
    }
}
