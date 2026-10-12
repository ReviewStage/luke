import { Schema as EffectSchema } from "effect";
import { PLAN_ACTOR, PLAN_SECTION_BOUNDS } from "./plan-wire.js";

/**
 * plan-document.ts -- a plan kept as one free Markdown document: who last changed each of its sections.
 *
 * A plan is moving from the fixed template's fields (`plan-template.ts`) to
 * one Markdown text the developer and Luke both write, started from the
 * account's own template (`docs/PLANNING.md`). The text has no title line,
 * since the plan's name is its own, and its assumptions are a section like
 * any other. A section is a heading and what stands under it, known by the
 * heading's words, so the window can say who wrote each section the way it
 * said who wrote each field, and a renamed heading is a section no save has
 * changed yet.
 */

/**
 * Who last changed one section of a plan that is one document, and when: the
 * section's heading, the writer as a field's writer names one, the coding
 * agent's id where an agent made the save, whether the notetaker made it on
 * one of the plan's calls, and the instant.
 */
export const planSectionWriterSchema = EffectSchema.Struct({
  section: EffectSchema.String.check(
    EffectSchema.isMaxLength(PLAN_SECTION_BOUNDS.MAX_HEADING_CHARS),
  ),
  actor: EffectSchema.Literals(Object.values(PLAN_ACTOR)),
  /** The coding agent's id, where a coding agent made the save. */
  agentId: EffectSchema.optionalKey(EffectSchema.String),
  /** Present, and true, where the notetaker made the save on one of the plan's calls. */
  duringCall: EffectSchema.optionalKey(EffectSchema.Boolean),
  /** Epoch milliseconds of the save. */
  at: EffectSchema.Number,
});

export type PlanSectionWriter = typeof planSectionWriterSchema.Type;
