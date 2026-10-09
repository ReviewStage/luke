/**
 * auth-policy.ts -- the auth policy constants, apart from the `betterAuth` construction that reads them.
 *
 * `auth.ts` cannot be imported without a database, and what this deployment
 * fixes about sign-in, token storage, key storage, and client privileges is
 * worth asserting without one.
 */

/**
 * What a GitHub sign-in asks for. It is the Luke GitHub App's user
 * authorization, and a GitHub App has permissions rather than scopes: what
 * the token reaches is fixed by the App's registration (repository metadata,
 * contents, and pull requests where the App is installed and the user has
 * access, and the user's email addresses), so the request names no OAuth
 * scope, and Better Auth's own `read:user user:email` default is switched off
 * rather than sent for GitHub to ignore.
 */
export const GITHUB_SIGN_IN = {
  disableDefaultScope: true,
} as const;

/**
 * How Better Auth keeps an account's provider rows. Every token is sealed
 * under the session secret. A sign-in refreshes the row it signs in through,
 * which is how an account that signed in through the OAuth App before the
 * GitHub App comes to hold the App's token and refresh token.
 */
export const ACCOUNT_TOKEN_STORAGE = {
  encryptOAuthTokens: true,
  updateAccountOnSignIn: true,
} as const;

/**
 * The Better Auth endpoints this deployment does not serve. `/token` is the
 * JWT plugin's, which the OAuth provider's own token endpoint stands in for.
 * The other two would hand a signed-in browser its GitHub access token:
 * nothing of Luke's reads that token anywhere but on the server
 * (`github/github-app.ts`), and root AGENTS.md pins that no credential
 * travels in an answer, so neither door is open.
 */
export const DISABLED_AUTH_PATHS = ["/token", "/get-access-token", "/refresh-token"] as const;

export const JWT_KEY_STORAGE = {
  jwks: {
    disablePrivateKeyEncryption: false,
  },
} as const;

/** Luke provisions its own native clients; signed-in users cannot add or alter OAuth clients. */
export function denyOAuthClientPrivileges(): false {
  return false;
}
