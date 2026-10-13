import type { UnparsedWireValue } from "@sidecar/wire";

/**
 * The providers an account on this Mac may have signed in with. Sign-in is
 * GitHub's alone now, but an account stored before that still names Google,
 * and its Luke tokens still work, so it is read rather than signed out.
 */
export const ACCOUNT_PROVIDER = {
  GOOGLE: "google",
  GITHUB: "github",
} as const;

export type AccountProvider = (typeof ACCOUNT_PROVIDER)[keyof typeof ACCOUNT_PROVIDER];

/** The one provider a sign-in may begin with. */
export type SignInProvider = typeof ACCOUNT_PROVIDER.GITHUB;

export function isAccountProvider(value: UnparsedWireValue): value is AccountProvider {
  return value === ACCOUNT_PROVIDER.GOOGLE || value === ACCOUNT_PROVIDER.GITHUB;
}

export function isSignInProvider(value: UnparsedWireValue): value is SignInProvider {
  return value === ACCOUNT_PROVIDER.GITHUB;
}

export const ACCOUNT_STATUS = {
  SIGNED_OUT: "signed-out",
  SIGNING_IN: "signing-in",
  SIGNED_IN: "signed-in",
} as const;

/** Renderer-safe identity. OAuth tokens never cross the preload boundary. */
export type AccountSnapshot =
  | { status: typeof ACCOUNT_STATUS.SIGNED_OUT }
  | { status: typeof ACCOUNT_STATUS.SIGNING_IN }
  | {
      status: typeof ACCOUNT_STATUS.SIGNED_IN;
      email: string;
      name?: string;
      /**
       * The provider's own avatar for the signed-in user, kept only when it
       * lives on a host this build pins in the renderer's image policy.
       */
      pictureUrl?: string;
      provider: AccountProvider;
    };
