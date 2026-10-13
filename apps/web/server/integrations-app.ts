/**
 * integrations-app.ts -- the integrations group: an account's connections read, begun, ended, and settled.
 *
 * Three endpoints the signed-in desktop calls with its bearer, and one
 * browser navigation that carries none:
 *
 * - `GET /api/account/integrations` answers where every provider's
 *   connection stands. A sign-in still under way is settled here too, by
 *   asking Connect for a token afresh, so a desktop that reads again after
 *   the browser closed learns the outcome whatever address the browser was
 *   returned to.
 * - `POST /api/account/integrations/{provider}/connect` asks Vercel Connect
 *   to begin a browser sign-in to the provider for the account, records the
 *   sign-in's one-time state, and answers the address the desktop opens.
 * - `POST /api/account/integrations/{provider}/disconnect` deletes the
 *   account's row at the provider before anything else, which is what stops
 *   every agent's next token read, then asks Connect to revoke the grant; a
 *   revoke that fails is logged, and the account is disconnected all the
 *   same.
 * - `GET /api/account/integrations/{provider}/tools` answers the tools the
 *   provider's server offers the account's agents, read from the server with
 *   the account's token as an MCP client reads them, narrowed to the ones its
 *   table entry allows, and held for a few minutes per account and provider
 *   so a popover opened again asks the server nothing. A server that listed
 *   none answers why, with its own one-line message where it sent one that
 *   carries no credential (`hosted/mcp-tools.ts`), and is never held, so a
 *   connection mended at the provider reads as mended at once. A provider
 *   the account has not connected is refused before any token is read.
 * - `GET /api/account/integrations/connected` is where Connect returns the
 *   browser from any provider: the sign-in's state names the account and the
 *   provider, Connect is asked for a token afresh, and the browser is sent
 *   on to the landing page with the provider and one word.
 *
 * The rewrite moves a provider's path segment into the `provider` query, so
 * the two provider routes read it there. Root AGENTS.md pins that no
 * credential travels in an answer: what each endpoint answers is status
 * words, a server's credential-free message, or the sign-in address, never
 * a token. The sign-in address is not
 * logged either, since it begins a grant for the account it was issued for.
 */

import { randomBytes } from "node:crypto";
import type { DatabaseServices } from "@sidecar/database/core/query";
import { HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import {
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  INTEGRATION_TOOLS_PROBLEM,
  type IntegrationLandingStatus,
  type IntegrationProvider,
  type IntegrationStatus,
  type IntegrationToolsProblemReason,
  integrationLandingPath,
  integrationProviderFromWire,
} from "@sidecar/hosted/integration-wire";
import { Effect, Layer, Option, Redacted, Result } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import type * as HttpClient from "effect/http/HttpClient";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedMethod,
  hostedNotFoundRoute,
  hostedRefusalResponse,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "./hosted/http-effect.js";
import {
  INTEGRATION_CONNECT_FAILURE,
  IntegrationConnect,
  revokeIntegrationGrant,
} from "./hosted/integration-connect.js";
import {
  INTEGRATION_ROW_STATUS,
  type IntegrationConnectionRow,
  type IntegrationStoreEffect,
} from "./hosted/integration-store.js";
import { INTEGRATION, type IntegrationDefinition } from "./hosted/integrations.js";
import {
  listMcpTools,
  MCP_TOOLS_FAILURE,
  type McpTool,
  type McpToolsFailure,
  type McpToolsFailureReason,
} from "./hosted/mcp-tools.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/** How long a sign-in may stay under way before its state no longer settles it: Connect's own requests last about as long. */
const INTEGRATION_SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

/** The paths the group answers, as the rewrites hand them to it. */
const INTEGRATIONS_PATH = {
  /** GET reads where every provider stands. */
  STATUSES: HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS,
  /** POST begins a sign-in; the rewrite moves the path's provider into the `provider` query. */
  CONNECT: "/api/account/integrations/connect",
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
  ) => IntegrationStoreEffect<void>;
  completeSignIn: (
    userId: string,
    provider: IntegrationProvider,
    state: string,
  ) => IntegrationStoreEffect<boolean>;
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
  row: IntegrationConnectionRow,
  state: string,
): Effect.fn.Return<boolean, HostedRefusal, DatabaseServices | IntegrationConnect> {
  const connector = (yield* IntegrationConnect)[row.provider];
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

/** The status a stored row stands for, settling a sign-in still under way. */
const standingStatus = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
  row: IntegrationConnectionRow | undefined,
): Effect.fn.Return<IntegrationStatus, HostedRefusal, DatabaseServices | IntegrationConnect> {
  if (row === undefined) return INTEGRATION_STATUS.DISCONNECTED;
  if (row.status === INTEGRATION_ROW_STATUS.CONNECTED) return INTEGRATION_STATUS.CONNECTED;
  // The state of a sign-in still under way, which is the one a settlement may complete.
  const underWay = signInStands(seams, row.stateIssuedAt) ? row.state : undefined;
  if (underWay !== undefined && (yield* settledSignIn(seams, row, underWay))) {
    return INTEGRATION_STATUS.CONNECTED;
  }
  if (row.status === INTEGRATION_ROW_STATUS.EXPIRED) return INTEGRATION_STATUS.EXPIRED;
  // A first sign-in that ran out of time never connected anything.
  return underWay !== undefined ? INTEGRATION_STATUS.PENDING : INTEGRATION_STATUS.DISCONNECTED;
});

/** GET: where every one of the caller's connections stands; a provider with no connector here is unavailable. */
const statusesEndpoint = /* @__PURE__ */ Effect.fn("web/integrationsStatusesEndpoint")(function* (
  seams: IntegrationsAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices | IntegrationConnect
> {
  yield* hostedMethod(HTTP_METHOD.GET);
  const userId = yield* resolvedUserId(seams);
  const connect = yield* IntegrationConnect;
  // A deployment with no connector at all answers from its configuration alone, whatever the store.
  const anyConfigured = INTEGRATION_PROVIDER_LIST.some((provider) => connect[provider].configured);
  const rows = anyConfigured ? yield* hostedStoreOrUnavailable(seams.readConnections(userId)) : [];
  const integrations = Object.fromEntries(
    yield* Effect.forEach(INTEGRATION_PROVIDER_LIST, (provider) =>
      Effect.map(
        connect[provider].configured
          ? standingStatus(
              seams,
              rows.find((row) => row.provider === provider),
            )
          : Effect.succeed(INTEGRATION_STATUS.UNAVAILABLE),
        (status) => [provider, status] as const,
      ),
    ),
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { integrations });
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
 * GET: the tools one provider's server offers the account's agents. A
 * provider with no connector here, one the account has not connected, and a
 * Connect that could not be asked are the one unavailable refusal. A grant
 * Connect no longer holds, and a server that listed none, are an answer
 * rather than a refusal: why, which the desktop draws in place of the
 * connection's "Connected", and never held.
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
  | HttpClient.HttpClient
> {
  yield* hostedMethod(HTTP_METHOD.GET);
  const provider = yield* requestedProvider();
  const userId = yield* resolvedUserId(seams);
  const connector = (yield* IntegrationConnect)[provider];
  if (!connector.configured) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const rows = yield* hostedStoreOrUnavailable(seams.readConnections(userId));
  const row = rows.find((each) => each.provider === provider);
  if (row?.status !== INTEGRATION_ROW_STATUS.CONNECTED) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  const held = cache.get(userId)?.get(provider);
  const grant = row.connectedAt?.getTime();
  if (
    held !== undefined &&
    held.connectedAt === grant &&
    seams.now() - held.at < INTEGRATION_TOOLS_TTL_MS
  ) {
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { tools: held.tools });
  }
  const name = INTEGRATION_NAME[provider];
  const issued = yield* Effect.result(connector.token(userId, { fresh: false }));
  if (Result.isFailure(issued)) {
    // A grant Connect no longer holds is a refusal the developer mends by reconnecting, not an outage.
    if (issued.failure.reason === INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED) {
      return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
        problem: { reason: INTEGRATION_TOOLS_PROBLEM.REFUSED },
      });
    }
    yield* Effect.logWarning(
      `Vercel Connect gave no ${name} token for its tools`,
      issued.failure.message,
    );
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  const definition: IntegrationDefinition = INTEGRATION[provider];
  const listed = yield* Effect.result(
    listMcpTools(definition.MCP_URL, Redacted.value(issued.success.token)),
  );
  if (Result.isFailure(listed)) {
    const failure = listed.failure;
    yield* Effect.logWarning(
      `${name}'s MCP server listed no tools: ${failure.reason}`,
      failure.code ?? "no code",
    );
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { problem: toolsProblem(failure) });
  }
  const allowed = definition.ALLOWED_TOOLS;
  const tools =
    allowed === undefined
      ? listed.success
      : listed.success.filter((tool) => allowed.includes(tool.name));
  heldToolsSwept(cache, seams.now());
  const accountReads = cache.get(userId) ?? new Map<IntegrationProvider, ToolsRead>();
  accountReads.set(provider, { at: seams.now(), connectedAt: grant, tools });
  cache.set(userId, accountReads);
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
  const connector = (yield* IntegrationConnect)[provider];
  if (!connector.configured) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const state = seams.mintState();
  const url = yield* connector.authorize(userId, callbackUrl(request.url, state)).pipe(
    Effect.tapError((failure) =>
      Effect.logWarning(
        `Vercel Connect could not begin a ${INTEGRATION_NAME[provider]} sign-in`,
        failure.message,
      ),
    ),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
  yield* hostedStoreOrUnavailable(seams.beginSignIn(userId, provider, state));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { url });
});

/**
 * POST: ends one provider's connection. The row goes first, so whatever
 * Connect answers, no agent reads a token again; the revoke after it is the
 * courtesy of telling the provider, and a failed one is logged rather than
 * answered, since the account asked to be disconnected and is.
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
  const connector = (yield* IntegrationConnect)[row.provider];
  const issued = yield* Effect.result(connector.token(row.userId, { fresh: true }));
  if (Result.isFailure(issued)) {
    if (issued.failure.reason === INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED) {
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

/** The group: the five paths, and the hosted vocabulary's own refusal for any other. */
export function integrationsApp(
  seams: IntegrationsAppSeams,
): WebRoutes<DatabaseServices | IntegrationConnect | HttpClient.HttpClient> {
  const tools: ToolsCache = new Map();
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, INTEGRATIONS_PATH.TOOLS, refusing(toolsEndpoint(seams, tools))),
    HttpRouter.add(ANY_METHOD, INTEGRATIONS_PATH.STATUSES, refusing(statusesEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, INTEGRATIONS_PATH.CONNECT, refusing(connectEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, INTEGRATIONS_PATH.DISCONNECT, refusing(disconnectEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, INTEGRATIONS_PATH.CONNECTED, connectedEndpoint(seams)),
    hostedNotFoundRoute,
  );
}
