import type { HostedIntegrationsClient } from "@luke/features";
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
} from "@luke/features/integration-view";
import { carried, GATEWAY_METHOD, type GatewayMethodTable, invalid } from "@luke/gateway";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result, type Scope } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-integrations.ts -- the account's integrations, asked of the service on the window's behalf: where each stands, a sign-in begun or cancelled, a connection ended, an account named.
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
  "statuses" | "connect" | "cancel" | "disconnect" | "tools" | "rename"
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

  type Params = Parameters<GatewayMethodTable[keyof GatewayMethodTable] & object>[0];

  /** The account the params name (a provider, and the account and an add where named), or the invalid-params refusal. */
  const targetOf = (params: Params) => {
    const read = readEither(integrationProviderParamsSchema)(unparsedWire(params));
    return Result.isFailure(read)
      ? invalid("the ask names a provider this build knows")
      : Effect.succeed(read.success);
  };

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

  const methods: GatewayMethodTable = {
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
        const read = readEither(integrationRenameParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("the ask names an account and a label");
        const { provider, connection, label } = read.success;
        return carried<IntegrationAccountView>(
          yield* asked(client.rename(provider, connection, label)),
        );
      }),
  };

  return { methods, lifetime: Effect.void };
}
