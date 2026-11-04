import type { HostedIntegrationsClient } from "@repo/features";
import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationAccountView,
  type IntegrationConnectView,
  type IntegrationProviderParams,
  type IntegrationStatusesView,
  type IntegrationStatusView,
  integrationProviderParamsSchema,
  integrationRenameParamsSchema,
} from "@repo/features/integration-view";
import {
  type IntegrationToolsAnswer,
  integrationConnectionOf,
} from "@repo/features/integration-wire";
import type { LIVE_READ } from "@repo/features/live-wire";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  readParams,
} from "@repo/gateway";
import { Effect, FiberMap, Option, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { type AppIntegrationTools, NO_KEYS_HELD } from "./app-state.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostMethodTable } from "./gateway-door.js";
import { type HeldFetch, heldFetch } from "./held-fetch.js";
import type { HostKernel } from "./host-kernel.js";
import type { RunMode } from "./run-mode.js";
import type { WindowFocus } from "./window-focus.js";

/**
 * compose-integrations.ts -- the account's integrations, asked of the service on the window's behalf: where each stands, a sign-in begun or canceled, a connection ended, an account named.
 *
 * Nothing is held here. A Connect asks the service to begin a sign-in to
 * one provider and opens the address it answered in the browser through the
 * native node, here, so the address, which begins a grant for the account,
 * never reaches a window or a report; the window hears only whether the
 * browser was sent. It learns how the sign-in settled by reading where the
 * integrations stand again, which it does when it is shown and when the
 * developer comes back from the browser. Each server's tools are fetched for
 * the windows that hold them (`held-fetch.ts`), by the server's name, asked
 * as a window first holds them, again as a window comes forward, which is
 * how the developer comes back from mending a connection in the browser,
 * and on Try again, and told as `INTEGRATION_TOOLS_CHANGED` events to the
 * app state every window draws. Behind a closed account gate, or on a run
 * that sends nothing, every ask answers unanswered.
 */

/** The service's side of the integrations, as this concern asks it. */
export type IntegrationsClient = Pick<
  HostedIntegrationsClient,
  "statuses" | "connect" | "cancel" | "disconnect" | "tools" | "rename"
>;

export interface IntegrationsDependencies {
  kernel: Pick<HostKernel, "emit"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: IntegrationsClient;
  /** Hands an address to the operating system; answers whether it took it. */
  openExternal: (url: string) => Effect.Effect<boolean>;
  /** The windows coming forward, on which every server's tools a window holds are asked again. */
  focus: WindowFocus;
}

export interface IntegrationsComposer extends Composer {
  /** Every server's tools a window holds followed anew, as the account gate opening asks. */
  readonly open: Effect.Effect<void>;
  /** Every server's tools let go, as a sign-out lets them go. */
  readonly reset: Effect.Effect<void>;
}

const UNANSWERED = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED } as const;

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
    const { kernel, account, client } = dependencies;
    const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();
    /** The service asked behind the gate, over the host's own HTTP client. */
    const asked = <Answer>(
      call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
    ): Effect.Effect<Answer | typeof UNANSWERED> =>
      gate()
        ? Effect.provideService(call, HttpClient.HttpClient, http)
        : Effect.succeed(UNANSWERED);
    const tools = yield* heldFetch<typeof LIVE_READ.INTEGRATION_TOOLS, string>({
      empty: NO_KEYS_HELD,
      path: (server) => [server],
      gate,
      focus: dependencies.focus,
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
    return composed(dependencies, asked, tools, yield* FiberMap.make<string>());
  });
}

/** The composer's one table, built from its seams; nothing here starts anything but a server's tools, while a window holds them. */
function composed(
  dependencies: IntegrationsDependencies,
  asked: <Answer>(
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ) => Effect.Effect<Answer | typeof UNANSWERED>,
  /** Each server's tools, by its name. */
  tools: HeldFetch<string, IntegrationToolsAnswer>,
  /** The windows' hold on each server's tools, one fiber standing until let go. */
  toolHolds: FiberMap.FiberMap<string>,
): IntegrationsComposer {
  const { client, openExternal } = dependencies;

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

  const methods: HostMethodTable = {
    [GATEWAY_METHOD.INTEGRATIONS_STATUS]: () =>
      Effect.map(asked(client.statuses()), (answer) => carried<IntegrationStatusesView>(answer)),
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

  return { methods, lifetime: Effect.void, open: tools.open, reset: tools.end };
}
