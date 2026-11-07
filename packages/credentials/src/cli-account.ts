/**
 * cli-account.ts -- the `vespin` command's sign-in: the account its store keeps, the bearer read from it and renewed through it, and the trips that sign it in and out.
 *
 * The command signs in as the desktop does, through the same consent trip
 * (`OpenConsent`, the loopback or the paste-back) and the same token client
 * (`AccountClient`), under its own first-party client id. What it keeps is
 * one account per service: the two tokens, and who they answer for, which
 * the store (the Keychain or a file, the command's own) holds whole. A
 * call reads its bearer from the store fresh, and `account-call.ts`'s one
 * renewal on a 401 refreshes through it, so the command adds no retry of
 * its own.
 *
 * Note that several commands may run at once, as a coding agent's shell
 * runs them, and a refresh token is spent by the refresh that uses it: a
 * refusal of the refresh is read against the store again before it is
 * taken as the sign-in gone, since another command may have renewed it.
 */

import {
  AccountRefreshFailed,
  accountCall,
  CALL_FAULT,
  type CallCredential,
  callAnswered,
  fixedBearer,
} from "@repo/features";
import { CLI_EXIT, type CliExit, cliExitOfFault, cliExitOfStatus } from "@repo/features/cli-exit";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { HTTP_METHOD } from "@repo/wire";
import { Data, Effect, Schema, type Scope } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  ACCOUNT_FAILURE_ACTION,
  type AccountClient,
  type AccountClientFailure,
  type AccountTokens,
  accountFailureAction,
  withIssuedAccountTokens,
} from "./account/client.js";
import type { LoopbackConsentOutcome, OpenConsent } from "./consent.js";

/** The path the authorize route sends the code back to, the one the client registered. */
const CALLBACK_PATH = "/callback";

/** The account service's identity read, under its base address. */
const USERINFO_PATH = "/oauth2/userinfo";

/** The landing cards a loopback sign-in leaves the browser on; every string is fixed by the build. */
const CLI_SIGN_IN_PAGES = {
  granted: {
    badge: "Signed in",
    title: `Signed in to the ${PRODUCT_NAME} CLI`,
    body: "You can close this tab and return to your terminal.",
  },
  notGranted: {
    badge: "Not completed",
    title: "Sign-in was not completed",
    body: "Return to your terminal and try again.",
  },
} as const;

/** Who a sign-in answers for, as the account service's userinfo names them; a key a newer service added is passed over. */
const cliIdentitySchema = Schema.Struct({
  sub: Schema.optionalKey(Schema.String),
  email: Schema.String,
  name: Schema.optionalKey(Schema.String),
});

/** One signed-in account as the command's store keeps it, read back through this schema. */
export const cliAccountSchema = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  /** The account's own id, the service's `sub`, which is who a renewed token must still answer for. */
  id: Schema.optionalKey(Schema.String),
  email: Schema.String,
  name: Schema.optionalKey(Schema.String),
});

export type CliAccount = typeof cliAccountSchema.Type;

/** Who the signed-in account is, as `whoami` says it. */
export type CliIdentity = Omit<CliAccount, "accessToken" | "refreshToken">;

/** The store could not be read or written: the Keychain refused, or the file could not be. Its words never carry a token. */
export class CliStoreFailed extends Data.TaggedError("CliStoreFailed")<{
  readonly message: string;
}> {}

/** Where the command keeps its account for one service. */
export interface CliAccountStore {
  readonly read: Effect.Effect<CliAccount | undefined, CliStoreFailed>;
  readonly write: (account: CliAccount) => Effect.Effect<void, CliStoreFailed>;
  readonly clear: Effect.Effect<void, CliStoreFailed>;
}

/** A sign-in, a sign-out, or an identity read that ended short, with the exit code it ends the command with. Its words never carry a token. */
export class CliAccountFailed extends Data.TaggedError("CliAccountFailed")<{
  readonly exit: CliExit;
  readonly message: string;
}> {}

function storeFailed(failed: CliStoreFailed): CliAccountFailed {
  return new CliAccountFailed({ exit: CLI_EXIT.REFUSED, message: failed.message });
}

/** The stored account, or nothing where the store cannot be read, which a call reads as no sign-in. */
function readOrNothing(store: CliAccountStore): Effect.Effect<CliAccount | undefined> {
  return Effect.orElseSucceed(store.read, () => undefined);
}

/**
 * The renewal a 401 asks for: the stored refresh token traded for new
 * tokens, which are stored over the old. A refusal that says the sign-in is
 * gone clears the store, unless another command renewed it meanwhile.
 */
function renewed(store: CliAccountStore, client: AccountClient) {
  return Effect.gen(function* () {
    const account = yield* readOrNothing(store);
    if (account === undefined) {
      return yield* new AccountRefreshFailed({ message: "Not signed in." });
    }
    const refreshed = yield* Effect.result(client.refresh(account.refreshToken));
    if (refreshed._tag === "Success") {
      return yield* Effect.mapError(
        store.write({ ...account, ...refreshed.success }),
        (failed) => new AccountRefreshFailed({ message: failed.message }),
      );
    }
    const now = yield* readOrNothing(store);
    if (now !== undefined && now.refreshToken !== account.refreshToken) return;
    if (accountFailureAction(refreshed.failure) === ACCOUNT_FAILURE_ACTION.SIGN_OUT) {
      yield* Effect.ignore(store.clear);
    }
    return yield* new AccountRefreshFailed({ message: refreshed.failure.message });
  });
}

/**
 * The stored account's bearer, read fresh for every attempt, renewed
 * through the store on a 401, and answering for the account's own id (or
 * its address, for an account stored without one).
 */
export function storedAccountCredential(
  store: CliAccountStore,
  client: AccountClient,
): CallCredential {
  return {
    authorization: () =>
      Effect.map(readOrNothing(store), (account) =>
        account === undefined ? undefined : `Bearer ${account.accessToken}`,
      ),
    renew: () => renewed(store, client),
    holder: () => Effect.map(readOrNothing(store), (account) => account?.id ?? account?.email),
  };
}

/**
 * Who a credential answers for, read at the account service's userinfo
 * under `account-call.ts`'s one renewal. A refusal, a fault, and an answer
 * that is not an identity each end with the exit code they stand for.
 */
export const cliIdentity = Effect.fnUntraced(function* (
  accountBaseUrl: string,
  credential: CallCredential,
) {
  const answer = yield* accountCall({ baseUrl: accountBaseUrl, credential }).send({
    method: HTTP_METHOD.GET,
    path: USERINFO_PATH,
  });
  if (!callAnswered(answer)) {
    return yield* new CliAccountFailed({
      exit: cliExitOfFault(answer.fault),
      message:
        answer.fault === CALL_FAULT.NETWORK
          ? `Could not reach ${PRODUCT_NAME}.`
          : "Not signed in. Run vespin login to sign in.",
    });
  }
  const { response } = answer;
  if (!response.ok) {
    return yield* new CliAccountFailed({
      exit: cliExitOfStatus(response.status),
      message: `${PRODUCT_NAME} did not say who is signed in (${response.status}).`,
    });
  }
  const body = yield* Effect.promise(() => response.json().catch(() => undefined));
  const identity = yield* Effect.mapError(
    Schema.decodeUnknownEffect(cliIdentitySchema)(body),
    () =>
      new CliAccountFailed({
        exit: CLI_EXIT.UNAVAILABLE,
        message: `${PRODUCT_NAME} answered an identity this version cannot read.`,
      }),
  );
  return {
    ...(identity.sub === undefined ? undefined : { id: identity.sub }),
    email: identity.email,
    ...(identity.name === undefined ? undefined : { name: identity.name }),
  } satisfies CliIdentity;
});

/** A failure on the account service, as the sign-in or sign-out says it. */
function accountFailed(failed: AccountClientFailure | CliAccountFailed): CliAccountFailed {
  if (failed._tag === "CliAccountFailed") return failed;
  return new CliAccountFailed({
    exit: failed._tag === "AccountTransportError" ? CLI_EXIT.UNAVAILABLE : CLI_EXIT.REFUSED,
    message: failed.message,
  });
}

interface CliSignInOptions {
  readonly client: AccountClient;
  /** The account service's base address, which userinfo stands under. */
  readonly accountBaseUrl: string;
  readonly store: CliAccountStore;
  /** The loopback (`@repo/credentials/node`), or the paste-back where the browser is elsewhere. */
  readonly openConsent: OpenConsent;
  /** Opens the sign-in page, or shows its address. */
  readonly openExternal: (url: string) => void | Promise<void>;
}

/**
 * The tokens a code was traded for made the stored account: who they
 * answer for read with them, stored, and the account they replace (if
 * any) revoked, since its refresh token would otherwise outlive the
 * sign-in that dropped it.
 */
function storedSignIn(options: CliSignInOptions, tokens: AccountTokens) {
  return Effect.gen(function* () {
    const identity = yield* cliIdentity(options.accountBaseUrl, fixedBearer(tokens.accessToken));
    const replaced = yield* Effect.mapError(options.store.read, storeFailed);
    yield* Effect.mapError(options.store.write({ ...tokens, ...identity }), storeFailed);
    if (replaced !== undefined && replaced.refreshToken !== tokens.refreshToken) {
      yield* Effect.ignore(options.client.revoke(replaced.refreshToken));
    }
    return { ...tokens, ...identity } satisfies CliAccount;
  });
}

/**
 * One sign-in, press to stored account: the consent trip the options name,
 * whose exchange stores what it was issued, or revokes it where the
 * account could not be stored.
 */
export function cliSignIn(
  options: CliSignInOptions,
): Effect.Effect<CliIdentity, CliAccountFailed, Scope.Scope | HttpClient.HttpClient> {
  const { client } = options;
  return Effect.gen(function* () {
    // Note that the exchange runs inside the trip, so it is handed the caller's client here.
    const services = yield* Effect.context<HttpClient.HttpClient>();
    const consent = options.openConsent<CliAccount>({
      callbackPath: CALLBACK_PATH,
      pages: CLI_SIGN_IN_PAGES,
      reasons: { refused: "Sign-in was not completed.", timedOut: "Sign-in timed out." },
      authorizationUrl: ({ state, redirectUri, codeChallenge }) =>
        client.authorizeUrl({ state, redirectUri, codeChallenge }),
      exchange: (input) =>
        withIssuedAccountTokens<CliAccount, CliAccountFailed>({
          issue: client.exchangeCode(input),
          use: (tokens) => Effect.provideContext(storedSignIn(options, tokens), services),
          revoke: (refreshToken) => client.revoke(refreshToken),
        }).pipe(
          Effect.catch(
            (failed): Effect.Effect<LoopbackConsentOutcome<CliAccount>> =>
              Effect.succeed({ reason: accountFailed(failed).message }),
          ),
        ),
      openExternal: options.openExternal,
    });
    const outcome = yield* consent.signInEffect();
    if ("reason" in outcome) {
      return yield* new CliAccountFailed({ exit: CLI_EXIT.AUTH, message: outcome.reason });
    }
    return {
      ...(outcome.id === undefined ? undefined : { id: outcome.id }),
      email: outcome.email,
      ...(outcome.name === undefined ? undefined : { name: outcome.name }),
    } satisfies CliIdentity;
  });
}

/** What a sign-out did: whether there was an account, and whether the service took the revocation. */
interface CliSignOut {
  readonly signedIn: boolean;
  readonly revoked: boolean;
}

/**
 * The stored account signed out: its refresh token revoked at the service
 * and the store cleared. The store is cleared whatever the revocation
 * answered, since a sign-out on this machine never depends on the service.
 */
export const cliSignOut = Effect.fnUntraced(function* (
  store: CliAccountStore,
  client: AccountClient,
) {
  const account = yield* Effect.mapError(store.read, storeFailed);
  if (account === undefined) return { signedIn: false, revoked: false } satisfies CliSignOut;
  const revoked = yield* Effect.result(client.revoke(account.refreshToken));
  yield* Effect.mapError(store.clear, storeFailed);
  return { signedIn: true, revoked: revoked._tag === "Success" } satisfies CliSignOut;
});
