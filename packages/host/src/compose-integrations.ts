import type { HostedIntegrationsClient, HostedMcpClientsClient } from "@repo/features";
import type { IntegrationLiveRow } from "@repo/features/integration-live";
import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationConnectView,
  type IntegrationProviderParams,
  type IntegrationStatusView,
  integrationProviderParamsSchema,
  integrationRenameParamsSchema,
} from "@repo/features/integration-view";
import {
  INTEGRATION_STATUS,
  type IntegrationToolsAnswer,
  integrationConnectionOf,
} from "@repo/features/integration-wire";
import type { LIVE_READ } from "@repo/features/live-wire";
import {
  MCP_CLIENTS_CALL_FAILURE,
  type McpClientsView,
  mcpClientRevokeParamsSchema,
} from "@repo/features/mcp-client-view";
import type { McpClientsAnswer } from "@repo/features/mcp-client-wire";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  readParams,
} from "@repo/gateway";
import { declaredMethod, type EntityPool } from "@repo/sync";
import { Effect, FiberHandle, FiberMap, Option, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import {
  type AppIntegrations,
  type AppIntegrationTools,
  type AppMcpClients,
  NO_KEYS_HELD,
} from "./app-state.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostMethodTable } from "./gateway-door.js";
import { type AccountHeld, accountHeld, type HeldFetch, heldFetch } from "./held-fetch.js";
import type { HostKernel } from "./host-kernel.js";
import {
  type HeldIntegrations,
  heldIntegrations,
  type IntegrationRename,
  integrationRename,
} from "./integrations-follow.js";
import type { RunMode } from "./run-mode.js";
import type { WindowFocus } from "./window-focus.js";

export type IntegrationsClient = Pick<
  HostedIntegrationsClient,
  "statusesLive" | "settle" | "github" | "connect" | "cancel" | "disconnect" | "tools" | "rename"
>;

export type McpClientsClient = Pick<HostedMcpClientsClient, "list" | "revoke">;

export interface IntegrationsDependencies {
  kernel: Pick<HostKernel, "emit"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  accountId: () => string | undefined;
  client: IntegrationsClient;
  mcpClients: McpClientsClient;
  openExternal: (url: string) => Effect.Effect<boolean>;
  focus: WindowFocus;
  pool: EntityPool;
}

export interface IntegrationsComposer extends Composer {
  readonly open: Effect.Effect<void>;
  readonly reset: Effect.Effect<void>;
  readonly githubMoved: Effect.Effect<void>;
}

const UNANSWERED = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED } as const;

const MCP_CLIENTS_UNANSWERED = { failure: MCP_CLIENTS_CALL_FAILURE.UNANSWERED } as const;

type Asked = <Answer>(
  call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
) => Effect.Effect<Answer | typeof UNANSWERED>;

interface HeldMcpClients {
  readonly read: HeldFetch<string, McpClientsAnswer>;
  readonly hold: AccountHeld;
}

interface Held {
  readonly integrations: HeldIntegrations;
  readonly integrationsHold: FiberHandle.FiberHandle<void>;
  readonly tools: HeldFetch<string, IntegrationToolsAnswer>;
  readonly toolHolds: FiberMap.FiberMap<string>;
  readonly clients: HeldMcpClients;
}

function serverOf(
  server: string,
): Pick<IntegrationProviderParams, "provider" | "connection"> | undefined {
  const provider = integrationConnectionOf(server)?.provider;
  if (provider === undefined) return undefined;
  return server === provider ? { provider } : { provider, connection: server };
}

function serverName({ provider, connection }: IntegrationProviderParams): string {
  return connection ?? provider;
}

export function composeIntegrations(
  dependencies: IntegrationsDependencies,
): Effect.Effect<IntegrationsComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const { kernel, account, client, mcpClients, accountId, focus } = dependencies;
    const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();
    const asked: Asked = (call) =>
      gate()
        ? Effect.provideService(call, HttpClient.HttpClient, http)
        : Effect.succeed(UNANSWERED);
    const integrations = yield* heldIntegrations({
      seal: (userId, poll, after) => asked(client.statusesLive(userId, poll, after)),
      github: Effect.suspend(() => asked(client.github())),
      settle: Effect.suspend(() => Effect.asVoid(asked(client.settle()))),
      gate,
      focus,
      pool: dependencies.pool,
      tell: (held: AppIntegrations) =>
        kernel.emit(GATEWAY_EVENT.INTEGRATIONS_CHANGED, carried(held)),
    });
    const tools = yield* heldFetch<typeof LIVE_READ.INTEGRATION_TOOLS, string>({
      empty: NO_KEYS_HELD,
      path: (server) => [server],
      gate,
      focus,
      fetch: (server) => {
        const target = serverOf(server);
        if (target === undefined) return Effect.succeed(Option.none());
        const read = client.tools(target.provider, { connection: target.connection });
        return Effect.map(asked(read), (answer) =>
          "failure" in answer ? Option.none() : Option.some(answer),
        );
      },
      tell: (held: AppIntegrationTools) =>
        kernel.emit(GATEWAY_EVENT.INTEGRATION_TOOLS_CHANGED, carried(held)),
    });
    const clients = yield* heldFetch<typeof LIVE_READ.MCP_CLIENTS, string>({
      empty: NO_KEYS_HELD,
      path: (userId) => [userId],
      gate,
      focus,
      fetch: (userId) =>
        userId !== accountId()
          ? Effect.succeed(Option.none())
          : Effect.map(asked(mcpClients.list()), (answer) =>
              "failure" in answer ? Option.none() : Option.some(answer),
            ),
      tell: (held: AppMcpClients) => kernel.emit(GATEWAY_EVENT.MCP_CLIENTS_CHANGED, carried(held)),
    });
    return composed(dependencies, asked, {
      integrations,
      integrationsHold: yield* FiberHandle.make<void>(),
      tools,
      toolHolds: yield* FiberMap.make<string>(),
      clients: { read: clients, hold: yield* accountHeld(clients, accountId) },
    });
  });
}

function composed(
  dependencies: IntegrationsDependencies,
  asked: Asked,
  { integrations, integrationsHold, tools, toolHolds, clients }: Held,
): IntegrationsComposer {
  const { client, mcpClients, accountId, openExternal, pool } = dependencies;

  type Params = Parameters<GatewayMethodTable[keyof GatewayMethodTable] & object>[0];

  const targetOf = (params: Params) =>
    readParams(
      integrationProviderParamsSchema,
      params,
      "the ask names a provider this build knows",
    );

  let holding = false;
  const holdIntegrations = Effect.suspend(() => {
    const userId = dependencies.accountId();
    return userId === undefined
      ? FiberHandle.clear(integrationsHold)
      : FiberHandle.run(
          integrationsHold,
          Effect.scoped(Effect.andThen(integrations.hold(userId), Effect.never)),
        );
  });

  const confirmed = (
    connection: string,
    txid: string | undefined,
    moves: (row: IntegrationLiveRow | undefined) => boolean,
  ) =>
    Effect.suspend(() => {
      const userId = dependencies.accountId();
      return userId === undefined
        ? Effect.void
        : integrations.confirmed(userId, connection, txid, moves);
    });

  const connect = ({
    provider,
    connection,
    add,
  }: IntegrationProviderParams): Effect.Effect<IntegrationConnectView> =>
    Effect.gen(function* () {
      const answer = yield* asked(client.connect(provider, { connection, add }));
      if ("failure" in answer) return answer;
      const opened = yield* openExternal(answer.url);
      if (!opened) return { failure: INTEGRATION_CALL_FAILURE.NOT_OPENED };
      yield* confirmed(
        answer.connection ?? connection ?? provider,
        answer.txid,
        (row) => row?.status !== INTEGRATION_STATUS.CONNECTED,
      );
      return answer.connection === undefined
        ? { opened: true }
        : { opened: true, connection: answer.connection };
    });

  const rename = integrationRename(
    ({ provider, connection, label }) => asked(client.rename(provider, connection, label)),
    ({ connection }, label) => {
      const userId = accountId();
      const synced = userId === undefined ? undefined : integrations.synced(userId, connection);
      return (
        synced !== undefined && (synced.label === "" ? null : synced.label) === (label ?? null)
      );
    },
  );

  const revoke = (clientId: string): Effect.Effect<McpClientsView> =>
    Effect.gen(function* () {
      const answer = yield* asked(mcpClients.revoke(clientId));
      if ("failure" in answer) return MCP_CLIENTS_UNANSWERED;
      const userId = accountId();
      if (userId !== undefined) yield* clients.read.answered(userId, answer);
      return answer;
    });

  const methods: HostMethodTable = {
    [GATEWAY_METHOD.MCP_CLIENTS_FOLLOW]: () => Effect.as(clients.hold.follow, {}),
    [GATEWAY_METHOD.MCP_CLIENTS_UNFOLLOW]: () => Effect.as(clients.hold.unfollow, {}),
    [GATEWAY_METHOD.MCP_CLIENTS_RETRY]: () =>
      Effect.suspend(() => {
        const userId = accountId();
        return Effect.as(userId === undefined ? Effect.void : clients.read.retry(userId), {});
      }),
    [GATEWAY_METHOD.MCP_CLIENTS_REVOKE]: (params) =>
      Effect.gen(function* () {
        const { clientId } = yield* readParams(
          mcpClientRevokeParamsSchema,
          params,
          "a revoke names one client",
        );
        return carried<McpClientsView>(yield* revoke(clientId));
      }),
    [GATEWAY_METHOD.INTEGRATIONS_FOLLOW]: () =>
      Effect.gen(function* () {
        holding = true;
        yield* holdIntegrations;
        return {};
      }),
    [GATEWAY_METHOD.INTEGRATIONS_UNFOLLOW]: () =>
      Effect.gen(function* () {
        holding = false;
        yield* FiberHandle.clear(integrationsHold);
        return {};
      }),
    [GATEWAY_METHOD.INTEGRATIONS_RETRY]: () =>
      Effect.gen(function* () {
        const userId = dependencies.accountId();
        if (userId !== undefined) yield* integrations.retry(userId);
        return {};
      }),
    [GATEWAY_METHOD.INTEGRATIONS_CONNECT]: (params) =>
      Effect.gen(function* () {
        const target = yield* targetOf(params);
        return carried<IntegrationConnectView>(yield* connect(target));
      }),
    [GATEWAY_METHOD.INTEGRATIONS_TOOLS_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const server = serverName(yield* targetOf(params));
        yield* FiberMap.run(
          toolHolds,
          server,
          Effect.scoped(Effect.andThen(tools.hold(server), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.INTEGRATIONS_TOOLS_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        yield* FiberMap.remove(toolHolds, serverName(yield* targetOf(params)));
        return {};
      }),
    [GATEWAY_METHOD.INTEGRATIONS_TOOLS_RETRY]: (params) =>
      Effect.gen(function* () {
        yield* tools.retry(serverName(yield* targetOf(params)));
        return {};
      }),
    [GATEWAY_METHOD.INTEGRATIONS_CANCEL]: (params) =>
      Effect.gen(function* () {
        const { provider, connection } = yield* targetOf(params);
        const answer = yield* asked(client.cancel(provider, { connection }));
        if (!("failure" in answer)) {
          yield* confirmed(
            connection ?? provider,
            answer.txid,
            (row) => (row?.status ?? INTEGRATION_STATUS.DISCONNECTED) !== answer.status,
          );
        }
        return carried<IntegrationStatusView>(answer);
      }),
    [GATEWAY_METHOD.INTEGRATIONS_DISCONNECT]: (params) =>
      Effect.gen(function* () {
        const { provider, connection } = yield* targetOf(params);
        const answer = yield* asked(client.disconnect(provider, { connection }));
        if (!("failure" in answer)) {
          yield* confirmed(connection ?? provider, answer.txid, (row) => row !== undefined);
        }
        return carried<IntegrationStatusView>(answer);
      }),
    [GATEWAY_METHOD.INTEGRATIONS_RENAME]: declaredMethod(pool, rename, (params) =>
      Effect.map(
        readParams(integrationRenameParamsSchema, params, "the ask names an account and a label"),
        (read): IntegrationRename => {
          const userId = accountId();
          const held =
            userId === undefined ? undefined : integrations.synced(userId, read.connection);
          return { ...read, id: held?.id };
        },
      ),
    ),
  };

  return {
    methods,
    lifetime: Effect.void,
    open: Effect.gen(function* () {
      yield* tools.open;
      yield* clients.hold.open;
      if (holding) yield* holdIntegrations;
    }),
    reset: Effect.gen(function* () {
      yield* tools.end;
      yield* clients.read.end;
      yield* integrations.end;
    }),
    githubMoved: integrations.githubMoved,
  };
}
