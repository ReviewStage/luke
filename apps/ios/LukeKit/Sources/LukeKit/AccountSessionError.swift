/// The one refusal every hosted client raises when no account stands behind a
/// call. It stands apart from `AccountSession`, which raises it too, because
/// the clients that throw and catch it never reach the session itself.
public enum AccountSessionError: Error, Equatable {
    /// No usable credential stands — never signed in, signed out mid-flight,
    /// or the refresh token was rejected outright.
    case signedOut
}
