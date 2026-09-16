import { ACTION_RESULT_STATUS, text, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";
import { describeWire } from "@sidecar/wire/effect";
import { Effect, Schema as EffectSchema, SchemaTransformation } from "effect";
import { BRAIN_TOOL, maximumBriefingLength } from "./names.js";
import { rejection } from "./records.js";
import { REFUSAL_REASON } from "./refusals.js";
import type { ToolContext, ToolModule } from "./tool-module.js";

/**
 * The briefing channel out of a turn nobody is listening to. Its context
 * carries one thing, a way to hand the turn the words to say once the turn's
 * context is kept, and neither admission nor a carrier: the words it takes
 * become speech and nothing else, so a session summary or a tool output that
 * reads like an instruction has no path from here to an action. The turn's
 * own policy layer withholds it from an ask, whose reply is the speech, and
 * the executor refuses it again at dispatch.
 */

export interface AnnounceToolContext extends ToolContext {
  /** Hands the turn the briefing it decided to give, bounded, to deliver once its context is kept. */
  announce(briefing: string): void;
}

export type AnnounceToolModule = ToolModule<WireRecord, AnnounceToolContext>;

const briefingText = describeWire(
  EffectSchema.String.pipe(
    EffectSchema.decodeTo(
      EffectSchema.String.check(EffectSchema.isNonEmpty()),
      SchemaTransformation.trim(),
    ),
  ),
  `What Luke says aloud, in his own voice, under ${maximumBriefingLength} characters.`,
);

/** Effect's `Codec` is invariant in its decoded type, so a concrete struct is erased to the module shape's type. */
function erase(schema: EffectSchema.Top): EffectSchema.Codec<unknown, UnparsedWireValue> {
  return EffectSchema.make(schema.ast);
}

const ANNOUNCE_INPUT = erase(EffectSchema.Struct({ briefing: briefingText }));

export const ANNOUNCE_TOOL: AnnounceToolModule = {
  name: BRAIN_TOOL.ANNOUNCE,
  description:
    "Hand the developer one spoken briefing about what changed. Call it at most once per " +
    "observed-messages turn, covering every agent worth mentioning in one breath, or not at all " +
    "when nothing is worth interrupting for. Never call it in a developer-ask turn: there your " +
    "final text is the reply.",
  inputSchema: ANNOUNCE_INPUT,
  execute(input: WireRecord, context: AnnounceToolContext): Effect.Effect<WireRecord> {
    return Effect.sync(() => {
      const briefing = text(input.briefing)?.slice(0, maximumBriefingLength);
      if (!briefing) return rejection(REFUSAL_REASON.EMPTY_BRIEFING);
      context.announce(briefing);
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    });
  },
};
