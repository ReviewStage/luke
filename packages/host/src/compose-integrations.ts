import type { HostedIntegrationsClient, HostedMcpClientsClient } from "@repo/features";
import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationAccountView,
  type IntegrationConnectView,
  type IntegrationProviderParams,
  type IntegrationStatusesView,
  type IntegrationStatusView,
  type IntegrationToolsView,
  integrationProviderParamsSchema,
  integrationRenameParamsSchema,
} from "@repo/features/integration-view";
import type { LIVE_READ } from "@repo/features/live-wire";
import {
  MCP_CLIENTS_CALL_FAILURE,
  type McpClientsView,
  mcpClientRevokeParamsSchema,
} from "@repo/features/mcp-client-view";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  readParams,
} from "@repo/gateway";
import { Effect, FiberHandle, Option, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { type AppMcpClients, NO_KEYS_HELD } from "./app-state.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import { type HeldFetch, heldFetch } from "./held-fetch.js";
import type { HostKernel } from "./host-kernel.js";
import type { RunMode } from "./run-mode.js";
import type { WindowFocus } from "./window-focus.js";

/**
 * compose-integrations.ts -- the account's integrations, asked of the service on the window's behalf: where each stands, a sign-in begun or canceled, a connection ended, an account named; and the outside MCP clients the account allowed, held and revoked.
 *
 * Nothing of the integrations is held here. A Connect asks the service to
 * begin a sign-in to one provider and opens the address it answered in the
 * browser through the native node, here, so the address, which begins a
 * grant for the account, never reaches a window or a report; the window
 * hears only whether the browser was sent. It learns how the sign-in settled by reading where the
 * integrations stand again, which it does when it is shown and when the
 * developer comes back from the browser. Behind a closed account gate, or on
 * a run that sends nothing, every ask answers unanswered.
 *
 * The outside MCP clients the account allowed are a read the host holds
 * for the windows (`held-fetch.ts`) under the account signed in, while
 * Settings › Integrations shows them, asked again as a window comes
 * forward, and told only on the app state (`MCP_CLIENTS_CHANGED`). A revoke
 * that lands reads them again before it answers, so the window's list
 * already stands without the client; one that did not finish answers
 * unanswered and reads nothing, so the client stands with its Revoke.
 */

/** The service's side of the integrations, as this concern asks it. */
export type IntegrationsClient = Pick<
  HostedIntegrationsClient,
  "statuses" | "connect" | "cancel" | "disconnect" | "tools" | "rename"
>;

/** The service's side of the outside MCP clients, as this concern asks it. */
export type McpClientsClient = Pick<HostedMcpClientsClient, "list" | "revoke">;

export interface IntegrationsDependencies {
  kernel: Pick<HostKernel, "emit"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: IntegrationsClient;
  mcpClients: McpClientsClient;
  /** The account signed in now, by its id, which the outside MCP clients are held under; none where nobody is. */
  accountId: () => string | undefined;
  /** The windows coming forward, on which the outside MCP clients, where a window holds them, are asked again. */
  focus: WindowFocus;
  /** Hands an address to the operating system; answers whether it took it. */
  openExternal: (url: string) => Effect.Effect<boolean>;
}

export interface IntegrationsComposer extends Composer {
  /** The outside MCP clients held anew under the account signed in, as the gate opening asks. */
  readonly open: Effect.Effect<void>;
  /** The outside MCP clients let go and told none held, as a sign-out asks. */
  readonly reset: Effect.Effect<void>;
}

const UNANSWERED = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED } as const;

const MCP_CLIENTS_UNANSWERED = { failure: MCP_CLIENTS_CALL_FAILURE.UNANSWERED } as const;

/** The outside MCP clients the host holds for the windows, by the account, and the windows' hold on them. */
interface HeldMcpClients {
  readonly read: HeldFetch<string>;
  /** The windows' hold, one fiber standing until let go, under the account signed in as it was taken. */
  readonly hold: FiberHandle.FiberHandle<void>;
}

export function composeIntegrations(
  dependencies: IntegrationsDependencies,
): Effect.Effect<IntegrationsComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const { kernel, account, mcpClients, accountId, focus } = dependencies;
    const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();
    // Note that the clients are asked for the account signed in now alone, since the service answers that account's.
    const read = yield* heldFetch<typeof LIVE_READ.MCP_CLIENTS, string>({
      empty: NO_KEYS_HELD,
      path: (userId) => [userId],
      gate,
      focus,
      fetch: (userId) =>
        userId === accountId() && gate()
          ? Effect.map(
              Effect.provideService(mcpClients.list(), HttpClient.HttpClient, http),
              (answer) => ("failure" in answer ? Option.none() : Option.some(answer)),
            )
          : Effect.succeed(Option.none()),
      tell: (held: AppMcpClients) => kernel.emit(GATEWAY_EVENT.MCP_CLIENTS_CHANGED, carried(held)),
    });
    return composed(dependencies, http, { read, hold: yield* FiberHandle.make<void>() });
  });
}

/** The composer's one table, built from its seams; nothing here starts anything but the windows' hold on the outside MCP clients. */
function composed(
  dependencies: IntegrationsDependencies,
  http: HttpClient.HttpClient,
  held: HeldMcpClients,
): IntegrationsComposer {
  const { kernel, account, client, mcpClients, accountId, openExternal } = dependencies;
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();

  /** The service asked behind the gate, over the host's own HTTP client. */
  const asked = <Answer>(
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer | typeof UNANSWERED> =>
    gate() ? Effect.provideService(call, HttpClient.HttpClient, http) : Effect.succeed(UNANSWERED);

  type Params = Parameters<GatewayMethodTable[keyof GatewayMethodTable] & object>[0];

  /** The account the params name (a provider, and the account and an add where named), or the invalid-params refusal. */
  const targetOf = (params: Params) =>
    readParams(
      integrationProviderParamsSchema,
      params,
      "the ask names a provider this build knows",
    );

  /** A sign-in begun and its address opened; the window hears whether it was, and the account it signs in, and nothing of the address. */
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
      return answer.connection === undefined
        ? { opened: true }
        : { opened: true, connection: answer.connection };
    });

  /** Whether any window holds the outside MCP clients, so the gate opening for another account holds them anew under it. */
  let clientsHeld = false;
  /** The windows' hold on the outside MCP clients taken under the account signed in now, in place of any taken before; none while nobody is. */
  const holdClients = Effect.suspend(() => {
    const userId = accountId();
    return userId === undefined
      ? FiberHandle.clear(held.hold)
      : FiberHandle.run(
          held.hold,
          Effect.scoped(Effect.andThen(held.read.hold(userId), Effect.never)),
        );
  });

  /** One client revoked, and the clients read again once it landed, so the windows' list stands without it as the revoke answers. */
  const revoke = (clientId: string): Effect.Effect<McpClientsView> =>
    Effect.gen(function* () {
      const answer = yield* asked(mcpClients.revoke(clientId));
      if ("failure" in answer) return MCP_CLIENTS_UNANSWERED;
      const userId = accountId();
      if (userId !== undefined) yield* held.read.retry(userId);
      return answer;
    });

  const methods: GatewayMethodTable = {
    // The outside MCP clients are held for the windows while Settings › Integrations shows them, under the account signed in, and told only on the app state (`MCP_CLIENTS_CHANGED`).
    [GATEWAY_METHOD.MCP_CLIENTS_FOLLOW]: () =>
      Effect.gen(function* () {
        clientsHeld = true;
        yield* holdClients;
        return {};
      }),
    [GATEWAY_METHOD.MCP_CLIENTS_UNFOLLOW]: () =>
      Effect.gen(function* () {
        clientsHeld = false;
        yield* FiberHandle.clear(held.hold);
        return {};
      }),
    [GATEWAY_METHOD.MCP_CLIENTS_RETRY]: () =>
      Effect.gen(function* () {
        const userId = accountId();
        if (userId !== undefined) yield* held.read.retry(userId);
        return {};
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
    [GATEWAY_METHOD.INTEGRATIONS_STATUS]: () =>
      Effect.map(asked(client.statuses()), (answer) => carried<IntegrationStatusesView>(answer)),
    [GATEWAY_METHOD.INTEGRATIONS_CONNECT]: (params) =>
      Effect.gen(function* () {
        const target = yield* targetOf(params);
        return carried<IntegrationConnectView>(yield* connect(target));
      }),
    [GATEWAY_METHOD.INTEGRATIONS_TOOLS]: (params) =>
      Effect.gen(function* () {
        const { provider, connection } = yield* targetOf(params);
        return carried<IntegrationToolsView>(yield* asked(client.tools(provider, { connection })));
      }),
    [GATEWAY_METHOD.INTEGRATIONS_CANCEL]: (params) =>
      Effect.gen(function* () {
        const { provider, connection } = yield* targetOf(params);
        return carried<IntegrationStatusView>(
          yield* asked(client.cancel(provider, { connection })),
        );
      }),
    [GATEWAY_METHOD.INTEGRATIONS_DISCONNECT]: (params) =>
      Effect.gen(function* () {
        const { provider, connection } = yield* targetOf(params);
        const answer = yield* asked(client.disconnect(provider, { connection }));
        return carried<IntegrationStatusView>(answer);
      }),
    [GATEWAY_METHOD.INTEGRATIONS_RENAME]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          integrationRenameParamsSchema,
          params,
          "the ask names an account and a label",
        );
        const { provider, connection, label } = read;
        return carried<IntegrationAccountView>(
          yield* asked(client.rename(provider, connection, label)),
        );
      }),
  };

  // Note that the clients are held anew under whoever signed in, in place of the hold before, rather than followed again under the account they were held for.
  const open = Effect.suspend(() => (clientsHeld ? holdClients : Effect.void));
  const reset = held.read.end;

  return { methods, lifetime: Effect.void, open, reset };
}
