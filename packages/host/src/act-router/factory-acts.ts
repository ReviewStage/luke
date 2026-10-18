import type { FactoryWorldParams, FactoryWorldView } from "@luke/features/factory-world-view";
import type { Effect } from "effect";
import { ACT, ACT_KIND } from "../acts.js";
import { ActRefused, type ActRows } from "./router.js";

/**
 * factory-acts.ts -- the Factory page's asks of the host about a workspace's world.
 *
 * The one check the row makes is who asked: only a panel draws the Factory
 * page, so the takeover and the hidden voice window are refused. What the
 * service answers comes back as the panel's own answer, or why there is
 * none. Nothing is held here.
 */
export interface FactoryActsDependencies {
  host: {
    factoryWorld(params: FactoryWorldParams): Effect.Effect<FactoryWorldView>;
  };
}

export type FactoryActKind = typeof ACT_KIND.FACTORY_WORLD;

export function factoryActRows(
  dependencies: FactoryActsDependencies,
): Pick<ActRows, FactoryActKind> {
  const { host } = dependencies;
  return {
    [ACT_KIND.FACTORY_WORLD]: (params, sender) => {
      if (!sender.panel) throw new ActRefused({ message: ACT[ACT_KIND.FACTORY_WORLD].refusal });
      return host.factoryWorld(params);
    },
  };
}
