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

const CALLBACK_PATH = "/callback";

const USERINFO_PATH = "/oauth2/userinfo";

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

const cliIdentitySchema = Schema.Struct({
  sub: Schema.optionalKey(Schema.String),
  email: Schema.String,
  name: Schema.optionalKey(Schema.String),
});

export const cliAccountSchema = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  id: Schema.optionalKey(Schema.String),
  email: Schema.String,
  name: Schema.optionalKey(Schema.String),
});

export type CliAccount = typeof cliAccountSchema.Type;

export type CliIdentity = Omit<CliAccount, "accessToken" | "refreshToken">;

export class CliStoreFailed extends Data.TaggedError("CliStoreFailed")<{
  readonly message: string;
}> {}

export interface CliAccountStore {
  readonly read: Effect.Effect<CliAccount | undefined, CliStoreFailed>;
  readonly write: (account: CliAccount) => Effect.Effect<void, CliStoreFailed>;
  readonly clear: Effect.Effect<void, CliStoreFailed>;
}

export class CliAccountFailed extends Data.TaggedError("CliAccountFailed")<{
  readonly exit: CliExit;
  readonly message: string;
}> {}

function storeFailed(failed: CliStoreFailed): CliAccountFailed {
  return new CliAccountFailed({ exit: CLI_EXIT.REFUSED, message: failed.message });
}

function readOrNothing(store: CliAccountStore): Effect.Effect<CliAccount | undefined> {
  return Effect.orElseSucceed(store.read, () => undefined);
}

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

function accountFailed(failed: AccountClientFailure | CliAccountFailed): CliAccountFailed {
  if (failed._tag === "CliAccountFailed") return failed;
  return new CliAccountFailed({
    exit: failed._tag === "AccountTransportError" ? CLI_EXIT.UNAVAILABLE : CLI_EXIT.REFUSED,
    message: failed.message,
  });
}

interface CliSignInOptions {
  readonly client: AccountClient;
  readonly accountBaseUrl: string;
  readonly store: CliAccountStore;
  readonly openConsent: OpenConsent;
  readonly openExternal: (url: string) => void | Promise<void>;
}

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

export function cliSignIn(
  options: CliSignInOptions,
): Effect.Effect<CliIdentity, CliAccountFailed, Scope.Scope | HttpClient.HttpClient> {
  const { client } = options;
  return Effect.gen(function* () {
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

interface CliSignOut {
  readonly signedIn: boolean;
  readonly revoked: boolean;
}

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
