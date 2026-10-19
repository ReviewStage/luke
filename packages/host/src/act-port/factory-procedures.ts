import type { FactoryWorldParams, FactoryWorldView } from "@luke/features/factory-world-view";
import { Effect } from "effect";
import { FACTORY_ACT_KIND } from "../contract/index.js";
import { actPort } from "./base.js";

/**
 * factory-procedures.ts -- the Factory page's ask of the host about a workspace's world.
 *
 * The one check the procedure makes is who asked: only a panel draws the
 * Factory page, so the takeover and the hidden voice window are refused in
 * its own sentence. What the service answers comes back as the panel's own
 * answer, or why there is none. Nothing is held here.
 */
export interface FactoryProceduresDependencies {
  host: {
    factoryWorld(params: FactoryWorldParams): Effect.Effect<FactoryWorldView>;
  };
}

export function factoryProcedures(dependencies: FactoryProceduresDependencies) {
  const { host } = dependencies;
  return {
    [FACTORY_ACT_KIND.FACTORY_WORLD]: actPort[FACTORY_ACT_KIND.FACTORY_WORLD].effect(function* ({
      input,
      context,
      errors,
    }) {
      if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
      return yield* host.factoryWorld(input);
    }),
  };
}
