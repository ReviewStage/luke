export const ACCOUNT_PROVIDER = {
  GOOGLE: "google",
  GITHUB: "github",
} as const;

export type AccountProvider = (typeof ACCOUNT_PROVIDER)[keyof typeof ACCOUNT_PROVIDER];

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
