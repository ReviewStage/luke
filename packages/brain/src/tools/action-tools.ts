import {
  ACTION_KIND,
  ACTION_REFUSAL,
  ACTIONS,
  type ActionFamily,
  type ActionKind,
  type ActionOutputEnvelope,
  type AdmitContext,
  admit,
  refusedActionOutput,
  type ToolSpec,
  type ValidatedAction,
} from "@sidecar/actions";
import type { WireRecord } from "@sidecar/wire";
import type { ToolContext, ToolModule } from "./tool-module.js";

/**
 * The action tools as modules: one per row of the actions table that a
 * performer carries. Each one's `execute` is the whole gauntlet an action
 * runs — `admit()` first, against the roster admission reads for itself
 * through the readers the host supplies, then the carrier, which takes only
 * what admission minted. Nothing in a module knows the agent: the standing it
 * runs under, the readers, and the carrier all arrive in its context, so a
 * module cannot be handed a roster, and a caller cannot reach a carrier
 * without an admitted action to hand it.
 */

/**
 * The readers admission consults, as the host supplies them for one
 * execution: the roster and the projects as the latest pass reports them,
 * the guide, the issues, the facts. The readers answer what stands when
 * admission asks, never a copy a caller took earlier; who opened the turn
 * and whether it still stands come from the context, not from here.
 */
export type ActionAdmissionReads = Omit<AdmitContext, "origin" | "guard">;

export interface ActionToolContext extends ToolContext {
  readonly admission: ActionAdmissionReads;
  /** Carries an action admission minted, and nothing else has the type to be carried. */
  carry(action: ValidatedAction): Promise<ActionOutputEnvelope>;
}

export interface ActionToolModule extends ToolModule<ActionOutputEnvelope, ActionToolContext> {
  readonly kind: ActionKind;
  readonly family: ActionFamily;
}

function defineActionTool(spec: ToolSpec<ActionFamily, ActionKind>): ActionToolModule {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.request,
    kind: spec.kind,
    family: spec.family,
    async execute(input: WireRecord, context: ActionToolContext): Promise<ActionOutputEnvelope> {
      if (context.isRevoked()) return refusedActionOutput(ACTION_REFUSAL.TURN_OVER);
      const admitted = await admit(
        { kind: spec.kind, fields: input },
        { ...context.admission, origin: context.origin, guard: context },
      );
      if (admitted.kind === undefined) return refusedActionOutput(admitted.reason);
      // Asked once more after admission's own reads, so an action whose turn
      // ended while the roster was refreshing is refused rather than carried.
      if (context.isRevoked()) return refusedActionOutput(ACTION_REFUSAL.TURN_OVER);
      return context.carry(admitted);
    },
  };
}

/** The notebook's two writes are the memory provider's tools, carried through its own path, and are no action tool here. */
const MEMORY_ACTION_KINDS: ReadonlySet<ActionKind> = new Set([
  ACTION_KIND.REMEMBER,
  ACTION_KIND.FORGET,
]);

/** Every action tool, in the actions table's own order, which is the order the catalog lists them. */
export const ACTION_TOOLS: readonly ActionToolModule[] = Object.values(ACTIONS)
  .filter((spec) => !MEMORY_ACTION_KINDS.has(spec.kind))
  .map(defineActionTool);

const ACTION_TOOLS_BY_NAME = new Map(ACTION_TOOLS.map((tool) => [tool.name, tool]));

/** The action tool a call names, or nothing for a name that is not an action tool's. */
export function actionToolNamed(name: string): ActionToolModule | undefined {
  return ACTION_TOOLS_BY_NAME.get(name);
}
