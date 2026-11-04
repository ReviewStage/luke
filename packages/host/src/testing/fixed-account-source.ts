import { ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import { type CallCredential, NO_CREDENTIAL } from "@repo/features";
import { Effect, Layer, Stream } from "effect";
import type { AccountSession, AccountSourceHost } from "../account-source.js";
import { AccountSource } from "../effect/seams.js";

/**
 * An account source that stands on the one account and credential a test
 * hands it and keeps nothing of its own: no tokens in the settings file, so
 * it hands the store no cipher, and no sign-in, so it needs no consent. What
 * a host assembled over a source other than the desktop's stands on.
 */
export function fixedAccountSource(
  input: {
    readonly account?: AccountSnapshot;
    readonly credential?: CallCredential;
    /** Hears the host the account composer opens the source over, whose gate a test may close as a sign-out does. */
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
