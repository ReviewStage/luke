import type { GatewayOperator } from "@sidecar/host";
import type { Effect } from "effect";
import { ACT_KIND } from "#shared/messages/acts";
import type { ActRows } from "../act-router";

/**
 * No window submits an ask: the host composes every ask from the live
 * session's own transcript and submits it itself. What a window may still do
 * to a run is cancel it, through the operator client every act crosses.
 */
export interface BrainActDependencies {
  operator: GatewayOperator;
  /** Runs the operator's own effect on the launch's runtime, since an act row answers a value or a promise. */
  run: <A>(effect: Effect.Effect<A>) => Promise<A>;
}

type BrainActKind = typeof ACT_KIND.BRAIN_CANCEL_ASK;

export function brainActRows(dependencies: BrainActDependencies): Pick<ActRows, BrainActKind> {
  const { operator, run } = dependencies;
  return {
    [ACT_KIND.BRAIN_CANCEL_ASK]: ({ runId }) => run(operator.cancel(runId)),
  };
}
