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
    /// retry once.
    public func authorized<T>(_ call: (String) async throws -> T) async throws -> T {
        let token = try await validAccessToken()
        do {
            return try await call(token)
        } catch let error as HostedUnauthorizedSignaling where error.isUnauthorized {
            let fresh = try await refreshAccessToken()
            return try await call(fresh)
        }
    }
}

/// What a hosted act endpoint answered, whichever act it was: the shared
/// slice of every act answer the runner below reads.
public protocol ActAnswer {
    var result: ActResult { get }
    var reason: String? { get }
}

extension ActMessageAnswer: ActAnswer {}
extension ActWorkspaceAnswer: ActAnswer {}

/// What became of one act run end to end.
public enum ActOutcome<Answer: ActAnswer> {
    /// The provider accepted; the count is already recorded.
    case delivered(Answer)
    /// The act did not land; the reason is ready to show.
    case refused(String)
    /// Signed out mid-act; the state change redraws, and there is nothing to show.
    case signedOut
}

extension AccountTokenProviding {
    /// Runs one act with the account's token discipline and counts an
    /// accepted one under its allowlisted name — which act, on which
    /// provider, never what it carried. Every act surface answers with the
    /// same three outcomes, so the accepted/refused/signed-out contract and
    /// the analytics record live here once instead of at each leaf.
    @MainActor
    public func performAct<Answer: ActAnswer>(
        counting act: ProductSessionAct,
        provider providerId: String,
        events: ProductEventSender,
        fallbackReason: String,
        _ call: (String) async throws -> Answer
    ) async -> ActOutcome<Answer> {
        do {
            let answer = try await authorized(call)
            guard answer.result == .accepted else {
                return .refused(answer.reason ?? fallbackReason)
            }
            // A provider id the shared vocabulary has not answered for is
            // left uncounted rather than sent to be refused.
            if let provider = ProductProviderID(rawValue: providerId) {
                events.record(.sessionActSend(provider: provider, act: act))
            }
            return .delivered(answer)
        } catch is AccountSessionError {
            return .signedOut
        } catch {
            return .refused(error.localizedDescription)
        }
    }
}
