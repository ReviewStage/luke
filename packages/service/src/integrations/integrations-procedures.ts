import type { DatabaseServices } from "@repo/database/core/query";
import { INTEGRATION_ROW_STATUS } from "@repo/database/integration-vocabulary";
import { HOSTED_SERVICE_PATH } from "@repo/features";
import type { integrationStatusesReadSchema } from "@repo/features/contract";
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
  type IntegrationStatus,
  type IntegrationToolsProblemReason,
  type integrationAccountAnswerSchema,
  integrationConnectionOf,
  integrationLabelUnread,
  integrationProviderFromWire,
  mintIntegrationConnectionName,
} from "@repo/features/integration-wire";
import { Duration, Effect, Option, Redacted, Result } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
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
  accountNameLine,
  type ConnectorService,
  INTEGRATION_CONNECT_FAILURE,
  type IntegrationConnect,
  revokeIntegrationGrant,
} from "./integration-connect.js";
import type { IntegrationAccountKey, IntegrationConnectionRow } from "./integration-store.js";
import { type AccountNameRead, INTEGRATION, type IntegrationDefinition } from "./integrations.js";
import {
  INTEGRATION_CALLBACK_QUERY,
  type IntegrationsAppSeams,
  signInStands,
} from "./integrations-app.js";
import {
  listMcpTools,
  MCP_TOOLS_FAILURE,
  type McpTool,
  type McpToolsFailure,
  type McpToolsFailureReason,
  readMcpTool,
} from "./mcp-tools.js";

export type IntegrationsProcedureSeams = IntegrationsAppSeams;

type IntegrationStatusesRead = typeof integrationStatusesReadSchema.Type;

type IntegrationAccountAnswer = typeof integrationAccountAnswerSchema.Type;

const INTEGRATION_TOOLS_TTL_MS = 5 * 60 * 1000;

interface ToolsRead {
  readonly at: number;
  readonly connectedAt: number | undefined;
  readonly tools: readonly McpTool[];
}

type ToolsCache = Map<string, Map<string, ToolsRead>>;

interface UnnamedRead {
  readonly at: number;
  readonly connectedAt: number | undefined;
}

type UnnamedHold = Map<string, Map<string, UnnamedRead>>;

function heldReadsSwept(
  cache: Map<string, Map<string, { readonly at: number }>>,
  now: number,
): void {
  for (const [userId, reads] of cache) {
    for (const [connectionName, read] of reads) {
      if (now - read.at >= INTEGRATION_TOOLS_TTL_MS) reads.delete(connectionName);
    }
    if (reads.size === 0) cache.delete(userId);
  }
}

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

function accountOf(row: IntegrationConnectionRow, status: IntegrationStatus): IntegrationAccount {
  return {
    provider: row.provider,
    connection: row.connectionName,
    ...(row.label !== undefined && row.label !== "" ? { label: row.label } : undefined),
    status,
  };
}

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

interface AccountAsked {
  readonly params: { readonly provider: string };
  readonly query?: { readonly connection?: string | undefined } | undefined;
}

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

function holdsAccountPlace(seams: IntegrationsAppSeams, row: IntegrationConnectionRow): boolean {
  return (
    row.status === INTEGRATION_ROW_STATUS.CONNECTED ||
    row.status === INTEGRATION_ROW_STATUS.EXPIRED ||
    signInStands(seams, row.stateIssuedAt)
  );
}

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
    yield* recordServerEvent(
      SERVER_EVENT.INTEGRATION_CONNECTION_CREATE,
      { userId: row.userId },
      {
        provider: row.provider,
      },
    );
  }
  return { completed, ...(accountName !== undefined ? { accountName } : undefined) };
});

interface Standing {
  readonly status: IntegrationStatus;
  readonly accountName?: string;
}

function standingWithoutSignIn(row: IntegrationConnectionRow): IntegrationStatus {
  return row.status === INTEGRATION_ROW_STATUS.EXPIRED
    ? INTEGRATION_STATUS.EXPIRED
    : INTEGRATION_STATUS.DISCONNECTED;
}

const standingStatus = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
  connector: ConnectorService,
  row: IntegrationConnectionRow | undefined,
): Effect.fn.Return<Standing, HostedRefusal, DatabaseServices> {
  if (row === undefined) return { status: INTEGRATION_STATUS.DISCONNECTED };
  if (row.status === INTEGRATION_ROW_STATUS.CONNECTED)
    return { status: INTEGRATION_STATUS.CONNECTED };
  const underWay = signInStands(seams, row.stateIssuedAt) ? row.state : undefined;
  if (underWay === undefined) return { status: standingWithoutSignIn(row) };
  const settled = yield* settledSignIn(seams, connector, row, underWay);
  if (settled.completed) {
    return {
      status: INTEGRATION_STATUS.CONNECTED,
      ...(settled.accountName !== undefined ? { accountName: settled.accountName } : undefined),
    };
  }
  return { status: INTEGRATION_STATUS.PENDING };
});

const ACCOUNT_NAME_TIMEOUT = Duration.seconds(2);

const ACCOUNT_NAME_TOOL_TIMEOUT = Duration.seconds(4);

const apiAccountAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  url: string,
  token: Redacted.Redacted,
): Effect.fn.Return<unknown, unknown, HttpClient.HttpClient> {
  const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
  return yield* client
    .execute(
      HttpClientRequest.get(url).pipe(
        HttpClientRequest.bearerToken(Redacted.value(token)),
        HttpClientRequest.acceptJson,
      ),
    )
    .pipe(
      Effect.flatMap((response) => response.json),
      Effect.scoped,
      Effect.timeout(ACCOUNT_NAME_TIMEOUT),
    );
});

const providerAccountName = /* @__PURE__ */ Effect.fnUntraced(function* (
  provider: IntegrationProvider,
  read: AccountNameRead,
  token: Redacted.Redacted,
): Effect.fn.Return<string | undefined, unknown, HttpClient.HttpClient> {
  const name =
    "URL" in read
      ? read.NAME(yield* apiAccountAnswer(read.URL, token))
      : read.NAME(
          yield* readMcpTool(
            INTEGRATION[provider].MCP_URL,
            Redacted.value(token),
            read.TOOL,
            read.ARGUMENTS,
            ACCOUNT_NAME_TOOL_TIMEOUT,
          ),
        );
  return Option.getOrUndefined(Option.flatMapNullishOr(name, accountNameLine));
});

const labeledRow = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
  unnamed: UnnamedHold,
  connector: ConnectorService,
  row: IntegrationConnectionRow,
  status: IntegrationStatus,
): Effect.fn.Return<
  IntegrationConnectionRow,
  HostedRefusal,
  DatabaseServices | HttpClient.HttpClient
> {
  const { ACCOUNT_NAME }: IntegrationDefinition = INTEGRATION[row.provider];
  if (!integrationLabelUnread(row.provider, row.label) || status !== INTEGRATION_STATUS.CONNECTED)
    return row;
  if (row.state !== undefined && signInStands(seams, row.stateIssuedAt)) return row;
  const grant = row.connectedAt?.getTime();
  const held = unnamed.get(row.userId)?.get(row.connectionName);
  if (ACCOUNT_NAME !== undefined && held !== undefined && held.connectedAt === grant) return row;
  const issued = yield* Effect.result(connector.token(row.connectSubject, { fresh: false }));
  if (Result.isFailure(issued)) return row;
  const { accountName, token } = issued.success;
  const named =
    accountName !== undefined || ACCOUNT_NAME === undefined
      ? Result.succeed(undefined)
      : yield* Effect.result(providerAccountName(row.provider, ACCOUNT_NAME, token));
  const unanswered = Result.isFailure(named) || named.success === undefined;
  if (ACCOUNT_NAME !== undefined && accountName === undefined && unanswered) {
    const read: UnnamedRead = { at: seams.now(), connectedAt: grant };
    unnamed.set(row.userId, (unnamed.get(row.userId) ?? new Map()).set(row.connectionName, read));
  }
  if (Result.isFailure(named)) return row;
  const label = accountName ?? named.success ?? "";
  yield* hostedStoreOrUnavailable(seams.fillLabel(row, label));
  return { ...row, label };
});

interface ProviderStanding {
  readonly status: IntegrationStatus;
  readonly accounts: readonly IntegrationAccount[];
}

const providerStanding = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
  unnamed: UnnamedHold,
  connector: ConnectorService,
  provider: IntegrationProvider,
  rows: readonly IntegrationConnectionRow[],
  settles: boolean,
): Effect.fn.Return<ProviderStanding, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  const held = providerRows(rows, provider);
  const settled = yield* Effect.forEach(
    held,
    (row) => {
      if (!settles) {
        const standing: Standing = { status: storedStanding(seams, row) };
        return Effect.succeed({ row, standing });
      }
      return Effect.gen(function* () {
        const standing = yield* standingStatus(seams, connector, row);
        const settled =
          standing.accountName !== undefined && (row.label === undefined || row.label === "")
            ? { ...row, label: standing.accountName }
            : row;
        return {
          row: yield* labeledRow(seams, unnamed, connector, settled, standing.status),
          standing,
        };
      });
    },
    { concurrency: "unbounded" },
  );
  const first = settled.find(({ row }) => row.connectionName === provider);
  return {
    status: first?.standing.status ?? INTEGRATION_STATUS.DISCONNECTED,
    accounts: settled
      .filter(({ standing }) => standing.status !== INTEGRATION_STATUS.DISCONNECTED)
      .map(({ row, standing }) => accountOf(row, standing.status)),
  };
});

const statusesAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IntegrationsAppSeams,
  unnamed: UnnamedHold,
  userId: string,
  settles: boolean,
): Effect.fn.Return<
  IntegrationStatusesRead,
  HostedRefusal,
  DatabaseServices | IntegrationConnect | GitHubApp | HttpClient.HttpClient
> {
  const connect = yield* hostedStoreOrUnavailable(accountIntegrationConnect(userId));
  heldReadsSwept(unnamed, seams.now());
  const anyConfigured = INTEGRATION_PROVIDER_LIST.some((provider) => connect[provider].configured);
  const rows = anyConfigured ? yield* hostedStoreOrUnavailable(seams.readConnections(userId)) : [];
  const unavailable: ProviderStanding = {
    status: INTEGRATION_STATUS.UNAVAILABLE,
    accounts: [],
  };
  const standings = yield* Effect.forEach(
    INTEGRATION_PROVIDER_LIST,
    (provider) =>
      Effect.map(
        INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN
          ? Effect.map(
              githubIntegrationStatus(userId),
              (status): ProviderStanding => ({ status, accounts: [] }),
            )
          : connect[provider].configured
            ? providerStanding(seams, unnamed, connect[provider], provider, rows, settles)
            : Effect.succeed(unavailable),
        (standing) => ({ provider, ...standing }),
      ),
    { concurrency: "unbounded" },
  );
  const integrations = Object.fromEntries(
    standings.map(({ provider, status }) => [provider, status]),
  );
  const accounts = standings.flatMap((standing) => standing.accounts);
  const addable = standings
    .filter(
      ({ provider, accounts: held }) =>
        connect[provider].configured &&
        connect[provider].multipleAccounts &&
        held.length < INTEGRATION_ACCOUNTS_MAX,
    )
    .map(({ provider }) => provider);
  return {
    integrations,
    ...(accounts.length > 0 ? { accounts } : undefined),
    ...(addable.length > 0 ? { addable } : undefined),
  };
});

const TOOLS_PROBLEM_OF = {
  [MCP_TOOLS_FAILURE.REFUSED]: INTEGRATION_TOOLS_PROBLEM.REFUSED,
  [MCP_TOOLS_FAILURE.REJECTED]: INTEGRATION_TOOLS_PROBLEM.REJECTED,
  [MCP_TOOLS_FAILURE.UNREACHABLE]: INTEGRATION_TOOLS_PROBLEM.UNREACHABLE,
  [MCP_TOOLS_FAILURE.UNREADABLE]: INTEGRATION_TOOLS_PROBLEM.UNREADABLE,
} as const satisfies Record<McpToolsFailureReason, IntegrationToolsProblemReason>;

function toolsProblem(failure: McpToolsFailure) {
  return {
    reason: TOOLS_PROBLEM_OF[failure.reason],
    ...(failure.serverMessage !== undefined ? { message: failure.serverMessage } : undefined),
  };
}

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

const GRANT_REFUSED = "grant-refused";

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

function callbackUrl(requestUrl: string, state: string): string {
  const url = new URL(HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS_CONNECTED, requestUrl);
  url.searchParams.set(INTEGRATION_CALLBACK_QUERY.STATE, state);
  return url.toString();
}

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
    const left = providerRows(rows, provider).filter((row) => !holdsAccountPlace(seams, row));
    yield* Effect.forEach(
      left,
      (row) =>
        row.state === undefined
          ? Effect.void
          : Effect.asVoid(
              hostedStoreOrUnavailable(seams.endSignIn(userId, row.connectionName, row.state)),
            ),
      { discard: true },
    );
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

export function integrationsProcedures(seams: IntegrationsProcedureSeams) {
  const cache: ToolsCache = new Map();
  const unnamed: UnnamedHold = new Map();
  const integrations = hosted.integrations.use(accountMiddleware(seams.resolveUserId));
  return {
    statuses: integrations.statuses.effect(function* ({ context }) {
      return yield* statusesAnswer(
        seams,
        unnamed,
        context.userId,
        hostedCarriesBearer(context.request),
      );
    }),
    settle: integrations.settle.effect(function* ({ context }) {
      return yield* statusesAnswer(seams, unnamed, context.userId, true);
    }),
    github: integrations.github.effect(function* ({ context }) {
      return { status: yield* githubIntegrationStatus(context.userId) };
    }),
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
      const { url } = yield* connector
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
      const txid = yield* hostedStoreOrUnavailable(seams.beginSignIn(userId, account, state));
      if (txid === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return { url, connection: account.connectionName, txid };
    }),
    tools: integrations.tools.effect(function* ({ context, input }) {
      const { provider, connectionName } = yield* requestedAccount({
        params: { provider: input.provider },
        query: { connection: input.connection },
      });
      const userId = context.userId;
      const row = yield* standingGrant(seams, provider, connectionName, userId);
      const grant = row?.connectedAt?.getTime();
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
      heldReadsSwept(cache, seams.now());
      if (holds) {
        const accountReads = cache.get(userId) ?? new Map<string, ToolsRead>();
        accountReads.set(connectionName, { at: seams.now(), connectedAt: grant, tools });
        cache.set(userId, accountReads);
      }
      return { tools };
    }),
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
      const txid =
        row?.state === undefined
          ? undefined
          : yield* hostedStoreOrUnavailable(seams.endSignIn(userId, row.connectionName, row.state));
      const after = yield* hostedStoreOrUnavailable(seams.readConnections(userId));
      return {
        status: storedStanding(seams, named(after)),
        ...(txid === undefined ? undefined : { txid }),
      };
    }),
    disconnect: integrations.disconnect.effect(function* ({ context, input }) {
      const { provider, connectionName } = yield* requestedAccount(input);
      const userId = context.userId;
      if (INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN) {
        return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      }
      const rows = yield* hostedStoreOrUnavailable(seams.readConnections(userId));
      const row = rows.find((each) => each.connectionName === connectionName);
      if (row === undefined) return { status: INTEGRATION_STATUS.DISCONNECTED };
      const txid = yield* hostedStoreOrUnavailable(seams.deleteAccount(row));
      if (txid !== undefined) {
        yield* revokeIntegrationGrant(row);
        yield* recordServerEvent(
          SERVER_EVENT.INTEGRATION_CONNECTION_DELETE,
          { userId },
          {
            provider: row.provider,
          },
        );
        return { status: INTEGRATION_STATUS.DISCONNECTED, txid };
      }
      const standing = (yield* hostedStoreOrUnavailable(seams.readConnections(userId))).find(
        (each) => each.connectionName === connectionName,
      );
      return {
        status: standing === undefined ? INTEGRATION_STATUS.DISCONNECTED : rowStatus(standing),
      };
    }),
    rename: integrations.rename.effect(function* ({ context, input }) {
      const { provider, connectionName } = yield* requestedAccount(input);
      const userId = context.userId;
      const txid = yield* hostedStoreOrUnavailable(
        seams.renameConnection(userId, connectionName, input.body.label),
      );
      if (txid === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { ...(yield* accountAnswer(seams, userId, provider, connectionName)), txid };
    }),
  };
}
