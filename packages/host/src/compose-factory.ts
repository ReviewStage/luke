import type { HostedFactoryWorldClient } from "@luke/features";
import {
  FACTORY_WORLD_CALL_FAILURE,
  type FactoryWorldView,
  factoryWorldParamsSchema,
} from "@luke/features/factory-world-view";
import { carried, GATEWAY_METHOD, type GatewayMethodTable, invalid } from "@luke/gateway";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-factory.ts -- a workspace's Factory world, asked of the service on the window's behalf.
 *
 * Nothing is held here. The window asks when its world opens and draws what
 * the service answered, and every ask is one call of the service answered
 * whole. Behind a closed account gate, or on a run that sends nothing, the
 * ask answers unanswered.
 */

/** The service's side of the world, as this concern asks it. */
type FactoryWorldClient = Pick<HostedFactoryWorldClient, "world">;

export interface FactoryDependencies {
  kernel: { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: FactoryWorldClient;
}

export type FactoryComposer = Composer;

const UNANSWERED = { failure: FACTORY_WORLD_CALL_FAILURE.UNANSWERED } as const;

export function composeFactory(
  dependencies: FactoryDependencies,
): Effect.Effect<FactoryComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    return composed(dependencies, yield* HttpClient.HttpClient);
  });
}

/** The composer's one table, built from its seams; nothing here starts anything. */
function composed(dependencies: FactoryDependencies, http: HttpClient.HttpClient): FactoryComposer {
  const { kernel, account, client } = dependencies;
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.FACTORY_WORLD]: (params) =>
      Effect.gen(function* () {
        const read = readEither(factoryWorldParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("a world names a workspace");
        const world: FactoryWorldView = gate()
          ? yield* Effect.provideService(client.world(read.success), HttpClient.HttpClient, http)
          : UNANSWERED;
        return carried<FactoryWorldView>(world);
      }),
  };

  return { methods, lifetime: Effect.void };
}
