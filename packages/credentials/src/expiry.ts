/**
 * How early a stored grant counts as expired. A refresh a minute ahead of the
 * stamp means no pass rides a token across its own expiry, which would spend a
 * consumed refresh token to recover from a failure that never had to happen.
 */
export const ACCESS_TOKEN_EXPIRY_SLACK_MS = 60_000;
