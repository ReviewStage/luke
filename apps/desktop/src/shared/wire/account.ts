import { ACCOUNT_PROVIDER, type AccountProvider } from "@sidecar/account/snapshot";
import type { UnparsedWireValue } from "@sidecar/wire";

export {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountProvider,
  type AccountSnapshot,
} from "@sidecar/account/snapshot";

export function isAccountProvider(value: UnparsedWireValue): value is AccountProvider {
  return value === ACCOUNT_PROVIDER.GOOGLE || value === ACCOUNT_PROVIDER.GITHUB;
}

/** Where a credential was resolved from, without ever exposing the credential. */
export const CREDENTIAL_SOURCE = {
  NONE: "none",
  ENVIRONMENT: "environment",
  ENCRYPTED_FILE: "encrypted-file",
} as const;

export type CredentialSource = (typeof CREDENTIAL_SOURCE)[keyof typeof CREDENTIAL_SOURCE];

/**
 * Whether Luke can store a credential through OS-provided encryption. Asking is
 * not free: on macOS the answer comes from the Keychain, and reading it is what
 * raises the permission dialog. Nobody who has never stored a key has any
 * reason to see that dialog, so the question goes unasked until a key is
 * actually being stored, and until then the answer is `UNKNOWN` rather than a
 * guess in either direction.
 */
export const SECRET_STORAGE = {
  UNKNOWN: "unknown",
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable",
} as const;

export type SecretStorage = (typeof SECRET_STORAGE)[keyof typeof SECRET_STORAGE];
