import type { UnparsedWireValue } from "@luke/wire";
import { Schema } from "effect";

export const ACCOUNT_PROVIDER = {
  GOOGLE: "google",
  GITHUB: "github",
} as const;

export type AccountProvider = (typeof ACCOUNT_PROVIDER)[keyof typeof ACCOUNT_PROVIDER];

export function isAccountProvider(value: UnparsedWireValue): value is AccountProvider {
  return value === ACCOUNT_PROVIDER.GOOGLE || value === ACCOUNT_PROVIDER.GITHUB;
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
      /**
       * The account's own id, the service's `sub` (`client.ts`'s
       * `AccountIdentity`), which is how the window tells the signed-in
       * member's work from a teammate's. Absent for an identity stored
       * without one, where the window names nobody You.
       */
      id?: string;
      email: string;
      name?: string;
      /**
       * The provider's own avatar for the signed-in user, kept only when it
       * lives on a host this build pins in the renderer's image policy.
       */
      pictureUrl?: string;
      provider: AccountProvider;
    };

/**
 * An account snapshot as it crosses to a window, the type above as a schema:
 * what an act that answers the account carries back to the window that asked.
 */
export const accountSnapshotSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal(ACCOUNT_STATUS.SIGNED_OUT) }),
  Schema.Struct({ status: Schema.Literal(ACCOUNT_STATUS.SIGNING_IN) }),
  Schema.Struct({
    status: Schema.Literal(ACCOUNT_STATUS.SIGNED_IN),
    id: Schema.optionalKey(Schema.String),
    email: Schema.String,
    name: Schema.optionalKey(Schema.String),
    pictureUrl: Schema.optionalKey(Schema.String),
    provider: Schema.Literals(Object.values(ACCOUNT_PROVIDER)),
  }),
]);
