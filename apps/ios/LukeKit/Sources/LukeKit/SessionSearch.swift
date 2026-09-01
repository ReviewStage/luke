import Foundation

/// Session search with the desktop's semantics (`searchTokens` and
/// `matchesQuery` in `apps/desktop/src/renderer/session-model.ts`), read over
/// the fields a `RosterSession` actually carries, so the two surfaces cannot
/// disagree about what finds a session.
public enum SessionSearch {
    /// A query read into the words it asks for: lowercased and split on
    /// whitespace, because matching is case-blind and every word must be
    /// found somewhere. A blank query has no words, which is what makes it
    /// no search at all.
    public static func tokens(from query: String) -> [String] {
        query.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
    }

    /// Every word somewhere on the row: words narrow, they never widen.
    public static func matches(_ session: RosterSession, tokens: [String]) -> Bool {
        if tokens.isEmpty { return true }
        let lines = searchableLines(of: session).map { $0.lowercased() }
        return tokens.allSatisfy { token in lines.contains { $0.contains(token) } }
    }

    /// The lines a query is read against: everything the row itself can say —
    /// title, recap, workspace, branch — plus the status word, because the
    /// recap only stands in for it, and the provider under both the wire id
    /// and the product name, since either is a name the user knows it by.
    static func searchableLines(of session: RosterSession) -> [String] {
        var lines = [session.title, session.status, session.providerId]
        if let provider = VaultProviderID(rawValue: session.providerId) {
            lines.append(provider.displayName)
        }
        if let recap = session.recap { lines.append(recap) }
        if let workspace = session.workspace { lines.append(workspace) }
        if let branch = session.branch { lines.append(branch) }
        return lines
    }
}
