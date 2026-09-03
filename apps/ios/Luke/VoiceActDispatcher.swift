import Foundation
import LukeKit

/// What a tool call is carried against: the roster and projects the
/// conversation was shown, the account's bearer, and the two presses the
/// list offers that a spoken ask may take instead. Every value here is read at the moment of the call, so an act is
/// validated against the roster as it stands then, never as it stood when
/// the call was minted.
@MainActor
struct VoiceActContext {
    /// The tools the service minted the call with, as the server confirmed
    /// them at channel open; nil before a call has connected. A call naming
    /// a tool outside the set, or arriving before the set is known, is
    /// refused before it is looked at.
    let mintedTools: [String]?
    let sessions: [RosterSession]
    let projects: ProjectsAnswer?
    let defaults: WorkspaceCreationDefaults
    let actClient: ActClient
    let accessToken: () async throws -> String
    /// Counts an act a provider accepted, under its allowlisted name alone.
    let count: (ProductSessionAct, _ providerId: String) -> Void
    let refreshRoster: () async -> Void
    let open: (RosterSession) -> Void
    let showList: (VoiceAsks.SessionListAsk) -> Void
}

/// Carries one tool call the model composed in a turn the developer opened.
/// Each act is validated on the phone against what the conversation was
/// shown, then either performed here — an open, or the list — or sent
/// to the hosted act endpoint that serves it, which re-observes and validates
/// it again before anything is written. The answer is the JSON the model
/// reads back as the call's output: an outcome and, on a refusal, the reason
/// Luke can say aloud.
@MainActor
func dispatchVoiceToolCall(
    name: String,
    arguments: [String: Any],
    context: VoiceActContext
) async -> String {
    guard let tool = VoiceToolName(rawValue: name) else {
        return refusal("No such tool exists.")
    }
    // The minted set is the service's word on what this call may ask for;
    // the phone honors it even for a tool it knows how to carry, and a call
    // arriving before the set is known is refused rather than trusted.
    guard let minted = context.mintedTools else {
        return refusal("The call's minted tools are not known yet.")
    }
    guard minted.contains(name) else {
        return refusal("The service did not mint that tool for this call.")
    }
    switch tool {
    case .sendSessionMessage:
        return await carry(VoiceAsks.message(arguments, in: context.sessions), context, .messageSend) {
            ask, token in
            try await context.actClient.sendMessage(
                accessToken: token,
                providerId: ask.session.providerId,
                providerSessionId: ask.session.sessionId,
                text: ask.text
            )
        }
    case .runSessionControl:
        return await carry(VoiceAsks.control(arguments, in: context.sessions), context, .controlRun) {
            ask, token in
            try await context.actClient.executeControl(
                accessToken: token,
                providerId: ask.session.providerId,
                providerSessionId: ask.session.sessionId,
                controlId: ask.control.id
            )
        }
    case .addWorkspaceAgent:
        let agentModels = context.projects?.agentModels ?? []
        return await carry(
            VoiceAsks.addAgent(arguments, in: context.sessions, agentModels: agentModels), context,
            .agentAdd
        ) { ask, token in
            try await context.actClient.spawnAgent(
                accessToken: token,
                providerId: ask.session.providerId,
                providerSessionId: ask.session.sessionId,
                agent: ask.agent,
                name: ask.name,
                task: ask.task,
                model: ask.model,
                effort: ask.effort
            )
        }
    case .renameWorkspace:
        return await carry(
            VoiceAsks.renameWorkspace(arguments, in: context.sessions), context, .workspaceRename
        ) { ask, token in
            try await context.actClient.renameWorkspace(
                accessToken: token,
                providerId: ask.session.providerId,
                providerSessionId: ask.session.sessionId,
                name: ask.name
            )
        }
    case .renameSession:
        return await carry(
            VoiceAsks.renameSession(arguments, in: context.sessions), context, .sessionRename
        ) { ask, token in
            try await context.actClient.renameSession(
                accessToken: token,
                providerId: ask.session.providerId,
                providerSessionId: ask.session.sessionId,
                name: ask.name
            )
        }
    case .createWorkspace:
        guard let projects = context.projects else {
            return refusal("The projects a workspace can be created in have not loaded yet.")
        }
        let ask = VoiceAsks.workspaceCreation(
            arguments,
            projects: projects,
            defaultProviderId: context.defaults.lastProviderId,
            defaultProjectIds: context.defaults.lastProjectIds
        )
        return await carry(ask, context, .workspaceCreate) { ask, token in
            let answer = try await context.actClient.createWorkspace(
                accessToken: token,
                providerId: ask.project.providerId,
                providerProjectId: ask.project.providerProjectId,
                name: ask.name,
                task: ask.task,
                agent: ask.agent,
                model: ask.model,
                effort: ask.effort
            )
            if answer.result == .accepted {
                // The first creation saves its provider as the default, the
                // same tie-break the New Workspace sheet remembers.
                context.defaults.lastProviderId = ask.project.providerId
                context.defaults.setLastProjectId(
                    ask.project.providerProjectId, for: ask.project.providerId
                )
            }
            return answer
        }
    case .openSession:
        switch VoiceAsks.open(arguments, in: context.sessions) {
        case .failure(let refused): return refusal(refused.reason)
        case .success(let session):
            context.open(session)
            context.count(.sessionOpen, session.providerId)
            return voiceToolOutput(["result": "accepted"])
        }
    case .showPanel:
        switch VoiceAsks.sessionList(arguments, in: context.sessions) {
        case .failure(let refused): return refusal(refused.reason)
        case .success(let ask):
            context.showList(ask)
            return voiceToolOutput(["result": "accepted"])
        }
    }
}

/// Runs one validated session act against its hosted endpoint, counts an
/// accepted one, and refreshes the roster so the next call is validated
/// against what the act changed. The endpoint's own answer is what the model
/// reads: accepted, or rejected with the server's reason.
@MainActor
private func carry<Ask: VoiceProviderAsk, Answer: ActAnswer>(
    _ validated: Result<Ask, VoiceAskRefusal>,
    _ context: VoiceActContext,
    _ counted: ProductSessionAct,
    _ call: (Ask, String) async throws -> Answer
) async -> String {
    switch validated {
    case .failure(let refused):
        return refusal(refused.reason)
    case .success(let ask):
        do {
            let token = try await context.accessToken()
            let answer = try await call(ask, token)
            if answer.result == .accepted {
                context.count(counted, ask.providerId)
                await context.refreshRoster()
            }
            var output: [String: Any] = ["result": answer.result.rawValue]
            if let reason = answer.reason { output["reason"] = reason }
            return voiceToolOutput(output)
        } catch is AccountSessionError {
            return voiceToolOutput(["error": "signed out"])
        } catch {
            return voiceToolOutput(["error": "network error"])
        }
    }
}

private func refusal(_ reason: String) -> String {
    voiceToolOutput(["result": "rejected", "reason": reason])
}

/// The call's output as the model reads it: a bounded JSON object, never
/// text a value could break out of.
private func voiceToolOutput(_ fields: [String: Any]) -> String {
    guard
        let data = try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]),
        let text = String(data: data, encoding: .utf8)
    else { return #"{"error":"unreadable output"}"# }
    return text
}
