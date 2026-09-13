import type { GatewayOperator } from "@sidecar/host";
import { ACT_KIND } from "#shared/messages/acts";
import type { ActRows } from "../act-router";

/**
 * No window submits an ask: the host composes every ask from the live
 * session's own transcript and submits it itself. What a window may still do
 * to a run is cancel it, through the operator client every act crosses.
 */
export interface BrainActDependencies {
  operator: GatewayOperator;
}

type BrainActKind = typeof ACT_KIND.BRAIN_CANCEL_ASK;

export function brainActRows(dependencies: BrainActDependencies): Pick<ActRows, BrainActKind> {
  const { operator } = dependencies;
  return {
    [ACT_KIND.BRAIN_CANCEL_ASK]: ({ runId }) => operator.cancel(runId),
  };
}
