/**
 * integrations-app.ts -- the integrations group: an account's connections read, begun, ended, and settled.
 *
 * Five endpoints the signed-in desktop calls with its bearer, and one
 * browser navigation that carries none:
 *
 * - `GET /api/account/integrations` answers where every provider's
 *   connection stands. A sign-in still under way is settled here too, by
 *   asking Connect for a token afresh, so a desktop that reads again after
 *   the browser closed learns the outcome whatever address the browser was
 *   returned to; one with no token yet is asked after by the handle Connect
 *   began it with, and one Connect says was cancelled or refused is ended
 *   here and answered once among the read's `signInFailures`, with
 *   Connect's own line where it is shaped like no credential, since a
 *   sign-in that failed on Connect's own page never returns to Luke. A provider the deployment does not offer the account
 *   (`accountIntegrationConnect`) stands unavailable, and every route below
 *   refuses it as one with no connector here.
 * - `POST /api/account/integrations/{provider}/connect` asks Vercel Connect
 *   to begin a browser sign-in to the provider for the account, records the
 *   sign-in's one-time state, and answers the address the desktop opens.
 * - `POST /api/account/integrations/{provider}/cancel` ends the sign-in
 *   under way, if one still is, and nothing else: a first sign-in's row
 *   goes, any other row keeps its status, and no grant is revoked, so a
 *   sign-in that completed just before the press stays connected. It
 *   answers where the provider then stands.
 * - `POST /api/account/integrations/{provider}/disconnect` deletes the
 *   account's row at the provider before anything else, which is what stops
 *   every agent's next token read, then asks Connect to revoke the grant; a
 *   revoke that fails is logged, and the account is disconnected all the
 *   same.
 * - `GET /api/account/integrations/{provider}/tools` answers the tools the
 *   provider's server offers the account's agents, read from the server with
 *   the account's token as an MCP client reads them, and held for a few
 *   minutes per account and provider so a popover opened again asks the
 *   server nothing; GitHub's, whose grant has no instant a new one is told
 *   by, are read every time. A server that listed none answers why, with its own one-line message where it sent one that
 *   carries no credential (`packages/service/src/integrations/mcp-tools.ts`), and is never held, so a
 *   connection mended at the provider reads as mended at once. A provider
 *   the account has not connected is refused before any token is read.
 * - `GET /api/account/integrations/connected` is where Connect returns the
 *   browser from any provider: the sign-in's state names the account and the
 *   provider, Connect is asked for a token afresh, and the browser is sent
 *   on to the landing page with the provider and one word. A browser back
 *   without a grant ends the sign-in, so the provider no longer stands
 *   pending, unless Connect's result names a cancel or a refusal: that one
 *   is left for the statuses read, which says why as it ends it. Connect
 *   sends nothing back on the address, no error and no reason.
 *
 * The rewrite moves a provider's path segment into the `provider` query, so
 * the two provider routes read it there. Root AGENTS.md pins that no
 * credential travels in an answer: what each endpoint answers is status
 * words, a server's or Connect's credential-free line, or the sign-in
 * address, never a token. The sign-in address is not logged either, since
 * it begins a grant for the account it was issued for, and neither is the
 * handle Connect answers a sign-in with, which is never answered at all.
 */

import { randomBytes } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import {
  INTEGRATION_GRANT,
  INTEGRATION_GRANT_OF,
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_SIGN_IN_FAILURE,
  INTEGRATION_STATUS,
  INTEGRATION_TOOLS_PROBLEM,
  type IntegrationLandingStatus,
  type IntegrationProvider,
  type IntegrationSignInFailure,
  type IntegrationStatus,
  type IntegrationToolsProblemReason,
  integrationLandingPath,
  integrationProviderFromWire,
} from "@luke/features/integration-wire";
import { Effect, Layer, Option, Redacted, Result } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubApp } from "../github/github-app.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedMethod,
  hostedNotFoundRoute,
  hostedRefusalResponse,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import {
  GITHUB_GRANT_REFUSAL,
  githubIntegrationStatus,
  githubOffered,
  githubSignInGrant,
} from "./github-integration.js";
import {
  accountIntegrationConnect,
  CONNECT_SIGN_IN_RESULT,
  type ConnectorService,
  INTEGRATION_CONNECT_FAILURE,
  type IntegrationConnect,
  revokeIntegrationGrant,
} from "./integration-connect.js";
import {
  INTEGRATION_ROW_STATUS,
  type IntegrationConnectionRow,
  type IntegrationStoreEffect,
} from "./integration-store.js";
import { INTEGRATION, type IntegrationDefinition } from "./integrations.js";
import {
  listMcpTools,
  MCP_TOOLS_FAILURE,
  type McpTool,
  type McpToolsFailure,
  type McpToolsFailureReason,
} from "./mcp-tools.js";

/** How long a sign-in may stay under way before its state no longer settles it: Connect's own requests last about as long. */
const INTEGRATION_SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

/** The paths the group answers, as the rewrites hand them to it. */
const INTEGRATIONS_PATH = {
  /** GET reads where every provider stands. */
  STATUSES: HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS,
  /** POST begins a sign-in; the rewrite moves the path's provider into the `provider` query. */
  CONNECT: "/api/account/integrations/connect",
  /** POST ends a sign-in under way; the rewrite moves the path's provider into the `provider` query. */
  CANCEL: "/api/account/integrations/cancel",
  /** POST ends a connection; the rewrite moves the path's provider into the `provider` query. */
  DISCONNECT: "/api/account/integrations/disconnect",
  /** GET reads the tools a provider's server offers; the rewrite moves the path's provider into the `provider` query. */
  TOOLS: "/api/account/integrations/tools",
  /** GET is Connect's return from any provider's sign-in. */
  CONNECTED: HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS_CONNECTED,
} as const;

/** How long a provider's tools stay read for an account before the next ask reads the server again. */
const INTEGRATION_TOOLS_TTL_MS = 5 * 60 * 1000;

/** One provider's tools as read for an account, when, and under which grant: a sign-in completed since names another. */
interface ToolsRead {
  readonly at: number;
  readonly connectedAt: number | undefined;
  readonly tools: readonly McpTool[];
}

/** The tools read lately, by account and then by provider, for as long as the instance stands. */
type ToolsCache = Map<string, Map<IntegrationProvider, ToolsRead>>;

/** Every read past its time let go, so an instance that stands long holds the lists of no account that stopped asking. */
function heldToolsSwept(cache: ToolsCache, now: number): void {
  for (const [userId, reads] of cache) {
    for (const [provider, read] of reads) {
      if (now - read.at >= INTEGRATION_TOOLS_TTL_MS) reads.delete(provider);
    }
    if (reads.size === 0) cache.delete(userId);
  }
}

/** The query the rewrite carries the provider in. */
const PROVIDER_QUERY = "provider";

/** The query Connect returns the browser with, which is the one Luke put on the callback. */
const CALLBACK_QUERY = { STATE: "state" } as const;

/** A sign-in's state as one is minted: 32 random bytes, url-safe. */
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const STATE_BYTES = 32;

const HTTP_METHOD = { GET: "GET", POST: "POST" } as const;

/** A browser is sent on with 303, so whatever Connect sends becomes the GET the page is. */
const SEE_OTHER = 303;

export interface IntegrationsAppSeams {
  resolveUserId: UserIdResolver;
  readConnections: (userId: string) => IntegrationStoreEffect<readonly IntegrationConnectionRow[]>;
  readSignIn: (state: string) => IntegrationStoreEffect<IntegrationConnectionRow | undefined>;
  beginSignIn: (
    userId: string,
    provider: IntegrationProvider,
    state: string,
    verifier: Redacted.Redacted,
  ) => IntegrationStoreEffect<void>;
  completeSignIn: (
    userId: string,
    provider: IntegrationProvider,
    state: string,
  ) => IntegrationStoreEffect<boolean>;
  /** Ends the sign-in begun under `state` without a grant: the browser came back without one. */
  endSignIn: (
    userId: string,
    provider: IntegrationProvider,
    state: string,
  ) => IntegrationStoreEffect<void>;
  deleteConnection: (userId: string, provider: IntegrationProvider) => IntegrationStoreEffect<void>;
  /** A fresh sign-in state; random in production, fixed in a test. */
  mintState: () => string;
  /** Now, in milliseconds since the epoch. */
  now: () => number;
}

/** A sign-in state as production mints it. */
export function mintIntegrationState(): string {
  return randomBytes(STATE_BYTES).toString("base64url");
}

/** The bearer resolved against the deployment's own account store, or the invalid-token refusal. */
const resolvedUserId = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
): Effect.fn.Return<string, HostedRefusal, HttpServerRequest.HttpServerRequest> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

/** The provider the rewrite put in the query, or the not-found refusal for one this build has no route for. */
const requestedProvider = /* @__PURE__ */ Effect.fnUntraced(function* (): Effect.fn.Return<
  IntegrationProvider,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest
> {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const query = new URL(request.url, "https://localhost").searchParams;
  const provider = integrationProviderFromWire(query.get(PROVIDER_QUERY));
  if (provider === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return provider;
});

/** Whether a sign-in begun at this instant may still settle. */
function signInStands(seams: IntegrationsAppSeams, issuedAt: Date | undefined): boolean {
  return (
    issuedAt !== undefined && seams.now() - issuedAt.getTime() <= INTEGRATION_SIGN_IN_WINDOW_MS
  );
}

/**
 * Asks Connect afresh whether the account now holds a grant at the
 * provider, and records it connected where it does; answers whether it
 * does. Connect's own refusal and an outage alike answer no: a sign-in not
 * yet finished reads the same as one Connect could not be asked about, and
 * the next read asks again.
 */
const settledSignIn = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
  connector: ConnectorService,
  row: IntegrationConnectionRow,
  state: string,
): Effect.fn.Return<boolean, HostedRefusal, DatabaseServices> {
  const issued = yield* Effect.result(connector.token(row.userId, { fresh: true }));
  if (Result.isFailure(issued)) {
    if (issued.failure.reason !== INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED) {
      yield* Effect.logWarning(
        `Vercel Connect could not settle a ${INTEGRATION_NAME[row.provider]} sign-in`,
        issued.failure.message,
      );
    }
    return false;
  }
  return yield* hostedStoreOrUnavailable(seams.completeSignIn(row.userId, row.provider, state));
});

/** Why a sign-in ended without a grant, as the statuses read answers it: the provider aside. */
type SignInFailure = Omit<IntegrationSignInFailure, "provider">;

/**
 * Asks Connect how the sign-in it answered this row's handle for stands,
 * and answers why it ended where Connect says it was cancelled or
 * refused; nothing while it is under way, succeeded, or Connect could not
 * be asked, which the next read asks again.
 */
const connectSignInFailure = /* @__PURE__ */ Effect.fnUntraced(function* (
  connector: ConnectorService,
  row: IntegrationConnectionRow,
): Effect.fn.Return<SignInFailure | undefined> {
  if (row.verifier === undefined) return undefined;
  const result = yield* Effect.result(connector.signInResult(row.verifier));
  if (Result.isFailure(result)) {
    yield* Effect.logWarning(
      `Vercel Connect could not say how a ${INTEGRATION_NAME[row.provider]} sign-in stands`,
      result.failure.message,
    );
    return undefined;
  }
  const ended = result.success;
  if (ended.kind === CONNECT_SIGN_IN_RESULT.CANCELED) {
    return { reason: INTEGRATION_SIGN_IN_FAILURE.CANCELED };
  }
  if (ended.kind !== CONNECT_SIGN_IN_RESULT.FAILED) return undefined;
  return {
    reason: INTEGRATION_SIGN_IN_FAILURE.ERROR,
    ...(ended.message !== undefined ? { message: ended.message } : undefined),
  };
});

/** Where one provider stands for the statuses read, and why a sign-in this read ended failed. */
interface Standing {
  readonly status: IntegrationStatus;
  readonly failure?: SignInFailure;
}

/** Where a row stands once its sign-in is over without a grant: expired where it was, else disconnected. */
function standingWithoutSignIn(row: IntegrationConnectionRow): IntegrationStatus {
  return row.status === INTEGRATION_ROW_STATUS.EXPIRED
    ? INTEGRATION_STATUS.EXPIRED
    : INTEGRATION_STATUS.DISCONNECTED;
}

/**
 * Where a stored row stands, settling a sign-in still under way with the
 * provider's connector: connected where Connect now holds a grant, ended
 * with its reason where Connect says it was cancelled or refused, and
 * pending otherwise.
 */
const standingStatus = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
  connector: ConnectorService,
  row: IntegrationConnectionRow | undefined,
): Effect.fn.Return<Standing, HostedRefusal, DatabaseServices> {
  if (row === undefined) return { status: INTEGRATION_STATUS.DISCONNECTED };
  if (row.status === INTEGRATION_ROW_STATUS.CONNECTED)
    return { status: INTEGRATION_STATUS.CONNECTED };
  // The state of a sign-in still under way, which is the one a settlement may complete.
  const underWay = signInStands(seams, row.stateIssuedAt) ? row.state : undefined;
  // A first sign-in that ran out of time never connected anything.
  if (underWay === undefined) return { status: standingWithoutSignIn(row) };
  // Note that a sign-in under way stands pending even over an expired row, because the window waits on its end either way.
  if (yield* settledSignIn(seams, connector, row, underWay)) {
    return { status: INTEGRATION_STATUS.CONNECTED };
  }
  const failure = yield* connectSignInFailure(connector, row);
  if (failure === undefined) return { status: INTEGRATION_STATUS.PENDING };
  yield* hostedStoreOrUnavailable(seams.endSignIn(row.userId, row.provider, underWay));
  return { status: standingWithoutSignIn(row), failure };
});

/**
 * GET: where every one of the caller's connections stands; a provider with
 * no connector here, or not offered to the caller, is unavailable, and one
 * the caller's GitHub sign-in grants stands where that sign-in does.
 */
const statusesEndpoint = /* @__PURE__ */ Effect.fn("web/integrationsStatusesEndpoint")(function* (
  seams: IntegrationsAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  | HttpServerRequest.HttpServerRequest
  | DatabaseServices
  | IntegrationConnect
  | GitHubApp
  | HttpClient.HttpClient
> {
  yield* hostedMethod(HTTP_METHOD.GET);
  const userId = yield* resolvedUserId(seams);
  const connect = yield* hostedStoreOrUnavailable(accountIntegrationConnect(userId));
  // A deployment with no connector at all answers from its configuration alone, whatever the store.
  const anyConfigured = INTEGRATION_PROVIDER_LIST.some((provider) => connect[provider].configured);
  const rows = anyConfigured ? yield* hostedStoreOrUnavailable(seams.readConnections(userId)) : [];
  const standings = yield* Effect.forEach(INTEGRATION_PROVIDER_LIST, (provider) =>
    Effect.map(
      INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN
        ? Effect.map(githubIntegrationStatus(userId), (status): Standing => ({ status }))
        : connect[provider].configured
          ? standingStatus(
              seams,
              connect[provider],
              rows.find((row) => row.provider === provider),
            )
          : Effect.succeed<Standing>({ status: INTEGRATION_STATUS.UNAVAILABLE }),
      (standing) => ({ provider, ...standing }),
    ),
  );
  const integrations = Object.fromEntries(
    standings.map(({ provider, status }) => [provider, status]),
  );
  const signInFailures = standings.flatMap(({ provider, failure }) =>
    failure === undefined ? [] : [{ provider, ...failure }],
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    integrations,
    ...(signInFailures.length > 0 ? { signInFailures } : undefined),
  });
});

/** The wire's word for each way a server's tools read can fail. */
const TOOLS_PROBLEM_OF = {
  [MCP_TOOLS_FAILURE.REFUSED]: INTEGRATION_TOOLS_PROBLEM.REFUSED,
  [MCP_TOOLS_FAILURE.REJECTED]: INTEGRATION_TOOLS_PROBLEM.REJECTED,
  [MCP_TOOLS_FAILURE.UNREACHABLE]: INTEGRATION_TOOLS_PROBLEM.UNREACHABLE,
  [MCP_TOOLS_FAILURE.UNREADABLE]: INTEGRATION_TOOLS_PROBLEM.UNREADABLE,
} as const satisfies Record<McpToolsFailureReason, IntegrationToolsProblemReason>;

/** Why a server listed no tools, as the window is told: its word, and its own message where one was kept. */
function toolsProblem(failure: McpToolsFailure) {
  return {
    reason: TOOLS_PROBLEM_OF[failure.reason],
    ...(failure.serverMessage !== undefined ? { message: failure.serverMessage } : undefined),
  };
}

/**
 * When the account's grant at one provider was made, which keys the tools
 * held for it; nothing for a grant that is the account's GitHub sign-in,
 * whose tools are never held. A
 * provider with no connector here or not offered to the account, and one the
 * account has not connected, are refused as unavailable.
 */
const standingGrant = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
  provider: IntegrationProvider,
  userId: string,
): Effect.fn.Return<
  number | undefined,
  HostedRefusal,
  DatabaseServices | IntegrationConnect | GitHubApp
> {
  if (INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN) {
    if (!(yield* githubOffered)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    return undefined;
  }
  const connector = (yield* hostedStoreOrUnavailable(accountIntegrationConnect(userId)))[provider];
  if (!connector.configured) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const rows = yield* hostedStoreOrUnavailable(seams.readConnections(userId));
  const row = rows.find((each) => each.provider === provider);
  if (row?.status !== INTEGRATION_ROW_STATUS.CONNECTED) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  return row.connectedAt?.getTime();
});

/** A grant the provider's token read says the account no longer holds. */
const GRANT_REFUSED = "grant-refused";

/**
 * The account's token at one provider for reading its tools: Connect's, or
 * the account's GitHub sign-in's; a grant no longer held is answered as
 * refused, and a token that could not be asked for is unavailable.
 */
const toolsToken = /* @__PURE__ */ Effect.fnUntraced(function* (
  provider: IntegrationProvider,
  userId: string,
): Effect.fn.Return<
  Result.Result<Redacted.Redacted, typeof GRANT_REFUSED>,
  HostedRefusal,
  DatabaseServices | IntegrationConnect | GitHubApp | HttpClient.HttpClient
> {
  const name = INTEGRATION_NAME[provider];
  if (INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN) {
    const grant = yield* githubSignInGrant(userId);
    if (Result.isSuccess(grant)) return Result.succeed(grant.success.token);
    if (grant.failure === GITHUB_GRANT_REFUSAL.SIGN_IN_REQUIRED) return Result.fail(GRANT_REFUSED);
    yield* Effect.logWarning(
      `the GitHub sign-in gave no ${name} token for its tools`,
      grant.failure,
    );
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  const connector = (yield* hostedStoreOrUnavailable(accountIntegrationConnect(userId)))[provider];
  const issued = yield* Effect.result(connector.token(userId, { fresh: false }));
  if (Result.isSuccess(issued)) return Result.succeed(issued.success.token);
  if (issued.failure.reason === INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED) {
    return Result.fail(GRANT_REFUSED);
  }
  yield* Effect.logWarning(
    `Vercel Connect gave no ${name} token for its tools`,
    issued.failure.message,
  );
  return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
});

/**
 * GET: the tools one provider's server offers the account's agents. A
 * provider with no connector here or not offered to the account, one the
 * account has not connected, and a Connect that could not be asked are the
 * one unavailable refusal. A grant Connect no longer holds, and a server
 * that listed none, are an answer rather than a refusal: why, which the
 * desktop draws in place of the connection's "Connected", and never held.
 */
const toolsEndpoint = /* @__PURE__ */ Effect.fn("web/integrationToolsEndpoint")(function* (
  seams: IntegrationsAppSeams,
  cache: ToolsCache,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  | HttpServerRequest.HttpServerRequest
  | DatabaseServices
  | IntegrationConnect
  | GitHubApp
  | HttpClient.HttpClient
> {
  yield* hostedMethod(HTTP_METHOD.GET);
  const provider = yield* requestedProvider();
  const userId = yield* resolvedUserId(seams);
  const grant = yield* standingGrant(seams, provider, userId);
  // Note that GitHub's tools are never held, because its grant has no instant to tell a new one by.
  const holds = INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.CONNECT;
  const held = holds ? cache.get(userId)?.get(provider) : undefined;
  if (
    held !== undefined &&
    held.connectedAt === grant &&
    seams.now() - held.at < INTEGRATION_TOOLS_TTL_MS
  ) {
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { tools: held.tools });
  }
  const name = INTEGRATION_NAME[provider];
  const issued = yield* toolsToken(provider, userId);
  // A grant no longer held is a refusal the developer mends by connecting again, not an outage.
  if (Result.isFailure(issued)) {
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
      problem: { reason: INTEGRATION_TOOLS_PROBLEM.REFUSED },
    });
  }
  const definition: IntegrationDefinition = INTEGRATION[provider];
  const listed = yield* Effect.result(
    listMcpTools(definition.MCP_URL, Redacted.value(issued.success)),
  );
  if (Result.isFailure(listed)) {
    const failure = listed.failure;
    yield* Effect.logWarning(
      `${name}'s MCP server listed no tools: ${failure.reason}`,
      failure.code ?? "no code",
    );
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { problem: toolsProblem(failure) });
  }
  const tools = listed.success;
  heldToolsSwept(cache, seams.now());
  if (holds) {
    const accountReads = cache.get(userId) ?? new Map<IntegrationProvider, ToolsRead>();
    accountReads.set(provider, { at: seams.now(), connectedAt: grant, tools });
    cache.set(userId, accountReads);
  }
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { tools });
});

/** The callback Connect returns the browser to, on the host the desktop asked through. */
function callbackUrl(requestUrl: string, state: string): string {
  const url = new URL(INTEGRATIONS_PATH.CONNECTED, requestUrl);
  url.searchParams.set(CALLBACK_QUERY.STATE, state);
  return url.toString();
}

/**
 * POST: begins a browser sign-in to one provider. Connect is asked first,
 * so a sign-in it refused leaves the row as it stood; the state is recorded
 * before the address is answered, so no browser can return before the
 * callback can read it.
 */
const connectEndpoint = /* @__PURE__ */ Effect.fn("web/integrationConnectEndpoint")(function* (
  seams: IntegrationsAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices | IntegrationConnect
> {
  yield* hostedMethod(HTTP_METHOD.POST);
  const provider = yield* requestedProvider();
  const userId = yield* resolvedUserId(seams);
  const connector = (yield* hostedStoreOrUnavailable(accountIntegrationConnect(userId)))[provider];
  if (!connector.configured) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const state = seams.mintState();
  const { url, verifier } = yield* connector
    .authorize(userId, callbackUrl(request.url, state))
    .pipe(
      Effect.tapError((failure) =>
        Effect.logWarning(
          `Vercel Connect could not begin a ${INTEGRATION_NAME[provider]} sign-in`,
          failure.message,
        ),
      ),
      Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
    );
  yield* hostedStoreOrUnavailable(seams.beginSignIn(userId, provider, state, verifier));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { url });
});

/**
 * Where a provider stands once a Cancel ended its sign-in: its row's own
 * status, or disconnected with none, unless a sign-in begun again while the
 * Cancel was out still stands, which is pending.
 */
function standingAfterCancel(
  seams: IntegrationsAppSeams,
  row: IntegrationConnectionRow | undefined,
): IntegrationStatus {
  if (row?.status === INTEGRATION_ROW_STATUS.CONNECTED) return INTEGRATION_STATUS.CONNECTED;
  if (row?.state !== undefined && signInStands(seams, row.stateIssuedAt)) {
    return INTEGRATION_STATUS.PENDING;
  }
  if (row?.status === INTEGRATION_ROW_STATUS.EXPIRED) return INTEGRATION_STATUS.EXPIRED;
  return INTEGRATION_STATUS.DISCONNECTED;
}

/**
 * POST: ends the sign-in to one provider under way, under the state the row
 * holds now, so a sign-in completed since has no state left to end and
 * stands connected, and one begun again since keeps its own state and
 * stands pending; answers where the provider then stands. Nothing is
 * revoked: a grant Connect holds without the row is one no agent reads.
 */
const cancelEndpoint = /* @__PURE__ */ Effect.fn("web/integrationCancelEndpoint")(function* (
  seams: IntegrationsAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices | IntegrationConnect
> {
  yield* hostedMethod(HTTP_METHOD.POST);
  const provider = yield* requestedProvider();
  const userId = yield* resolvedUserId(seams);
  const connector = (yield* hostedStoreOrUnavailable(accountIntegrationConnect(userId)))[provider];
  if (!connector.configured) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const rows = yield* hostedStoreOrUnavailable(seams.readConnections(userId));
  const row = rows.find((each) => each.provider === provider);
  if (row?.state !== undefined) {
    yield* hostedStoreOrUnavailable(seams.endSignIn(userId, provider, row.state));
  }
  const after = yield* hostedStoreOrUnavailable(seams.readConnections(userId));
  const status = standingAfterCancel(
    seams,
    after.find((each) => each.provider === provider),
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { status });
});

/**
 * POST: ends one provider's connection. The row goes first, so whatever
 * Connect answers, no agent reads a token again; the revoke after it is the
 * courtesy of telling the provider, and a failed one is logged rather than
 * answered, since the account asked to be disconnected and is. GitHub,
 * whose grant is the account's own GitHub sign-in, is refused as
 * unavailable: nothing here ends that sign-in.
 */
const disconnectEndpoint = /* @__PURE__ */ Effect.fn("web/integrationDisconnectEndpoint")(
  function* (
    seams: IntegrationsAppSeams,
  ): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    HttpServerRequest.HttpServerRequest | DatabaseServices | IntegrationConnect
  > {
    yield* hostedMethod(HTTP_METHOD.POST);
    const provider = yield* requestedProvider();
    const userId = yield* resolvedUserId(seams);
    // A grant that is the account's GitHub sign-in ends with that sign-in, never here.
    if (INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN) {
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }
    yield* hostedStoreOrUnavailable(seams.deleteConnection(userId, provider));
    yield* revokeIntegrationGrant(userId, provider);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { status: INTEGRATION_STATUS.DISCONNECTED });
  },
);

/** Where the browser lands, with the provider where the sign-in named one. */
interface Landing {
  readonly provider: IntegrationProvider | undefined;
  readonly status: IntegrationLandingStatus;
}

function landing({ provider, status }: Landing): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.redirect(integrationLandingPath(provider, status), {
    status: SEE_OTHER,
  });
}

/** How the sign-in the browser returned from settled. */
const callbackLanding = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
  state: string | null,
): Effect.fn.Return<Landing, HostedRefusal, DatabaseServices | IntegrationConnect> {
  const expired = { provider: undefined, status: INTEGRATION_LANDING_STATUS.EXPIRED } as const;
  if (state === null || !STATE_PATTERN.test(state)) return expired;
  const row = yield* hostedStoreOrUnavailable(seams.readSignIn(state));
  if (row === undefined) return expired;
  const landed = (status: IntegrationLandingStatus): Landing => ({
    provider: row.provider,
    status,
  });
  if (!signInStands(seams, row.stateIssuedAt)) return landed(INTEGRATION_LANDING_STATUS.EXPIRED);
  const connector = (yield* hostedStoreOrUnavailable(accountIntegrationConnect(row.userId)))[
    row.provider
  ];
  // A provider no longer offered to the account completes nothing for it.
  if (!connector.configured) return landed(INTEGRATION_LANDING_STATUS.UNAVAILABLE);
  const issued = yield* Effect.result(connector.token(row.userId, { fresh: true }));
  if (Result.isFailure(issued)) {
    // Back without a grant: the sign-in is over, so the window waiting on it hears so at its next read.
    if (issued.failure.reason === INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED) {
      // Note that one Connect says was cancelled or refused is left standing, because the statuses read says why as it ends it.
      if ((yield* connectSignInFailure(connector, row)) === undefined) {
        yield* hostedStoreOrUnavailable(seams.endSignIn(row.userId, row.provider, state));
      }
      return landed(INTEGRATION_LANDING_STATUS.NOT_COMPLETED);
    }
    yield* Effect.logWarning(
      `Vercel Connect could not settle a ${INTEGRATION_NAME[row.provider]} sign-in`,
      issued.failure.message,
    );
    return landed(INTEGRATION_LANDING_STATUS.UNAVAILABLE);
  }
  const completed = yield* hostedStoreOrUnavailable(
    seams.completeSignIn(row.userId, row.provider, state),
  );
  // A Disconnect pressed while the browser was away, or a sign-in begun again, wins: this one completes nothing.
  return landed(
    completed ? INTEGRATION_LANDING_STATUS.CONNECTED : INTEGRATION_LANDING_STATUS.NOT_COMPLETED,
  );
});

/** GET: Connect's return. Whatever it brought, the browser lands on the page with a word. */
const connectedEndpoint = /* @__PURE__ */ Effect.fn("web/integrationConnectedEndpoint")(function* (
  seams: IntegrationsAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest | DatabaseServices | IntegrationConnect
> {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const query = new URL(request.url, "https://localhost").searchParams;
  const landed = yield* callbackLanding(seams, query.get(CALLBACK_QUERY.STATE)).pipe(
    Effect.catch(() =>
      Effect.succeed({ provider: undefined, status: INTEGRATION_LANDING_STATUS.UNAVAILABLE }),
    ),
  );
  return landing(landed);
});

/** An endpoint's refusal carried back onto the answer channel, as the account group does. */
function refusing<R>(
  endpoint: Effect.Effect<HttpServerResponse.HttpServerResponse, HostedRefusal, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> {
  return Effect.catch(endpoint, (refusal) => Effect.succeed(hostedRefusalResponse(refusal)));
}

/** The group: the six paths, and the hosted vocabulary's own refusal for any other. */
export function integrationsApp(
  seams: IntegrationsAppSeams,
): WebRoutes<DatabaseServices | IntegrationConnect | GitHubApp | HttpClient.HttpClient> {
  const tools: ToolsCache = new Map();
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, INTEGRATIONS_PATH.TOOLS, refusing(toolsEndpoint(seams, tools))),
    HttpRouter.add(ANY_METHOD, INTEGRATIONS_PATH.STATUSES, refusing(statusesEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, INTEGRATIONS_PATH.CONNECT, refusing(connectEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, INTEGRATIONS_PATH.CANCEL, refusing(cancelEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, INTEGRATIONS_PATH.DISCONNECT, refusing(disconnectEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, INTEGRATIONS_PATH.CONNECTED, connectedEndpoint(seams)),
    hostedNotFoundRoute,
  );
}
