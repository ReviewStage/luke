/**
 * integrations-procedures.ts -- the account's integrations: its connections read, begun, ended, and settled.
 *
 * Seven procedures the signed-in desktop calls with its bearer, or a page of
 * the deployment's own with its session cookie; the browser's return from a
 * sign-in is `integrations-app.ts`'s. A Luke account may hold more than
 * one account at a provider, each its own row and grant under its own
 * connection name; every route about one account reads it from the
 * `connection` query beside the provider, and without one means the
 * provider's first account, so a desktop that predates more than one sees
 * exactly what it saw before.
 *
 * - `GET /api/account/integrations` answers where every provider's
 *   connection stands. For a caller with a bearer, a sign-in still under
 *   way is settled here too, by asking Connect for a token afresh, so a
 *   desktop that reads again after
 *   the browser closed learns the outcome whatever address the browser was
 *   returned to; one with no token yet is asked after by the handle Connect
 *   began it with, and one Connect says was cancelled or refused is ended
 *   here and answered once among the read's `signInFailures`, with
 *   Connect's own line where it is shaped like no credential, since a
 *   sign-in that failed on Connect's own page never returns to Luke. A provider the deployment does not offer the account
 *   (`accountIntegrationConnect`) stands unavailable, and every route below
 *   refuses it as one with no connector here. A caller with only the
 *   session cookie is answered where each row stands as stored, a sign-in
 *   under way `pending`, and nothing is settled, ended, or labelled: a Lax
 *   cookie rides a link another site's page sends a browser on, which must
 *   not settle the account's sign-in or spend its one failure notice.
 * - `POST /api/account/integrations/settle` is that read with its settling,
 *   for any caller; a POST a cookie carries is held to the deployment's own
 *   pages by the origin guard before it gets here.
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
 *
 * A provider's route names it as a path segment, read as words so a
 * provider this build has no route for is not found, as it was; every
 * procedure resolves its caller before it reads its input, and a rename's
 * body is held to its own cap as it is read (`bodyCap` on its contract). Root AGENTS.md pins that no
 * credential travels in an answer: what each endpoint answers is status
 * words, a server's or Connect's credential-free line, or the sign-in
 * address, never a token. The sign-in address is not logged either, since
 * it begins a grant for the account it was issued for, and neither is the
 * handle Connect answers a sign-in with, which is never answered at all.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import type { integrationStatusesReadSchema } from "@luke/features/contract";
import {
  INTEGRATION_ACCOUNTS_MAX,
  INTEGRATION_ADD_ACCOUNT,
  INTEGRATION_GRANT,
  INTEGRATION_GRANT_OF,
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  INTEGRATION_TOOLS_PROBLEM,
  type IntegrationAccount,
  type IntegrationProvider,
  type IntegrationSignInFailure,
  type IntegrationStatus,
  type IntegrationToolsProblemReason,
  type integrationAccountAnswerSchema,
  integrationConnectionOf,
  integrationProviderFromWire,
  mintIntegrationConnectionName,
} from "@luke/features/integration-wire";
import { Effect, Redacted, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import type { GitHubApp } from "../github/github-app.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedCarriesBearer,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import {
  GITHUB_GRANT_REFUSAL,
  githubIntegrationStatus,
  githubOffered,
  githubSignInGrant,
} from "./github-integration.js";
import {
  accountIntegrationConnect,
  type ConnectorService,
  INTEGRATION_CONNECT_FAILURE,
  type IntegrationConnect,
  revokeIntegrationGrant,
} from "./integration-connect.js";
import {
  INTEGRATION_ROW_STATUS,
  type IntegrationAccountKey,
  type IntegrationConnectionRow,
} from "./integration-store.js";
import { INTEGRATION, type IntegrationDefinition } from "./integrations.js";
import {
  connectSignInFailure,
  INTEGRATION_CALLBACK_QUERY,
  type IntegrationsAppSeams,
  type SignInFailure,
  signInStands,
} from "./integrations-app.js";
import {
  listMcpTools,
  MCP_TOOLS_FAILURE,
  type McpTool,
  type McpToolsFailure,
  type McpToolsFailureReason,
} from "./mcp-tools.js";

/** What the integrations procedures ask of the deployment: the store, the clock, the minting, and the caller's resolver. */
export type IntegrationsProcedureSeams = IntegrationsAppSeams;

/** Where every provider stands, as the statuses read and the settle answer it. */
type IntegrationStatusesRead = typeof integrationStatusesReadSchema.Type;

/** One account as a rename answers it. */
type IntegrationAccountAnswer = typeof integrationAccountAnswerSchema.Type;

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

/** What a provider's procedure is asked: the path's provider, and the account in the query. */
interface AccountAsked {
  readonly params: { readonly provider: string };
  readonly query?: { readonly connection?: string | undefined } | undefined;
}

/**
 * The account a procedure is about: the path's provider, and the connection
 * the caller named in the query, or the provider's first account where it
 * named none. A provider this build has no route for, and a name that is no
 * account at that provider, are not found.
 */
const requestedAccount = /* @__PURE__ */ Effect.fnUntraced(function* (
  asked: AccountAsked,
): Effect.fn.Return<
  { readonly provider: IntegrationProvider; readonly connectionName: string },
  HostedRefusal
> {
  const provider = integrationProviderFromWire(asked.params.provider);
  if (provider === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const named = asked.query?.connection;
  if (named === undefined) return { provider, connectionName: provider };
  if (integrationConnectionOf(named)?.provider !== provider) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  return { provider, connectionName: named };
});

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
  if (completed) {
    yield* recordServerEvent(SERVER_EVENT.INTEGRATION_CONNECTION_CREATE, row.userId, {
      provider: row.provider,
    });
  }
  return { completed, ...(accountName !== undefined ? { accountName } : undefined) };
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
 * ended without a grant, which stands for nothing. A read that `settles`
 * nothing answers each row as stored (`storedStanding`) and asks Connect
 * nothing.
 */
const providerStanding = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
  connector: ConnectorService,
  provider: IntegrationProvider,
  rows: readonly IntegrationConnectionRow[],
  settles: boolean,
): Effect.fn.Return<ProviderStanding, HostedRefusal, DatabaseServices> {
  const held = providerRows(rows, provider);
  const settled = yield* Effect.forEach(held, (row) => {
    if (!settles) {
      const standing: Standing = { status: storedStanding(seams, row) };
      return Effect.succeed({ row, standing });
    }
    return Effect.gen(function* () {
      const standing = yield* standingStatus(seams, connector, row);
      // A sign-in this read settled stored its grant's name as the label; the row read before it does not carry it yet.
      const settled =
        standing.accountName !== undefined && (row.label === undefined || row.label === "")
          ? { ...row, label: standing.accountName }
          : row;
      return { row: yield* labelledRow(seams, connector, settled, standing.status), standing };
    });
  });
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
 * Where every one of the account's connections stands, each sign-in under
 * way settled first where the read `settles`; a provider with no connector
 * here, or not offered to the account, is unavailable, and one the
 * account's GitHub sign-in grants stands where that sign-in does. Beside
 * each provider's word, every account it holds, the providers it may add
 * another account at, and why each sign-in this read ended failed.
 */
const statusesAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
  userId: string,
  settles: boolean,
): Effect.fn.Return<
  IntegrationStatusesRead,
  HostedRefusal,
  DatabaseServices | IntegrationConnect | GitHubApp | HttpClient.HttpClient
> {
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
          ? providerStanding(seams, connect[provider], provider, rows, settles)
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
  return {
    integrations,
    ...(accounts.length > 0 ? { accounts } : undefined),
    ...(addable.length > 0 ? { addable } : undefined),
    ...(signInFailures.length > 0 ? { signInFailures } : undefined),
  };
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

/** The callback Connect returns the browser to, on the host the desktop asked through. */
function callbackUrl(requestUrl: string, state: string): string {
  const url = new URL(HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS_CONNECTED, requestUrl);
  url.searchParams.set(INTEGRATION_CALLBACK_QUERY.STATE, state);
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
 * Where a provider stands as stored, settling nothing: its row's own
 * status, or disconnected with none, unless a sign-in still within its
 * window stands, which is pending. A Cancel answers this once it ended its
 * sign-in, where only one begun again meanwhile still stands, and so does a
 * statuses read that settles nothing.
 */
function storedStanding(
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

/** The account as it stands after a rename, read again so the answer is what is stored. */
const accountAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
  userId: string,
  provider: IntegrationProvider,
  connectionName: string,
): Effect.fn.Return<IntegrationAccountAnswer, HostedRefusal, DatabaseServices> {
  const held = providerRows(
    yield* hostedStoreOrUnavailable(seams.readConnections(userId)),
    provider,
  );
  const row = held.find((each) => each.connectionName === connectionName);
  if (row === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return { account: accountOf(row, rowStatus(row)) };
});

/**
 * The integrations resource: every procedure to a signed-in caller,
 * resolved before its input is read, and a rename's body held to its cap
 * before it is. The tools read lately are held for as long as the
 * instance stands.
 */
export function integrationsProcedures(seams: IntegrationsProcedureSeams) {
  const cache: ToolsCache = new Map();
  const integrations = hosted.integrations.use(accountMiddleware(seams.resolveUserId));
  return {
    /**
     * GET: where every one of the caller's connections stands, settling each
     * sign-in under way only for a caller that carries a bearer, as the
     * desktop does.
     */
    statuses: integrations.statuses.effect(function* ({ context }) {
      return yield* statusesAnswer(seams, context.userId, hostedCarriesBearer(context.request));
    }),
    /**
     * POST: every sign-in under way settled, then where every one of the
     * caller's connections stands, as the bearer's read answers it, for any
     * caller; the origin guard holds a POST a cookie carries to the
     * deployment's own pages before it reaches here.
     */
    settle: integrations.settle.effect(function* ({ context }) {
      return yield* statusesAnswer(seams, context.userId, true);
    }),
    /**
     * POST: begins a browser sign-in to one account at a provider. Connect is
     * asked first, so a sign-in it refused leaves the row as it stood; the
     * state is recorded before the address is answered, so no browser can
     * return before the callback can read it. A sign-in for another account
     * asks the provider for its workspace picker where the provider documents
     * how.
     */
    connect: integrations.connect.effect(function* ({ context, input }) {
      const asked = yield* requestedAccount(input);
      const userId = context.userId;
      const connector = (yield* hostedStoreOrUnavailable(accountIntegrationConnect(userId)))[
        asked.provider
      ];
      if (!connector.configured) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      const adding = input.query?.add === INTEGRATION_ADD_ACCOUNT;
      const account = yield* signInAccount(seams, connector, userId, asked, adding);
      const state = seams.mintState();
      const prompt = adding ? connector.addAccountPrompt : undefined;
      const { url, verifier } = yield* connector
        .authorize(
          account.connectSubject,
          callbackUrl(context.request.url, state),
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
      return { url, connection: account.connectionName };
    }),
    /**
     * GET: the tools one provider's server offers the account's agents. A
     * provider with no connector here or not offered to the account, one the
     * account has not connected, and a Connect that could not be asked are the
     * one unavailable refusal. A grant Connect no longer holds, and a server
     * that listed none, are an answer rather than a refusal: why, which the
     * desktop draws in place of the connection's "Connected", and never held.
     */
    tools: integrations.tools.effect(function* ({ context, input }) {
      const { provider, connectionName } = yield* requestedAccount({
        params: { provider: input.provider },
        query: { connection: input.connection },
      });
      const userId = context.userId;
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
        return { tools: held.tools };
      }
      const name = INTEGRATION_NAME[provider];
      const issued = yield* toolsToken(provider, userId, row);
      // A grant no longer held is a refusal the developer mends by connecting again, not an outage.
      if (Result.isFailure(issued)) {
        return { problem: { reason: INTEGRATION_TOOLS_PROBLEM.REFUSED } };
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
        return { problem: toolsProblem(failure) };
      }
      const tools = listed.success;
      heldToolsSwept(cache, seams.now());
      if (holds) {
        const accountReads = cache.get(userId) ?? new Map<string, ToolsRead>();
        accountReads.set(connectionName, { at: seams.now(), connectedAt: grant, tools });
        cache.set(userId, accountReads);
      }
      return { tools };
    }),
    /**
     * POST: ends the sign-in to one provider under way, under the state the row
     * holds now, so a sign-in completed since has no state left to end and
     * stands connected, and one begun again since keeps its own state and
     * stands pending; answers where the provider then stands. Nothing is
     * revoked: a grant Connect holds without the row is one no agent reads.
     */
    cancel: integrations.cancel.effect(function* ({ context, input }) {
      const { provider, connectionName } = yield* requestedAccount(input);
      const userId = context.userId;
      const connector = (yield* hostedStoreOrUnavailable(accountIntegrationConnect(userId)))[
        provider
      ];
      if (!connector.configured) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      const named = (rows: readonly IntegrationConnectionRow[]) =>
        rows.find((each) => each.connectionName === connectionName);
      const row = named(yield* hostedStoreOrUnavailable(seams.readConnections(userId)));
      if (row?.state !== undefined) {
        yield* hostedStoreOrUnavailable(seams.endSignIn(userId, row.connectionName, row.state));
      }
      const after = yield* hostedStoreOrUnavailable(seams.readConnections(userId));
      return { status: storedStanding(seams, named(after)) };
    }),
    /**
     * POST: ends one account's connection at a provider; every other account
     * there stands. The row goes first, so whatever Connect answers, no agent
     * reads a token again; the revoke after it, under that account's own
     * subject, is the courtesy of telling the provider, and a failed one is
     * logged rather than answered, since the account asked to be disconnected
     * and is. GitHub, whose grant is the account's own GitHub sign-in, is
     * refused as unavailable: nothing here ends that sign-in.
     */
    disconnect: integrations.disconnect.effect(function* ({ context, input }) {
      const { provider, connectionName } = yield* requestedAccount(input);
      const userId = context.userId;
      // A grant that is the account's GitHub sign-in ends with that sign-in, never here.
      if (INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN) {
        return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      }
      const rows = yield* hostedStoreOrUnavailable(seams.readConnections(userId));
      const row = rows.find((each) => each.connectionName === connectionName);
      if (row === undefined || (yield* hostedStoreOrUnavailable(seams.deleteAccount(row)))) {
        if (row !== undefined) {
          yield* revokeIntegrationGrant(row);
          yield* recordServerEvent(SERVER_EVENT.INTEGRATION_CONNECTION_DELETE, userId, {
            provider: row.provider,
          });
        }
        return { status: INTEGRATION_STATUS.DISCONNECTED };
      }
      // Note that only the row read is deleted and revoked, so an account added since under the same name stands, and is answered as it stands.
      const standing = (yield* hostedStoreOrUnavailable(seams.readConnections(userId))).find(
        (each) => each.connectionName === connectionName,
      );
      return {
        status: standing === undefined ? INTEGRATION_STATUS.DISCONNECTED : rowStatus(standing),
      };
    }),
    /**
     * POST: names one account as the developer calls it, a trimmed label of up
     * to `INTEGRATION_LABEL_MAX` characters; one the account does not hold is
     * not found, and any other body is an invalid request.
     */
    rename: integrations.rename.effect(function* ({ context, input }) {
      const { provider, connectionName } = yield* requestedAccount(input);
      const userId = context.userId;
      const renamed = yield* hostedStoreOrUnavailable(
        seams.renameConnection(userId, connectionName, input.body.label),
      );
      if (!renamed) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return yield* accountAnswer(seams, userId, provider, connectionName);
    }),
  };
}
