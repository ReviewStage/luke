export const ACCOUNT_TOKEN_STORAGE = {
  encryptOAuthTokens: true,
} as const;

export const JWT_KEY_STORAGE = {
  jwks: {
    disablePrivateKeyEncryption: false,
  },
} as const;

/** Luke provisions its one native client; signed-in users cannot add or alter OAuth clients. */
export function denyOAuthClientPrivileges(): false {
  return false;
}
