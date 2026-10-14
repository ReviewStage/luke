import type { HostedIntegrationsClient } from "@sidecar/features";
import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationConnectView,
  type IntegrationStatusesView,
  type IntegrationStatusView,
  type IntegrationToolsView,
  integrationProviderParamsSchema,
} from "@sidecar/features/integration-view";
import type { IntegrationProvider } from "@sidecar/features/integration-wire";
import { carried, GATEWAY_METHOD, type GatewayMethodTable, invalid } from "@sidecar/gateway";
import { unparsedWire } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Result, type Scope } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-integrations.ts -- the account's integrations, asked of the service on the window's behalf: where each stands, a sign-in begun or cancelled, a connection ended.
 *
 * Nothing is held here. A Connect asks the service to begin a sign-in to
 * one provider and opens the address it answered in the browser through the
 * native node, here, so the address, which begins a grant for the account,
 * never reaches a window or a report; the window hears only whether the
 * browser was sent. It learns how the sign-in settled by reading where the
 * integrations stand again, which it does when it is shown and when the
 * developer comes back from the browser. Behind a closed account gate, or on
 * a run that sends nothing, every ask answers unanswered.
 */

/** The service's side of the integrations, as this concern asks it. */
export type IntegrationsClient = Pick<
  HostedIntegrationsClient,
  "statuses" | "connect" | "cancel" | "disconnect" | "tools"
>;

export interface IntegrationsDependencies {
  kernel: { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: IntegrationsClient;
  /** Hands an address to the operating system; answers whether it took it. */
  openExternal: (url: string) => Effect.Effect<boolean>;
}

export type IntegrationsComposer = Composer;

const UNANSWERED = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED } as const;

export function composeIntegrations(
  dependencies: IntegrationsDependencies,
): Effect.Effect<IntegrationsComposer, never, Scope.Scope> {
  return Effect.sync(() => composed(dependencies));
}

/** The composer's one table, built from its seams; nothing here starts anything. */
function composed(dependencies: IntegrationsDependencies): IntegrationsComposer {
  const { kernel, account, client, openExternal } = dependencies;
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();

  /** The service asked behind the gate, over the ambient fetch client. */
  const asked = <Answer>(
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer | typeof UNANSWERED> =>
    gate() ? Effect.provide(call, FetchHttpClient.layer) : Effect.succeed(UNANSWERED);

  /** The provider the params name, or the invalid-params refusal. */
  const providerOf = (
    params: Parameters<GatewayMethodTable[keyof GatewayMethodTable] & object>[0],
  ) => {
    const read = readEither(integrationProviderParamsSchema)(unparsedWire(params));
    return Result.isFailure(read)
      ? invalid("the ask names a provider this build knows")
      : Effect.succeed(read.success.provider);
  };

  /** A sign-in begun and its address opened; the window hears whether it was, and nothing of the address. */
  const connect = (provider: IntegrationProvider): Effect.Effect<IntegrationConnectView> =>
    Effect.gen(function* () {
      const answer = yield* asked(client.connect(provider));
      if ("failure" in answer) return answer;
      const opened = yield* openExternal(answer.url);
      return opened ? { opened: true } : { failure: INTEGRATION_CALL_FAILURE.NOT_OPENED };
    });

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.INTEGRATIONS_STATUS]: () =>
      Effect.map(asked(client.statuses()), (answer) => carried<IntegrationStatusesView>(answer)),
    [GATEWAY_METHOD.INTEGRATIONS_CONNECT]: (params) =>
      Effect.gen(function* () {
        const provider = yield* providerOf(params);
        return carried<IntegrationConnectView>(yield* connect(provider));
      }),
    [GATEWAY_METHOD.INTEGRATIONS_TOOLS]: (params) =>
      Effect.gen(function* () {
        const provider = yield* providerOf(params);
        return carried<IntegrationToolsView>(yield* asked(client.tools(provider)));
      }),
    [GATEWAY_METHOD.INTEGRATIONS_CANCEL]: (params) =>
      Effect.gen(function* () {
        const provider = yield* providerOf(params);
        return carried<IntegrationStatusView>(yield* asked(client.cancel(provider)));
      }),
    [GATEWAY_METHOD.INTEGRATIONS_DISCONNECT]: (params) =>
      Effect.gen(function* () {
        const provider = yield* providerOf(params);
        const answer = yield* asked(client.disconnect(provider));
        return carried<IntegrationStatusView>(answer);
      }),
  };

  return { methods, lifetime: Effect.void };
}
