/**
 * What a GitHub sign-in asks for. Note that it asks for `repo` alongside the
 * profile and email, because the token sign-in stores is the account's
 * GitHub connection, and a planning call reads private source through it; a
 * developer who signed in with GitHub never meets the Connect GitHub step.
 */
export const GITHUB_SIGN_IN_SCOPES = ["read:user", "user:email", "repo"] as const;

/**
 * How Better Auth keeps an account's provider rows. Every token is sealed
 * under the session secret. A sign-in refreshes the row it signs in through,
 * so an account whose GitHub row predates `repo` at sign-in gains it the
 * next time it signs in with GitHub, since sign-in and the Connect GitHub
 * step now ask for the same scopes. Linking stays explicit and
 * session-bound, and may name a GitHub account whose email is not the Luke
 * account's, so an account signed in with Google can connect GitHub.
 */
export const ACCOUNT_TOKEN_STORAGE = {
  encryptOAuthTokens: true,
  updateAccountOnSignIn: true,
  accountLinking: { allowDifferentEmails: true },
} as const;

export const JWT_KEY_STORAGE = {
  jwks: {
    disablePrivateKeyEncryption: false,
  },
} as const;

/**
 * The auth policy constants, apart from the `betterAuth` construction that
 * reads them: `auth.ts` cannot be imported without a database, and what this
 * deployment fixes about token storage, key storage, and client privileges is
 * worth asserting without one.
 */

/** Luke provisions its own native clients; signed-in users cannot add or alter OAuth clients. */
export function denyOAuthClientPrivileges(): false {
  return false;
}
