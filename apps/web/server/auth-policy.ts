export const ACCOUNT_TOKEN_STORAGE = {
  encryptOAuthTokens: true,
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
