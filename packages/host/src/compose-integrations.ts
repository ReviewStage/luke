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
import { type McpClientsView, mcpClientRevokeParamsSchema } from "@repo/features/mcp-client-view";
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

/**
 * compose-integrations.ts -- the account's integrations, asked of the service on the window's behalf: where each stands, held, a sign-in begun or canceled, a connection ended, an account named; and the outside MCP clients the account allowed, held and revoked.
 *
 * Where the integrations stand is held for the windows that draw one
 * (`integrations-follow.ts`), under the account signed in, followed on the
 * service's live read with GitHub's standing asked beside it, and told as
 * `INTEGRATIONS_CHANGED` events to the app state every window draws. A
 * Connect asks the service to begin a sign-in to one provider and opens the
 * address it answered in the browser through the native node, here, so the
 * address, which begins a grant for the account, never reaches a window or
 * a report; the window hears only whether the browser was sent, and the
 * held read draws how the sign-in settled once the service's callback, or
 * the host's own settling while it stands pending, writes it. A Connect, a
 * Cancel, and a Disconnect each answer the window only once the held read
 * carries the transaction the service wrote it in, where it moves what that
 * read shows, so the window draws the write from the read as the answer
 * lands, with no overlay of its own. A rename is a write declared on the
 * sync engine (`integrationRename`), drawn over the held read the moment it
 * is asked and answered as the service answers. Each server's
 * tools are fetched for the windows that hold them (`held-fetch.ts`), by the
 * server's name, asked as a window first holds them, again as a window comes
 * forward, which is how the developer comes back from mending a connection
 * in the browser, and on Try again, and told as `INTEGRATION_TOOLS_CHANGED`
 * events. Behind a closed account gate, or on a run that sends nothing,
 * every ask answers unanswered.
 *
 * The outside MCP clients the account allowed are fetched the same way,
 * under the account signed in, while Settings › MCP holds them,
 * and told as `MCP_CLIENTS_CHANGED` events. A revoke that lands lays the
 * clients it answered as they then stand before it answers, so the
 * window's list already stands without the client; one that did not finish
 * answers unanswered and lays nothing, so the client stands with its Revoke.
 */

/** The service's side of the integrations, as this concern asks it. */
export type IntegrationsClient = Pick<
  HostedIntegrationsClient,
  "statusesLive" | "settle" | "github" | "connect" | "cancel" | "disconnect" | "tools" | "rename"
>;

/** The service's side of the outside MCP clients, as this concern asks it. */
export type McpClientsClient = Pick<HostedMcpClientsClient, "list" | "revoke">;

export interface IntegrationsDependencies {
  kernel: Pick<HostKernel, "emit"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, by its id, which the held integrations and the outside MCP clients are held under; none where nobody is. */
  accountId: () => string | undefined;
  client: IntegrationsClient;
  mcpClients: McpClientsClient;
  /** Hands an address to the operating system; answers whether it took it. */
  openExternal: (url: string) => Effect.Effect<boolean>;
  /** The windows coming forward, on which every server's tools a window holds, GitHub's standing, and the outside MCP clients where a window holds them, are asked again. */
  focus: WindowFocus;
  /** The sync engine's pool, which the held integrations stand in. */
  pool: EntityPool;
}

export interface IntegrationsComposer extends Composer {
  /** Every server's tools a window holds followed anew, and the windows' holds on where the integrations stand and on the outside MCP clients taken anew under the account signed in, as the account gate opening asks. */
  readonly open: Effect.Effect<void>;
  /** Every server's tools, the held integrations, and the outside MCP clients let go, as a sign-out lets them go; the windows' holds stand. */
  readonly reset: Effect.Effect<void>;
  /** GitHub's standing asked again, as a GitHub disconnect that answered asks; done once each ask has landed. */
  readonly githubMoved: Effect.Effect<void>;
}

const UNANSWERED = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED } as const;

/** A call of the service asked behind the gate, or unanswered where the gate stands closed. */
type Asked = <Answer>(
  call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
) => Effect.Effect<Answer | typeof UNANSWERED>;

/** The outside MCP clients the host holds for the windows, by the account, and the windows' one hold on them. */
interface HeldMcpClients {
  readonly read: HeldFetch<string, McpClientsAnswer>;
  readonly hold: AccountHeld;
}

/** What the composer holds for the windows: where the integrations stand, each server's tools, and the outside MCP clients, and the windows' holds on them. */
interface Held {
  readonly integrations: HeldIntegrations;
  /** The windows' hold on where the integrations stand, one fiber standing until let go, under the account signed in as it was taken. */
  readonly integrationsHold: FiberHandle.FiberHandle<void>;
  /** Each server's tools, by its name. */
  readonly tools: HeldFetch<string, IntegrationToolsAnswer>;
  /** The windows' hold on each server's tools, one fiber standing until let go. */
  readonly toolHolds: FiberMap.FiberMap<string>;
  readonly clients: HeldMcpClients;
}

/** The account a server's name stands for, as the service is asked it: its provider, and the account where the name is not the provider's own; none for a name this build cannot read. */
function serverOf(
  server: string,
): Pick<IntegrationProviderParams, "provider" | "connection"> | undefined {
  const provider = integrationConnectionOf(server)?.provider;
  if (provider === undefined) return undefined;
  return server === provider ? { provider } : { provider, connection: server };
}

/** The name a server goes by, its account's where it names one, else its provider's. */
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
    /** The service asked behind the gate, over the host's own HTTP client. */
    const asked: Asked = (call) =>
      gate()
        ? Effect.provideService(call, HttpClient.HttpClient, http)
        : Effect.succeed(UNANSWERED);
    const integrations = yield* heldIntegrations({
      seal: (userId, poll, after) => asked(client.statusesLive(userId, poll, after)),
      // Note that each ask is made afresh, behind the gate as it stands when it is asked.
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
    // Note that the clients are asked for the account signed in now alone, since the service answers that account's.
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

/** The composer's one table, built from its seams; nothing here starts anything but what a window holds. */
function composed(
  dependencies: IntegrationsDependencies,
  asked: Asked,
  { integrations, integrationsHold, tools, toolHolds, clients }: Held,
): IntegrationsComposer {
  const { client, mcpClients, accountId, openExternal, pool } = dependencies;

  type Params = Parameters<GatewayMethodTable[keyof GatewayMethodTable] & object>[0];

  /** The account the params name (a provider, and the account and an add where named), or the invalid-params refusal. */
  const targetOf = (params: Params) =>
    readParams(
      integrationProviderParamsSchema,
      params,
      "the ask names a provider this build knows",
    );

  /** Whether any window holds where the integrations stand, so the gate opening holds them anew under whoever signed in. */
  let holding = false;
  /** The windows' hold taken under the account signed in now, in place of any taken before; none while nobody is. */
  const holdIntegrations = Effect.suspend(() => {
    const userId = dependencies.accountId();
    return userId === undefined
      ? FiberHandle.clear(integrationsHold)
      : FiberHandle.run(
          integrationsHold,
          Effect.scoped(Effect.andThen(integrations.hold(userId), Effect.never)),
        );
  });

  /** A write to one account confirmed once the held read carries it, where it moves what that read shows of the account (`HeldIntegrations.confirmed`). */
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

  /**
   * A sign-in begun and its address opened; the window hears whether it
   * was, and the account it signs in, and nothing of the address, once the
   * held read draws it pending. Note that an account standing connected
   * stays so while it signs in again, so its sign-in moves nothing to wait on.
   */
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

  /** A rename drawn over the held read at once, its label kept as the service trims it. */
  const rename = integrationRename(
    ({ provider, connection, label }) => asked(client.rename(provider, connection, label)),
    ({ connection }, label) => {
      const userId = accountId();
      const synced = userId === undefined ? undefined : integrations.synced(userId, connection);
      // Note that an account with no label is answered with none, though its row may carry an empty one.
      return (
        synced !== undefined && (synced.label === "" ? null : synced.label) === (label ?? null)
      );
    },
  );

  /** One client revoked, and the clients it answered laid for the account signed in, so the windows' list stands without it as the revoke answers. */
  const revoke = (clientId: string): Effect.Effect<McpClientsView> =>
    Effect.gen(function* () {
      const answer = yield* asked(mcpClients.revoke(clientId));
      if ("failure" in answer) return answer;
      const userId = accountId();
      if (userId !== undefined) yield* clients.read.answered(userId, answer);
      return answer;
    });

  const methods: HostMethodTable = {
    // The outside MCP clients are held for the windows while Settings › MCP shows them, under the account signed in, and told only on the app state (`MCP_CLIENTS_CHANGED`); a revoke's own answer is laid there too.
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
    // Where the integrations stand is held for the windows while any draws one, under the account signed in, and told only on the app state (`INTEGRATIONS_CHANGED`).
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
    // A server's tools are held for the windows while a surface listing it shows, and told only on the app state (`INTEGRATION_TOOLS_CHANGED`). Note that the windows' hold is one fiber standing until let go, so a window holding it again holds nothing anew.
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
    // A Cancel answers once the held read draws the account where the Cancel left it.
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
    // A Disconnect answers once the held read no longer holds the account.
    [GATEWAY_METHOD.INTEGRATIONS_DISCONNECT]: (params) =>
      Effect.gen(function* () {
        const { provider, connection } = yield* targetOf(params);
        const answer = yield* asked(client.disconnect(provider, { connection }));
        if (!("failure" in answer)) {
          yield* confirmed(connection ?? provider, answer.txid, (row) => row !== undefined);
        }
        return carried<IntegrationStatusView>(answer);
      }),
    // A rename names the account's row the windows hold, where they hold one, which the pool draws it over.
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
    // Note that where the integrations stand is held anew under whoever signed in, in place of the hold before, rather than followed again under the account it was held for.
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
