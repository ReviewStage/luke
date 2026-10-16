/**
 * integrations-app.ts -- the integrations group: an account's connections read, begun, ended, and settled.
 *
 * Six endpoints the signed-in desktop calls with its bearer, and one
 * browser navigation that carries none. A Luke account may hold more than
 * one account at a provider, each its own row and grant under its own
 * connection name; every route about one account reads it from the
 * `connection` query beside the provider, and without one means the
 * provider's first account, so a desktop that predates more than one sees
 * exactly what it saw before.
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
 *   sign-in's one-time state, and answers the address the desktop opens and
 *   the account it signs in. With `add=true` it signs in a new account,
 *   under a subject minted for it and the next free connection name, where
 *   the provider offers more than one (`integrations.ts`) and the account
 *   holds fewer than the most; the new account stands pending until its
 *   sign-in settles, and its label is its name at the provider where
 *   Connect's grant carries one.
 * - `POST /api/account/integrations/{provider}/rename` names one account
 *   as the developer calls it, and answers the account as it then stands.
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
  INTEGRATION_ACCOUNTS_MAX,
  INTEGRATION_ADD_ACCOUNT,
  INTEGRATION_GRANT,
  INTEGRATION_GRANT_OF,
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_QUERY,
  INTEGRATION_SIGN_IN_FAILURE,
  INTEGRATION_STATUS,
  INTEGRATION_TOOLS_PROBLEM,
  type IntegrationAccount,
  type IntegrationLandingStatus,
  type IntegrationProvider,
  type IntegrationSignInFailure,
  type IntegrationStatus,
  type IntegrationToolsProblemReason,
  integrationConnectionOf,
  integrationLandingPath,
  integrationProviderFromWire,
  integrationRenameRequestSchema,
  mintIntegrationConnectionName,
} from "@luke/features/integration-wire";
import { readEither } from "@luke/wire/effect";
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
  readJsonBodyEffect,
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
  type IntegrationAccountKey,
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
  /** POST names one account; the rewrite moves the path's provider into the `provider` query. */
  RENAME: "/api/account/integrations/rename",
  /** GET is Connect's return from any provider's sign-in. */
  CONNECTED: HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS_CONNECTED,
} as const;

/** How long a provider's tools stay read for an account before the next ask reads the server again. */
const INTEGRATION_TOOLS_TTL_MS = 5 * 60 * 1000;

/** One account's tools as read, when, and under which grant: a sign-in completed since names another. */
interface ToolsRead {
  readonly at: number;
  readonly connectedAt: number | undefined;
  readonly tools: readonly McpTool[];
}

/** The tools read lately, by Luke account and then by connection name, for as long as the instance stands. */
type ToolsCache = Map<string, Map<string, ToolsRead>>;

/** Every read past its time let go, so an instance that stands long holds the lists of no account that stopped asking. */
function heldToolsSwept(cache: ToolsCache, now: number): void {
  for (const [userId, reads] of cache) {
    for (const [connectionName, read] of reads) {
      if (now - read.at >= INTEGRATION_TOOLS_TTL_MS) reads.delete(connectionName);
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

const SUBJECT_BYTES = 24;

const HTTP_METHOD = { GET: "GET", POST: "POST" } as const;

/** A browser is sent on with 303, so whatever Connect sends becomes the GET the page is. */
const SEE_OTHER = 303;

/** The account's rows at one provider, in their places' order. */
function providerRows(
  rows: readonly IntegrationConnectionRow[],
  provider: IntegrationProvider,
): readonly IntegrationConnectionRow[] {
  const placeOf = (row: IntegrationConnectionRow) =>
    integrationConnectionOf(row.connectionName)?.place ?? Number.POSITIVE_INFINITY;
  return rows
    .filter((row) => row.provider === provider)
    .toSorted((a, b) => placeOf(a) - placeOf(b));
}

/** One account as the wire answers it, standing as given. */
function accountOf(row: IntegrationConnectionRow, status: IntegrationStatus): IntegrationAccount {
  return {
    provider: row.provider,
    connection: row.connectionName,
    // An empty label marks an account whose grant named nothing, which is called by its place.
    ...(row.label !== undefined && row.label !== "" ? { label: row.label } : undefined),
    status,
  };
}

/** Where a row stands without settling anything: its own status in the wire's words. */
function rowStatus(row: IntegrationConnectionRow): IntegrationStatus {
  switch (row.status) {
    case INTEGRATION_ROW_STATUS.CONNECTED:
      return INTEGRATION_STATUS.CONNECTED;
    case INTEGRATION_ROW_STATUS.EXPIRED:
      return INTEGRATION_STATUS.EXPIRED;
    case INTEGRATION_ROW_STATUS.PENDING:
      return INTEGRATION_STATUS.PENDING;
  }
}

export interface IntegrationsAppSeams {
  resolveUserId: UserIdResolver;
  readConnections: (userId: string) => IntegrationStoreEffect<readonly IntegrationConnectionRow[]>;
  readSignIn: (state: string) => IntegrationStoreEffect<IntegrationConnectionRow | undefined>;
  /** Records a sign-in under way; answers whether it took, which it does not where another sign-in minted the same name meanwhile. */
  beginSignIn: (
    userId: string,
    account: IntegrationAccountKey,
    state: string,
    verifier: Redacted.Redacted,
  ) => IntegrationStoreEffect<boolean>;
  /** Sets one account connected, taking its name at the provider as its label where it carries none. */
  completeSignIn: (
    userId: string,
    connectionName: string,
    state: string,
    accountName?: string,
  ) => IntegrationStoreEffect<boolean>;
  /** Ends the sign-in begun under `state` without a grant: the browser came back without one. */
  endSignIn: (
    userId: string,
    connectionName: string,
    state: string,
  ) => IntegrationStoreEffect<void>;
  deleteAccount: (
    account: Pick<IntegrationConnectionRow, "userId" | "connectionName" | "id">,
  ) => IntegrationStoreEffect<boolean>;
  /** Labels an account that carries no label yet, once, with what its grant named or an empty label for nothing; only the account under that grant's subject. */
  fillLabel: (account: IntegrationConnectionRow, label: string) => IntegrationStoreEffect<void>;
  /** Names one account; answers whether the account held it. */
  renameConnection: (
    userId: string,
    connectionName: string,
    label: string,
  ) => IntegrationStoreEffect<boolean>;
  /** A fresh subject for another account's grant at Connect; random in production, fixed in a test. */
  mintSubject: () => string;
  /** A fresh sign-in state; random in production, fixed in a test. */
  mintState: () => string;
  /** Now, in milliseconds since the epoch. */
  now: () => number;
}

/** A sign-in state as production mints it. */
export function mintIntegrationState(): string {
  return randomBytes(STATE_BYTES).toString("base64url");
}

/** A subject for another account's grant as production mints it: 24 random bytes, url-safe, prefixed so it reads as Luke's own. */
export function mintIntegrationSubject(): string {
  return `luke_acct_${randomBytes(SUBJECT_BYTES).toString("base64url")}`;
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

/**
 * The account a route is about: the provider the rewrite put in the query,
 * and the connection the caller named beside it, or the provider's first
 * account where it named none. A name that is no account at that provider
 * is not found, as a provider is.
 */
const requestedAccount = /* @__PURE__ */ Effect.fnUntraced(function* (): Effect.fn.Return<
  { readonly provider: IntegrationProvider; readonly connectionName: string },
  HostedRefusal,
  HttpServerRequest.HttpServerRequest
> {
  const provider = yield* requestedProvider();
  const request = yield* HttpServerRequest.HttpServerRequest;
  const named = new URL(request.url, "https://localhost").searchParams.get(
    INTEGRATION_QUERY.CONNECTION,
  );
  if (named === null) return { provider, connectionName: provider };
  if (integrationConnectionOf(named)?.provider !== provider) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  return { provider, connectionName: named };
});

/** Whether a sign-in begun at this instant may still settle. */
function signInStands(seams: IntegrationsAppSeams, issuedAt: Date | undefined): boolean {
  return (
    issuedAt !== undefined && seams.now() - issuedAt.getTime() <= INTEGRATION_SIGN_IN_WINDOW_MS
  );
}

/**
 * Whether a row holds one of its provider's account places: connected,
 * expired, or a sign-in still under way. Note that a first sign-in that ran
 * out of time holds none, because no read answers it, so nothing the
 * developer sees could free its place.
 */
function holdsAccountPlace(seams: IntegrationsAppSeams, row: IntegrationConnectionRow): boolean {
  return (
    row.status === INTEGRATION_ROW_STATUS.CONNECTED ||
    row.status === INTEGRATION_ROW_STATUS.EXPIRED ||
    signInStands(seams, row.stateIssuedAt)
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
): Effect.fn.Return<
  { readonly completed: boolean; readonly accountName?: string },
  HostedRefusal,
  DatabaseServices
> {
  const issued = yield* Effect.result(connector.token(row.connectSubject, { fresh: true }));
  if (Result.isFailure(issued)) {
    if (issued.failure.reason !== INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED) {
      yield* Effect.logWarning(
        `Vercel Connect could not settle a ${INTEGRATION_NAME[row.provider]} sign-in`,
        issued.failure.message,
      );
    }
    return { completed: false };
  }
  const { accountName } = issued.success;
  const completed = yield* hostedStoreOrUnavailable(
    seams.completeSignIn(row.userId, row.connectionName, state, accountName),
  );
  return { completed, ...(accountName !== undefined ? { accountName } : undefined) };
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
  /** The account's name at the provider a sign-in this read settled was granted with, where its grant named one. */
  readonly accountName?: string;
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
  const settled = yield* settledSignIn(seams, connector, row, underWay);
  if (settled.completed) {
    return {
      status: INTEGRATION_STATUS.CONNECTED,
      ...(settled.accountName !== undefined ? { accountName: settled.accountName } : undefined),
    };
  }
  const failure = yield* connectSignInFailure(connector, row);
  if (failure === undefined) return { status: INTEGRATION_STATUS.PENDING };
  yield* hostedStoreOrUnavailable(seams.endSignIn(row.userId, row.connectionName, underWay));
  return { status: standingWithoutSignIn(row), failure };
});

/**
 * A connected account as the statuses read answers it, labelled once from
 * its grant where it carries no label: an account connected before labels
 * were kept, or one whose sign-in's grant named nothing then. Its name at
 * the provider is read from Connect's grant fields, the same ones a
 * sign-in's are, and stored; a grant that names nothing is stored as an
 * empty label, so it is asked once and the account is called by its place;
 * a grant that could not be read, or an account whose reconnect is under
 * way, is left for the next read.
 */
const labelledRow = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
  connector: ConnectorService,
  row: IntegrationConnectionRow,
  status: IntegrationStatus,
): Effect.fn.Return<IntegrationConnectionRow, HostedRefusal, DatabaseServices> {
  if (row.label !== undefined || status !== INTEGRATION_STATUS.CONNECTED) return row;
  // Note that a reconnect under way is left alone, because the grant it ends with names the account, not the one it replaces.
  if (row.state !== undefined && signInStands(seams, row.stateIssuedAt)) return row;
  const issued = yield* Effect.result(connector.token(row.connectSubject, { fresh: false }));
  if (Result.isFailure(issued)) return row;
  const label = issued.success.accountName ?? "";
  yield* hostedStoreOrUnavailable(seams.fillLabel(row, label));
  return { ...row, label };
});

/** Where one provider stands for the statuses read: its first account's word, its accounts, and why each sign-in this read ended failed. */
interface ProviderStanding {
  readonly status: IntegrationStatus;
  readonly accounts: readonly IntegrationAccount[];
  readonly failures: readonly IntegrationSignInFailure[];
}

/**
 * Where one Connect provider stands for the account: every row settled as
 * `standingStatus` settles it, the first account's word kept for the
 * provider's own, and every account answered but one whose first sign-in
 * ended without a grant, which stands for nothing.
 */
const providerStanding = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
  connector: ConnectorService,
  provider: IntegrationProvider,
  rows: readonly IntegrationConnectionRow[],
): Effect.fn.Return<ProviderStanding, HostedRefusal, DatabaseServices> {
  const held = providerRows(rows, provider);
  const settled = yield* Effect.forEach(held, (row) =>
    Effect.gen(function* () {
      const standing = yield* standingStatus(seams, connector, row);
      // A sign-in this read settled stored its grant's name as the label; the row read before it does not carry it yet.
      const settled =
        standing.accountName !== undefined && (row.label === undefined || row.label === "")
          ? { ...row, label: standing.accountName }
          : row;
      return { row: yield* labelledRow(seams, connector, settled, standing.status), standing };
    }),
  );
  const first = settled.find(({ row }) => row.connectionName === provider);
  return {
    status: first?.standing.status ?? INTEGRATION_STATUS.DISCONNECTED,
    accounts: settled
      .filter(({ standing }) => standing.status !== INTEGRATION_STATUS.DISCONNECTED)
      .map(({ row, standing }) => accountOf(row, standing.status)),
    failures: settled.flatMap(({ row, standing }) =>
      standing.failure === undefined
        ? []
        : [{ provider, connection: row.connectionName, ...standing.failure }],
    ),
  };
});

/**
 * GET: where every one of the caller's connections stands; a provider with
 * no connector here, or not offered to the caller, is unavailable, and one
 * the caller's GitHub sign-in grants stands where that sign-in does. Beside
 * each provider's word, every account the caller holds, and the providers
 * it may add another account at.
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
  const unavailable: ProviderStanding = {
    status: INTEGRATION_STATUS.UNAVAILABLE,
    accounts: [],
    failures: [],
  };
  const standings = yield* Effect.forEach(INTEGRATION_PROVIDER_LIST, (provider) =>
    Effect.map(
      INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN
        ? Effect.map(
            githubIntegrationStatus(userId),
            (status): ProviderStanding => ({ status, accounts: [], failures: [] }),
          )
        : connect[provider].configured
          ? providerStanding(seams, connect[provider], provider, rows)
          : Effect.succeed(unavailable),
      (standing) => ({ provider, ...standing }),
    ),
  );
  const integrations = Object.fromEntries(
    standings.map(({ provider, status }) => [provider, status]),
  );
  const accounts = standings.flatMap((standing) => standing.accounts);
  // Note that the places are counted from what this read settled, so a sign-in it ended frees one at once.
  const addable = standings
    .filter(
      ({ provider, accounts: held }) =>
        connect[provider].configured &&
        connect[provider].multipleAccounts &&
        held.length < INTEGRATION_ACCOUNTS_MAX,
    )
    .map(({ provider }) => provider);
  const signInFailures = standings.flatMap((standing) => standing.failures);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    integrations,
    ...(accounts.length > 0 ? { accounts } : undefined),
    ...(addable.length > 0 ? { addable } : undefined),
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
 * The account's connected row at one provider, whose subject the tools are
 * read under and whose grant's instant keys the tools held for it; nothing
 * for a grant that is the account's GitHub sign-in, whose tools are never
 * held. A
 * provider with no connector here or not offered to the account, and one the
 * account has not connected, are refused as unavailable.
 */
const standingGrant = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
  provider: IntegrationProvider,
  connectionName: string,
  userId: string,
): Effect.fn.Return<
  IntegrationConnectionRow | undefined,
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
  const row = rows.find((each) => each.connectionName === connectionName);
  if (row?.status !== INTEGRATION_ROW_STATUS.CONNECTED) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  return row;
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
  row: IntegrationConnectionRow | undefined,
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
  if (row === undefined) return Result.fail(GRANT_REFUSED);
  const connector = (yield* hostedStoreOrUnavailable(accountIntegrationConnect(userId)))[provider];
  const issued = yield* Effect.result(connector.token(row.connectSubject, { fresh: false }));
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
  const { provider, connectionName } = yield* requestedAccount();
  const userId = yield* resolvedUserId(seams);
  const row = yield* standingGrant(seams, provider, connectionName, userId);
  const grant = row?.connectedAt?.getTime();
  // Note that GitHub's tools are never held, because its grant has no instant to tell a new one by.
  const holds = INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.CONNECT;
  const held = holds ? cache.get(userId)?.get(connectionName) : undefined;
  if (
    held !== undefined &&
    held.connectedAt === grant &&
    seams.now() - held.at < INTEGRATION_TOOLS_TTL_MS
  ) {
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { tools: held.tools });
  }
  const name = INTEGRATION_NAME[provider];
  const issued = yield* toolsToken(provider, userId, row);
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
    const accountReads = cache.get(userId) ?? new Map<string, ToolsRead>();
    accountReads.set(connectionName, { at: seams.now(), connectedAt: grant, tools });
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
 * The account a Connect signs in: a new one where `add=true` asks for it,
 * under a minted subject and the next free name, where the provider offers
 * more than one and the account holds fewer than the most, letting go of
 * every sign-in at the provider left past its window; otherwise the
 * account named, which must stand unless it is the provider's first, which
 * asks under the account's own user id as every account did before a second
 * was possible.
 */
const signInAccount = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
  connector: ConnectorService,
  userId: string,
  asked: { readonly provider: IntegrationProvider; readonly connectionName: string },
  adding: boolean,
): Effect.fn.Return<IntegrationAccountKey, HostedRefusal, DatabaseServices> {
  const { provider, connectionName } = asked;
  const rows = yield* hostedStoreOrUnavailable(seams.readConnections(userId));
  if (adding) {
    if (!connector.multipleAccounts) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    // Note that a sign-in left past its window is let go first, so its name is free again and no read takes it for an account.
    const left = providerRows(rows, provider).filter((row) => !holdsAccountPlace(seams, row));
    yield* Effect.forEach(
      left,
      (row) =>
        row.state === undefined
          ? Effect.void
          : hostedStoreOrUnavailable(seams.endSignIn(userId, row.connectionName, row.state)),
      { discard: true },
    );
    // Note that the rows are read again, so a sign-in restarted, or an account added, while these were let go keeps its name and its place.
    const remaining =
      left.length === 0 ? rows : yield* hostedStoreOrUnavailable(seams.readConnections(userId));
    const held = providerRows(remaining, provider).filter((row) => holdsAccountPlace(seams, row));
    if (held.length >= INTEGRATION_ACCOUNTS_MAX) {
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }
    const name = mintIntegrationConnectionName(
      provider,
      remaining.map((row) => row.connectionName),
    );
    return {
      provider,
      connectionName: name,
      connectSubject: name === provider ? userId : seams.mintSubject(),
    };
  }
  const standing = rows.find((row) => row.connectionName === connectionName);
  if (standing !== undefined) {
    return { provider, connectionName, connectSubject: standing.connectSubject };
  }
  if (connectionName !== provider) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return { provider, connectionName, connectSubject: userId };
});

/**
 * POST: begins a browser sign-in to one account at a provider. Connect is
 * asked first, so a sign-in it refused leaves the row as it stood; the
 * state is recorded before the address is answered, so no browser can
 * return before the callback can read it. A sign-in for another account
 * asks the provider for its workspace picker where the provider documents
 * how.
 */
const connectEndpoint = /* @__PURE__ */ Effect.fn("web/integrationConnectEndpoint")(function* (
  seams: IntegrationsAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices | IntegrationConnect
> {
  yield* hostedMethod(HTTP_METHOD.POST);
  const asked = yield* requestedAccount();
  const userId = yield* resolvedUserId(seams);
  const connector = (yield* hostedStoreOrUnavailable(accountIntegrationConnect(userId)))[
    asked.provider
  ];
  if (!connector.configured) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const adding =
    new URL(request.url).searchParams.get(INTEGRATION_QUERY.ADD) === INTEGRATION_ADD_ACCOUNT;
  const account = yield* signInAccount(seams, connector, userId, asked, adding);
  const state = seams.mintState();
  const prompt = adding ? connector.addAccountPrompt : undefined;
  const { url, verifier } = yield* connector
    .authorize(
      account.connectSubject,
      callbackUrl(request.url, state),
      prompt !== undefined ? { prompt } : undefined,
    )
    .pipe(
      Effect.tapError((failure) =>
        Effect.logWarning(
          `Vercel Connect could not begin a ${INTEGRATION_NAME[asked.provider]} sign-in`,
          failure.message,
        ),
      ),
      Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
    );
  const begun = yield* hostedStoreOrUnavailable(
    seams.beginSignIn(userId, account, state, verifier),
  );
  // Another sign-in took the name meanwhile: this one would settle a grant no row names, so it is refused.
  if (!begun) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { url, connection: account.connectionName });
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
  const { provider, connectionName } = yield* requestedAccount();
  const userId = yield* resolvedUserId(seams);
  const connector = (yield* hostedStoreOrUnavailable(accountIntegrationConnect(userId)))[provider];
  if (!connector.configured) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const named = (rows: readonly IntegrationConnectionRow[]) =>
    rows.find((each) => each.connectionName === connectionName);
  const row = named(yield* hostedStoreOrUnavailable(seams.readConnections(userId)));
  if (row?.state !== undefined) {
    yield* hostedStoreOrUnavailable(seams.endSignIn(userId, row.connectionName, row.state));
  }
  const after = yield* hostedStoreOrUnavailable(seams.readConnections(userId));
  const status = standingAfterCancel(seams, named(after));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { status });
});

/**
 * POST: ends one account's connection at a provider; every other account
 * there stands. The row goes first, so whatever Connect answers, no agent
 * reads a token again; the revoke after it, under that account's own
 * subject, is the courtesy of telling the provider, and a failed one is
 * logged rather than answered, since the account asked to be disconnected
 * and is. GitHub,
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
    const { provider, connectionName } = yield* requestedAccount();
    const userId = yield* resolvedUserId(seams);
    // A grant that is the account's GitHub sign-in ends with that sign-in, never here.
    if (INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN) {
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }
    const rows = yield* hostedStoreOrUnavailable(seams.readConnections(userId));
    const row = rows.find((each) => each.connectionName === connectionName);
    if (row === undefined || (yield* hostedStoreOrUnavailable(seams.deleteAccount(row)))) {
      if (row !== undefined) yield* revokeIntegrationGrant(row);
      return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
        status: INTEGRATION_STATUS.DISCONNECTED,
      });
    }
    // Note that only the row read is deleted and revoked, so an account added since under the same name stands, and is answered as it stands.
    const standing = (yield* hostedStoreOrUnavailable(seams.readConnections(userId))).find(
      (each) => each.connectionName === connectionName,
    );
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
      status: standing === undefined ? INTEGRATION_STATUS.DISCONNECTED : rowStatus(standing),
    });
  },
);

/** The most a rename's body may carry, in bytes: one label, well past its own bound. */
const MAXIMUM_RENAME_BYTES = 2048;

/** The account as it stands after a rename, read again so the answer is what is stored. */
const accountAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
  userId: string,
  provider: IntegrationProvider,
  connectionName: string,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, DatabaseServices> {
  const held = providerRows(
    yield* hostedStoreOrUnavailable(seams.readConnections(userId)),
    provider,
  );
  const row = held.find((each) => each.connectionName === connectionName);
  if (row === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    account: accountOf(row, rowStatus(row)),
  });
});

/**
 * POST: names one account as the developer calls it, a trimmed label of up
 * to `INTEGRATION_LABEL_MAX` characters; one the account does not hold is
 * not found, and any other body is an invalid request.
 */
const renameEndpoint = /* @__PURE__ */ Effect.fn("web/integrationRenameEndpoint")(function* (
  seams: IntegrationsAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices
> {
  yield* hostedMethod(HTTP_METHOD.POST);
  const { provider, connectionName } = yield* requestedAccount();
  const userId = yield* resolvedUserId(seams);
  const body = yield* readJsonBodyEffect(MAXIMUM_RENAME_BYTES);
  const asked = readEither(integrationRenameRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const renamed = yield* hostedStoreOrUnavailable(
    seams.renameConnection(userId, connectionName, asked.success.label),
  );
  if (!renamed) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return yield* accountAnswer(seams, userId, provider, connectionName);
});

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
  const issued = yield* Effect.result(connector.token(row.connectSubject, { fresh: true }));
  if (Result.isFailure(issued)) {
    // Back without a grant: the sign-in is over, so the window waiting on it hears so at its next read.
    if (issued.failure.reason === INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED) {
      // Note that one Connect says was cancelled or refused is left standing, because the statuses read says why as it ends it.
      if ((yield* connectSignInFailure(connector, row)) === undefined) {
        yield* hostedStoreOrUnavailable(seams.endSignIn(row.userId, row.connectionName, state));
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
    seams.completeSignIn(row.userId, row.connectionName, state, issued.success.accountName),
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

/** The group: the seven paths, one of them the browser's, and the hosted vocabulary's own refusal for any other. */
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
    HttpRouter.add(ANY_METHOD, INTEGRATIONS_PATH.RENAME, refusing(renameEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, INTEGRATIONS_PATH.CONNECTED, connectedEndpoint(seams)),
    hostedNotFoundRoute,
  );
}
