import { AccountClient, AccountSessionManager, type StoredAccount } from "@repo/credentials";
import { ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import {
  AccountRefreshFailed,
  type AccountToken,
  accountBearer,
  sessionBearer,
} from "@repo/features";
import { FIRST_PARTY_OAUTH_CLIENT_ID } from "@repo/features/oauth-client-ids";
import { Effect, Layer } from "effect";
import type { AccountSession, AccountSourceHost } from "./account-source.js";
import {
  AccountSource,
  SecretCipher,
  SignInConsent,
  type SignInConsentSeam,
} from "./effect/seams.js";

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

const openOAuthSession = Effect.fnUntraced(function* (
  host: AccountSourceHost,
  openConsent: SignInConsentSeam["open"],
): Effect.fn.Return<AccountSession> {
  const { store, runMode } = host;

  const client = new AccountClient({
    baseUrl: host.accountBaseUrl,
    clientId: FIRST_PARTY_OAUTH_CLIENT_ID.DESKTOP,
  });

  const session = yield* AccountSessionManager.make({
    client,
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

  const readStoredAccount = (): Effect.Effect<StoredAccount | undefined> =>
    store.readAccount().pipe(Effect.orElseSucceed(() => undefined));

  const token: AccountToken = {
    readAccessToken: () =>
      runMode.sendsNetwork
        ? Effect.map(readStoredAccount(), (account) => account?.accessToken)
        : Effect.succeed(undefined),
    refreshAccount: session.renewOnce,
    readAccountKey: () => Effect.map(readStoredAccount(), (account) => account?.email),
  };

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
