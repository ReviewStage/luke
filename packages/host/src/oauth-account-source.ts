import { AccountClient, AccountSessionManager, type StoredAccount } from "@luke/credentials";
import { ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import {
  AccountRefreshFailed,
  type AccountToken,
  accountBearer,
  sessionBearer,
} from "@luke/features";
import { Effect, Layer } from "effect";
import type { AccountSession, AccountSourceHost } from "./account-source.js";
import {
  AccountSource,
  SecretCipher,
  SignInConsent,
  type SignInConsentSeam,
} from "./effect/seams.js";

const ACCOUNT_CLIENT_ID = "luke-desktop";

/**
 * The desktop's account: an OAuth sign-in through the developer's browser,
 * whose consent the shell stands up (`SignInConsent`), with the tokens it
 * lands sealed in the settings file by the shell's cipher (`SecretCipher`).
 * These two seams are this source's alone, so a host assembled over another
 * source is handed neither.
 */
export const oauthAccountSourceLayer: Layer.Layer<
  AccountSource,
  never,
  SecretCipher | SignInConsent
> = Layer.effect(
  AccountSource,
  Effect.gen(function* () {
    const cipher = yield* SecretCipher;
    const consent = yield* SignInConsent;
    return {
      tokenCipher: cipher,
      open: (host: AccountSourceHost) => openOAuthSession(host, consent.open),
    };
  }),
);

const openOAuthSession = /* @__PURE__ */ Effect.fnUntraced(function* (
  host: AccountSourceHost,
  openConsent: SignInConsentSeam["open"],
): Effect.fn.Return<AccountSession> {
  const { store, runMode } = host;

  const client = new AccountClient({
    baseUrl: host.accountBaseUrl,
    clientId: ACCOUNT_CLIENT_ID,
  });

  const session = yield* AccountSessionManager.make({
    client,
    // The store's own effects, with an I/O failure read as the defect the
    // rejected promise behind each of these already was. The capability pair
    // is awaited rather than read, because a link read at construction would
    // be read before the host has linked it.
    store: {
      readAccount: () => Effect.orDie(store.readAccount()),
      setAccount: (stored) => Effect.orDie(store.setAccount(stored)),
      clearAccount: () => Effect.orDie(store.clearAccount()),
    },
    hostedServiceBaseUrl: host.hostedServiceBaseUrl,
    requiresAccount: runMode.requiresAccount,
    openExternal: host.openExternal,
    openConsent,
    report: host.report,
    startCapabilities: host.startCapabilities,
    stopCapabilities: host.stopCapabilities,
  });

  /**
   * One account read: a store that could not be read is an account this
   * attempt cannot name, exactly as a rejected read already was here.
   */
  const readStoredAccount = (): Effect.Effect<StoredAccount | undefined> =>
    store.readAccount().pipe(Effect.orElseSucceed(() => undefined));

  // The holder is the account's own address, so a call's one retry after a
  // 401 can tell a renewed token from a different person's: a sign-out and
  // sign-in between the attempt and its retry reads as the caller's account
  // gone, never as a fresh bearer to carry the old account's payload under.
  const token: AccountToken = {
    readAccessToken: () =>
      runMode.sendsNetwork
        ? Effect.map(readStoredAccount(), (account) => account?.accessToken)
        : Effect.succeed(undefined),
    refreshAccount: session.renewOnce,
    readAccountKey: () => Effect.map(readStoredAccount(), (account) => account?.email),
  };

  // Note that a hand-off that did not land is no failure of the call that
  // asked for it: the call retries on whatever session stands, and its
  // second refusal is what gets reported.
  const sessionCredential = sessionBearer({
    ...token,
    readSessionToken: () =>
      runMode.sendsNetwork
        ? Effect.map(readStoredAccount(), (account) => account?.sessionToken)
        : Effect.succeed(undefined),
    obtainSession: () =>
      session.obtainSession().pipe(
        Effect.asVoid,
        Effect.mapError((failed) => new AccountRefreshFailed({ message: failed.message })),
      ),
  });

  return {
    snapshot: () => session.snapshot,
    changes: session.changes,
    initialize: Effect.gen(function* () {
      const initial: AccountSnapshot = runMode.requiresAccount
        ? yield* Effect.orDie(store.accountSnapshot())
        : { status: ACCOUNT_STATUS.SIGNED_OUT };
      session.initialize(initial);
      return initial;
    }),
    beginSignIn: (provider) => session.beginSignIn(provider),
    signInAgain: (provider) => session.signInAgain(provider),
    cancelSignIn: () => session.cancelSignIn(),
    signOut: (options) => session.signOut(options),
    deleteEverywhere: () => session.deleteEverywhere(),
    refreshOnce: session.refreshOnce,
    token,
    credential: accountBearer(token),
    sessionCredential,
  };
});
