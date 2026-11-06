import { ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import { type CallCredential, NO_CREDENTIAL } from "@repo/features";
import { Effect, Layer, Stream } from "effect";
import type { AccountSession, AccountSourceHost } from "../account-source.js";
import { AccountSource } from "../effect/seams.js";

export function fixedAccountSource(
  input: {
    readonly account?: AccountSnapshot;
    readonly credential?: CallCredential;
    readonly opened?: (host: AccountSourceHost) => void;
  } = {},
): Layer.Layer<AccountSource> {
  const account = input.account ?? { status: ACCOUNT_STATUS.SIGNED_OUT };
  const credential = input.credential ?? NO_CREDENTIAL;
  const signedOut: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };
  const session: AccountSession = {
    snapshot: () => account,
    changes: Effect.succeed(Stream.empty),
    initialize: Effect.succeed(account),
    beginSignIn: () => Effect.succeed(account),
    signInAgain: () => Effect.succeed(false),
    cancelSignIn: () => undefined,
    signOut: () => Effect.succeed(signedOut),
    deleteEverywhere: () => Effect.succeed(signedOut),
    refreshOnce: () => Effect.void,
    token: { readAccessToken: () => Effect.succeed(undefined), refreshAccount: () => Effect.void },
    credential,
    sessionCredential: credential,
  };
  return Layer.succeed(AccountSource, {
    tokenCipher: undefined,
    open: (host) =>
      Effect.sync(() => {
        input.opened?.(host);
        return session;
      }),
  });
}
