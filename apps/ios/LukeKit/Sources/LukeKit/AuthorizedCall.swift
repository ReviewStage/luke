import Foundation

/// The one 401 signal across LukeKit's hosted clients: each client's error
/// says for itself whether the server refused the token, so the retry
/// discipline below needs to know no client by name and a client added later
/// cannot silently miss it.
public protocol HostedUnauthorizedSignaling {
    var isUnauthorized: Bool { get }
}

extension AccountTokenProviding {
    /// Runs one authorized hosted call with the account's token discipline:
    /// `validAccessToken()` refreshes near-expiry tokens, so an unauthorized
    /// answer means the server rejected the token outright — refresh and
    /// retry once. The retry is a second request, and the account can change
    /// between the two: a sign-out and another sign-in while the first
    /// attempt was out would hand the retry the new account's token, so the
    /// holder is captured before the first attempt and the retry runs only
    /// while the same account still holds the session. A holder that moved
    /// reads as the first account's sign-out, and the call is refused rather
    /// than carried under an account the caller never decided on.
    public func authorized<T>(_ call: (String) async throws -> T) async throws -> T {
        guard let holder = accountEmail else { throw AccountSessionError.signedOut }
        let token = try await validAccessToken()
        do {
            return try await call(token)
        } catch let error as HostedUnauthorizedSignaling where error.isUnauthorized {
            let fresh = try await refreshAccessToken()
            guard accountEmail == holder else { throw AccountSessionError.signedOut }
            return try await call(fresh)
        }
    }
}

/// What a hosted action endpoint answered, whichever action it was: the shared
/// slice of every action answer the runner below reads.
public protocol ActionAnswer {
    var result: ActionResult { get }
    var reason: String? { get }
}

extension ActionMessageAnswer: ActionAnswer {}
extension ActionWorkspaceAnswer: ActionAnswer {}

/// What became of one action run end to end.
public enum ActionOutcome<Answer: ActionAnswer> {
    /// The provider accepted; the count is already recorded.
    case delivered(Answer)
    /// The action did not land; the reason is ready to show.
    case refused(String)
    /// Signed out mid-action; the state change redraws, and there is nothing to show.
    case signedOut
}

extension AccountTokenProviding {
    /// Runs one action with the account's token discipline and counts an
    /// accepted one under its allowlisted name — which action, on which
    /// provider, never what it carried. Every action surface answers with the
    /// same three outcomes, so the accepted/refused/signed-out contract and
    /// the analytics record live here once instead of at each leaf.
    @MainActor
    public func performAction<Answer: ActionAnswer>(
        counting action: ProductSessionAction,
        provider providerId: String,
        events: ProductEventSender,
        fallbackReason: String,
        _ call: (String) async throws -> Answer
    ) async -> ActionOutcome<Answer> {
        do {
            let answer = try await authorized(call)
            guard answer.result == .accepted else {
                return .refused(answer.reason ?? fallbackReason)
            }
            // A provider id the shared vocabulary has not answered for is
            // left uncounted rather than sent to be refused.
            if let provider = ProductProviderID(rawValue: providerId) {
                events.record(.sessionActionSend(provider: provider, action: action))
            }
            return .delivered(answer)
        } catch is AccountSessionError {
            return .signedOut
        } catch {
            return .refused(error.localizedDescription)
        }
    }
}
