import Foundation

/// The one 401 signal across LukeKit's hosted clients, so the retry
/// discipline below can be written once however each client spells its
/// server error.
private func isUnauthorizedAnswer(_ error: Error) -> Bool {
    switch error {
    case ActClientError.unauthorized:
        return true
    case RosterClientError.serverError(let status) where status == 401:
        return true
    case ProjectsClientError.serverError(let status) where status == 401:
        return true
    default:
        return false
    }
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
        } catch where isUnauthorizedAnswer(error) {
            let fresh = try await refreshAccessToken()
            return try await call(fresh)
        }
    }
}
