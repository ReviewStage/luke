import LukeKit
import PostHog
import SwiftUI

/// One message the developer sent from this screen, held in memory alone for
/// the app run — the user's own words, never written to disk, drawn as the
/// sent bubble a chat says "delivered" with instead of a banner.
struct OutgoingMessage: Identifiable, Equatable {
    enum Delivery: Equatable {
        case sending
        case sent
        case failed(reason: String)
    }

    let id = UUID()
    let text: String
    var delivery: Delivery
}

/// The session's own screen: the title at the top, the provider's word on
/// where the turn stands as the agent's bubble, the developer's sends as
/// their own bubbles, and a chat input at the bottom where — and only where —
/// the latest observation advertised taking a message. The thread never
/// pretends to be the transcript: a cloud session's conversation lives with
/// its provider, so the agent's side is the bounded recap the roster already
/// carries, and the sent bubbles live in memory for the app run alone.
struct SessionDetailView: View {
    let session: RosterSession
    let actClient: ActClient
    @Binding var thread: [OutgoingMessage]
    /// Runs after a delivered send so the roster refreshes behind this screen.
    let onDelivered: () async -> Void

    @Environment(AccountSession.self) private var account
    @Environment(ProductEventSender.self) private var events
    @State private var text = ""
    @FocusState private var composing: Bool

    var body: some View {
        // Top-anchored like a short Messages thread; a send scrolls to its
        // own bubble instead of re-anchoring the whole thread, which would
        // drop short content to the screen's bottom edge.
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 14) {
                    metaHeader
                    if let words = session.error ?? session.recap {
                        agentBubble(words, isError: session.error != nil)
                    }
                    ForEach(thread) { message in
                        userBubble(message)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .onChange(of: thread.count) {
                guard let last = thread.last else { return }
                withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
            }
            // The keyboard rising must not cover the newest bubble: focus
            // scrolls back to it once the inset settles, like Messages.
            .onChange(of: composing) {
                guard composing, let last = thread.last else { return }
                withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
            }
            .onAppear {
                if let last = thread.last {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color.ground.ignoresSafeArea())
        .navigationTitle(session.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // The bar wears the same mark the session's row does, beside the
            // title — the way Messages puts who the chat is with in the bar.
            ToolbarItem(placement: .principal) {
                HStack(spacing: 8) {
                    RosterProviderMark(providerId: session.providerId)
                        .scaleEffect(24.0 / 30.0)
                        .frame(width: 24, height: 24)
                    Text(session.title)
                        .font(.headline)
                        .foregroundStyle(Color.ink)
                        .lineLimit(1)
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { inputBar }
    }

    /// The chat's own centered caption slot, where iMessage puts a timestamp:
    /// the place the session runs. The provider now stands in the bar itself.
    private var metaHeader: some View {
        Group {
            if let workspace = session.workspace {
                Text(session.branch.map { "\(workspace) · \($0)" } ?? workspace)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Color.inkTertiary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.bottom, 4)
    }

    private func agentBubble(_ words: String, isError: Bool) -> some View {
        HStack {
            Text(words)
                .font(.system(size: 15))
                .foregroundStyle(isError ? Color.errorInk : Color.ink)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Color.cardFill, in: RoundedRectangle(cornerRadius: 18))
            Spacer(minLength: 48)
        }
    }

    private func userBubble(_ message: OutgoingMessage) -> some View {
        HStack {
            Spacer(minLength: 48)
            VStack(alignment: .trailing, spacing: 3) {
                // Masked from the session recording: the bubble is the words
                // the developer just typed, and a field's masking would be
                // hollow if the same words traveled the moment they were
                // drawn back. The recap bubble stays visible — it already
                // travels on the roster rows the recording shows.
                Text(message.text)
                    .postHogMask()
                    .font(.system(size: 15))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 18))
                    .opacity(message.delivery == .sending ? 0.55 : 1)
                if case .failed(let reason) = message.delivery {
                    Text("Not Delivered — \(reason)")
                        .font(.caption2)
                        .foregroundStyle(Color.errorInk)
                        .multilineTextAlignment(.trailing)
                }
            }
        }
    }

    /// The input takes iMessage's own anatomy where a message is advertised —
    /// body-size text in a capsule, the send button inscribed at its trailing
    /// edge, popping in only once there is something to send. On systems that
    /// draw Liquid Glass the capsule is the system's own glass floating over
    /// the bubbles scrolling beneath; earlier systems keep an opaque bar on
    /// the chat's own ground. Where no message is advertised, the honest
    /// absence is said quietly instead of drawing a field that could only
    /// refuse.
    @ViewBuilder
    private var inputBar: some View {
        if session.canReceiveMessage {
            if #available(iOS 26.0, *) {
                composerField
                    .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
            } else {
                composerField
                    .background(
                        RoundedRectangle(cornerRadius: 22)
                            .fill(Color.cardFill)
                            .strokeBorder(Color.controlStroke, lineWidth: 1)
                    )
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    // Without glass to float on, the bar stands on the chat's
                    // own ground — a system material would resolve near-white
                    // over it in light mode.
                    .background(Color.ground)
            }
        } else {
            Text("This session isn't accepting messages right now.")
                .font(.footnote)
                .foregroundStyle(Color.inkTertiary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(Color.ground)
        }
    }

    private var composerField: some View {
        TextField("Message", text: $text, axis: .vertical)
            .focused($composing)
            .lineLimit(1 ... 5)
            .font(.body)
            .foregroundStyle(Color.ink)
            .padding(.leading, 14)
            .padding(.trailing, 42)
            .padding(.vertical, 9)
            .overlay(alignment: .bottomTrailing) {
                if canSend {
                    Button(action: send) {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 30, height: 30)
                            .background(Color.accentColor, in: Circle())
                    }
                    .padding(5)
                    .transition(.scale.combined(with: .opacity))
                }
            }
            .animation(.spring(duration: 0.25), value: canSend)
    }

    private var canSend: Bool {
        text.contains { !$0.isWhitespace }
    }

    private func send() {
        guard canSend else { return }
        let message = OutgoingMessage(
            text: text.trimmingCharacters(in: .whitespacesAndNewlines),
            delivery: .sending
        )
        withAnimation { thread.append(message) }
        text = ""
        Task {
            var delivery: OutgoingMessage.Delivery
            do {
                let answer = try await account.authorized { token in
                    try await actClient.sendMessage(
                        accessToken: token,
                        providerId: session.providerId,
                        providerSessionId: session.sessionId,
                        text: message.text
                    )
                }
                if answer.result == .accepted {
                    delivery = .sent
                    if let provider = ProductProviderID(rawValue: session.providerId) {
                        events.record(.sessionActSend(provider: provider, act: .messageSend))
                    }
                } else {
                    delivery = .failed(reason: answer.reason ?? "The message was not delivered.")
                }
            } catch is AccountSessionError {
                delivery = .failed(reason: "Signed out.")
            } catch {
                delivery = .failed(reason: error.localizedDescription)
            }
            if let index = thread.firstIndex(where: { $0.id == message.id }) {
                thread[index].delivery = delivery
            }
            if delivery == .sent { await onDelivered() }
        }
    }
}
