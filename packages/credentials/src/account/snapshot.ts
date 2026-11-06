import { SIGN_IN_FAILURE, type SignInFailure } from "@repo/features/words";
import type { UnparsedWireValue } from "@repo/wire";
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

export type AccountSnapshot =
  | { status: typeof ACCOUNT_STATUS.SIGNED_OUT }
  | { status: typeof ACCOUNT_STATUS.SIGNING_IN }
  | {
      status: typeof ACCOUNT_STATUS.SIGNED_IN;
      id?: string;
      email: string;
      name?: string;
      pictureUrl?: string;
      provider: AccountProvider;
      impersonated?: true;
    };

export function signedInAccountId(account: AccountSnapshot | undefined): string | undefined {
  return account?.status === ACCOUNT_STATUS.SIGNED_IN ? account.id : undefined;
}

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
    impersonated: Schema.optionalKey(Schema.Literal(true)),
  }),
]);

export type SignInAnswer = { account: AccountSnapshot } | { failure: SignInFailure };

export const signInAnswerSchema = Schema.Union([
  Schema.Struct({ account: accountSnapshotSchema }),
  Schema.Struct({ failure: Schema.Literals(Object.values(SIGN_IN_FAILURE)) }),
]);
