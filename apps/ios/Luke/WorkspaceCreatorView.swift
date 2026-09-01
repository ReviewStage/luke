import LukeKit
import SwiftUI

/// A form for creating a workspace in a cloud project.
///
/// Embed this view where the read path's roster surfaces a provider that
/// reports at least one project. Pass the `providerId` and `providerProjectId`
/// from the observed provider's project list.
struct WorkspaceCreatorView: View {
    let providerId: String
    let providerProjectId: String
    let actClient: ActClient

    @Environment(AccountSession.self) private var session
    @Environment(ProductEventSender.self) private var events
    @State private var name = ""
    @State private var task = ""
    @State private var state: CreatorState = .idle

    private enum CreatorState: Equatable {
        case idle
        case creating
        case result(ActWorkspaceAnswer)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(spacing: 8) {
                LabeledTextField(label: "Name (optional)", text: $name, disabled: state == .creating)
                LabeledTextField(
                    label: "Opening task (optional)",
                    text: $task,
                    axis: .vertical,
                    disabled: state == .creating
                )
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.cardFill)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(Color.controlStroke, lineWidth: 1)
                    )
            )

            Button(action: create) {
                HStack(spacing: 8) {
                    if state == .creating {
                        ProgressView()
                            .tint(Color.ink)
                            .scaleEffect(0.8)
                    }
                    Text(state == .creating ? "Creating…" : "Create workspace")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.ink)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 42)
            }
            .disabled(state == .creating)
            .buttonStyle(ActButtonStyle())

            if case .result(let answer) = state {
                resultBanner(answer)
            }
        }
    }

    private func create() {
        let nameValue = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let taskValue = task.trimmingCharacters(in: .whitespacesAndNewlines)
        state = .creating
        Task {
            do {
                let token = try await session.validAccessToken()
                let answer: ActWorkspaceAnswer
                do {
                    answer = try await actClient.createWorkspace(
                        accessToken: token,
                        providerId: providerId,
                        providerProjectId: providerProjectId,
                        name: nameValue.isEmpty ? nil : nameValue,
                        task: taskValue.isEmpty ? nil : taskValue
                    )
                } catch ActClientError.unauthorized {
                    // validAccessToken() refreshes near-expiry tokens; a 401
                    // here means the server rejected the token outright — refresh and retry once.
                    let fresh = try await session.refreshAccessToken()
                    answer = try await actClient.createWorkspace(
                        accessToken: fresh,
                        providerId: providerId,
                        providerProjectId: providerProjectId,
                        name: nameValue.isEmpty ? nil : nameValue,
                        task: taskValue.isEmpty ? nil : taskValue
                    )
                }
                if answer.result == .accepted,
                   let provider = ProductProviderID(rawValue: providerId)
                {
                    events.record(.sessionActSend(provider: provider, act: .workspaceCreate))
                }
                state = .result(answer)
            } catch {
                state = .result(ActWorkspaceAnswer(
                    result: .rejected,
                    reason: error.localizedDescription,
                    providerSessionId: nil
                ))
            }
        }
    }

    @ViewBuilder
    private func resultBanner(_ answer: ActWorkspaceAnswer) -> some View {
        HStack(spacing: 6) {
            Image(systemName: answer.result == .accepted ? "checkmark.circle" : "exclamationmark.circle")
                .font(.system(size: 13, weight: .semibold))
            VStack(alignment: .leading, spacing: 2) {
                Text(answer.result == .accepted ? "Workspace created" : (answer.reason ?? "Creation failed"))
                    .font(.system(size: 13))
                    .lineLimit(2)
                if let sessionId = answer.providerSessionId {
                    Text("Session: \(sessionId)")
                        .font(.system(size: 11))
                        .opacity(0.7)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
        .foregroundStyle(answer.result == .accepted ? Color.stateComplete : Color.errorInk)
        .padding(.horizontal, 10)
        .onTapGesture { state = .idle }
    }
}

private struct LabeledTextField: View {
    let label: String
    @Binding var text: String
    var axis: Axis = .horizontal
    var disabled: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Color.inkSecondary)
            TextField("", text: $text, axis: axis)
                .lineLimit(axis == .vertical ? 3 : 1, reservesSpace: false)
                .textFieldStyle(.plain)
                .font(.system(size: 15))
                .foregroundStyle(Color.ink)
                .disabled(disabled)
        }
    }
}

struct ActButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 16)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(configuration.isPressed ? Color.pressedFill : Color.cardFill)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color.controlStroke, lineWidth: 1)
                    )
            )
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}
