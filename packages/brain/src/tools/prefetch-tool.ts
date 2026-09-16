import { maximumMemoryQueryLength, NOTEBOOK_MEMORY_TOOL } from "@sidecar/memory";
import type { UnparsedWireValue } from "@sidecar/wire";
import { describeWire } from "@sidecar/wire/effect";
import { Schema as EffectSchema, SchemaTransformation } from "effect";
import { BRAIN_TOOL } from "./names.js";

/**
 * The one tool the read prefetch's planner is offered and forced to call:
 * which of the brain's reads the turn answering a spoken ask will need, named
 * before the developer has finished asking. It is not in the brain's catalog
 * and no policy layer names it, because the model that answers a turn never
 * sees it; it is registered with the hosted service so the service holds its
 * schema and a caller never uploads one. A session is named by its position
 * in the options the planner was shown, never by an id, so nothing the
 * planner writes can reach a session the roster does not hold.
 */

export const PLAN_READS_TOOL_NAME = "plan_reads";

/** The most reads one plan may name: one transcript and one notebook search. */
export const PLAN_READS_MAXIMUM = 2;

/** The two reads a plan may name, by the tool each becomes in the turn's input. */
export const PREFETCH_READ_KIND = {
  TRANSCRIPT: BRAIN_TOOL.READ_TRANSCRIPT,
  MEMORY: NOTEBOOK_MEMORY_TOOL.SEARCH,
} as const;

/** A text trimmed, refused when left with nothing, and bounded to `max` characters. */
function boundedText(description: string, max: number): EffectSchema.Codec<string, string> {
  return describeWire(
    EffectSchema.String.pipe(
      EffectSchema.decodeTo(
        EffectSchema.String.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(max)),
        SchemaTransformation.trim(),
      ),
    ),
    description,
  );
}

const TRANSCRIPT_READ = EffectSchema.Struct({
  kind: EffectSchema.Literal(PREFETCH_READ_KIND.TRANSCRIPT),
  session: describeWire(
    EffectSchema.Number.check(
      EffectSchema.isFinite(),
      EffectSchema.isInt(),
      EffectSchema.isGreaterThanOrEqualTo(1),
    ),
    "The option number of the session in the list you were shown.",
  ),
});

const MEMORY_READ = EffectSchema.Struct({
  kind: EffectSchema.Literal(PREFETCH_READ_KIND.MEMORY),
  query: boundedText("What to search the notebook for.", maximumMemoryQueryLength),
});

const PLAN_READS_FIELDS = EffectSchema.Struct({
  reads: describeWire(
    EffectSchema.Array(EffectSchema.Union([TRANSCRIPT_READ, MEMORY_READ])).check(
      EffectSchema.isMaxLength(PLAN_READS_MAXIMUM),
    ),
    "The reads the answer will certainly need: at most one session transcript and one " +
      "notebook search. Empty when none is needed.",
  ),
});

/** Effect's `Schema` is invariant in its decoded type, so the concrete struct is erased to the module shape's type. */
export const PLAN_READS_INPUT: EffectSchema.Codec<unknown, UnparsedWireValue> = EffectSchema.make(
  PLAN_READS_FIELDS.ast,
);

/** The planner's tool as a registry carries it: its name, its words, and the schema its fields are declared in. */
interface PlanReadsTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: EffectSchema.Codec<unknown, UnparsedWireValue>;
}

export const PLAN_READS_TOOL = {
  name: PLAN_READS_TOOL_NAME,
  description:
    "Plan the reads the answer to the developer's unfinished ask will certainly need. Name a " +
    "session transcript only when the ask is about what one listed session is doing, did, or " +
    "said, by its option number; name a notebook search only for prior decisions, people, " +
    "dates, or preferences. Plan nothing when in doubt.",
  inputSchema: PLAN_READS_INPUT,
} as const satisfies PlanReadsTool;
