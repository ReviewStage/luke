/**
 * The effective tool policy in Effect's own terms. `tool-policy.ts` is a
 * faithful port of OpenClaw `b7528507`'s deny-wins layering and imports
 * nothing from `effect`, so its Effect surface lives here beside it: the
 * dispatch door restated as an `Either` that tells a call outside the
 * catalog apart from one a layer removed, each carrying what a caller needs
 * to report the refusal.
 *
 * This is the OpenClaw-wrap shape from `queue.effect.ts`: a sibling named for
 * the ported file, wrapping its exported API and reaching inside none of it.
 */
import { Data, Effect, Either } from "effect";
import type { ToolDescriptor } from "./registry.js";
import {
  type ChildPolicyContext,
  type EffectiveToolPolicy,
  resolveToolPolicy,
  type ToolPolicy,
  type ToolPolicyLayer,
  type ToolPolicyLayers,
} from "./tool-policy.js";

/** Why a tool call refused at dispatch's door. */
export const TOOL_CALL_REFUSAL = {
  /** No tool in the catalog carries this name at all. */
  UNCATALOGED: "uncataloged",
  /** A layer of the effective policy removed the tool by name. */
  DENIED: "denied",
} as const;

export type ToolCallRefusal = (typeof TOOL_CALL_REFUSAL)[keyof typeof TOOL_CALL_REFUSAL];

export class ToolCallRefused extends Data.TaggedError("ToolCallRefused")<{
  readonly code: ToolCallRefusal;
  readonly tool: string;
  readonly layer?: ToolPolicyLayer;
}> {}

/**
 * Resolves the layers into the effective policy the port already computes.
 * Stated as an effect so a caller assembling a turn composes it with
 * everything else the turn builds, though nothing here can fail: the
 * deny-wins fold over the fixed layer order only narrows what stands, it
 * never refuses an input.
 */
export const resolvePolicy = (
  catalog: readonly ToolDescriptor[],
  layers: ToolPolicyLayers,
  child?: ChildPolicyContext,
  turn?: ToolPolicy,
): Effect.Effect<EffectiveToolPolicy> =>
  Effect.sync(() => resolveToolPolicy(catalog, layers, child, turn));

/**
 * The door every dispatch meets, restated as an `Either` rather than the
 * policy's own boolean `allows`: a name outside the catalog and a name a
 * layer removed are different refusals, and the tool descriptor a caller
 * dispatches through rides on the right where the policy still allows the
 * call.
 */
export const requireAllowed = (
  policy: EffectiveToolPolicy,
  catalog: readonly ToolDescriptor[],
  name: string,
): Either.Either<ToolDescriptor, ToolCallRefused> => {
  const tool = catalog.find((candidate) => candidate.schema.name === name);
  if (!tool) {
    return Either.left(new ToolCallRefused({ code: TOOL_CALL_REFUSAL.UNCATALOGED, tool: name }));
  }
  if (policy.allows(name)) return Either.right(tool);
  const layer = policy.deniedBy(name);
  return Either.left(
    new ToolCallRefused({
      code: TOOL_CALL_REFUSAL.DENIED,
      tool: name,
      ...(layer !== undefined ? { layer } : undefined),
    }),
  );
};
