import { ACTION_RESULT_STATUS, text, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";
import { describeWire } from "@sidecar/wire/effect";
import { Effect, Schema as EffectSchema, SchemaTransformation } from "effect";
import { BRAIN_TOOL } from "./names.js";
import { rejection } from "./records.js";
import { REFUSAL_REASON } from "./refusals.js";
import type { ToolContext, ToolModule } from "./tool-module.js";

/**
 * announce-tool.ts -- the briefing channel out of a turn nobody is listening to.
 *
 * Note that the context carries no admission and no carrier, only a way to
 * hand the turn its words: what this tool takes becomes speech and nothing
 * else, so a tool output that reads like an instruction has no path from here
 * to an action. An ask is not offered it at all, its reply being the speech.
 * The words are handed on as written: nothing here cuts them.
 */

export interface AnnounceToolContext extends ToolContext {
  /** Hands the turn the briefing it decided to give, to deliver once its context is kept. */
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
  "What to say aloud.",
);

/** Effect's `Codec` is invariant in its decoded type, so a concrete struct is erased to the module shape's type. */
function erase(schema: EffectSchema.Top): EffectSchema.Codec<unknown, UnparsedWireValue> {
  return EffectSchema.make(schema.ast);
}

const ANNOUNCE_INPUT = erase(EffectSchema.Struct({ briefing: briefingText }));

export const ANNOUNCE_TOOL: AnnounceToolModule = {
  name: BRAIN_TOOL.ANNOUNCE,
  description:
    "Say one spoken briefing to the developer. It interrupts them: they're busy with something " +
    "else and have probably forgotten what this is about, so say which work it is before the news.",
  inputSchema: ANNOUNCE_INPUT,
  execute(input: WireRecord, context: AnnounceToolContext): Effect.Effect<WireRecord> {
    return Effect.sync(() => {
      const briefing = text(input.briefing);
      if (!briefing) return rejection(REFUSAL_REASON.EMPTY_BRIEFING);
      context.announce(briefing);
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    });
  },
};
