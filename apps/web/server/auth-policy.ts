/**
 * What a GitHub sign-in asks for: the profile and email, and nothing of the
 * developer's repositories, since a plan reads a folder on their Mac.
 */
export const GITHUB_SIGN_IN_SCOPES = ["read:user", "user:email"] as const;

/**
 * How Better Auth keeps an account's provider rows. Every token is sealed
 * under the session secret. A sign-in refreshes the row it signs in through.
 * Linking stays explicit and
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
