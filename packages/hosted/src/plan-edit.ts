import { applyPatch, structuredPatch } from "diff";
import { Schema as EffectSchema } from "effect";
import {
  PLAN_TEXT_FIELDS,
  type PlanContent,
  type PlanTextField,
  planTextFieldValue,
  withPlanTextField,
} from "./plan-template.js";
import { PLAN_FIELD_BOUNDS, planSchema } from "./plan-wire.js";

/**
 * plan-edit.ts -- the developer's own edit of one field of a plan: what the window sends, what the service answers, and how the edit is taken into the fields.
 *
 * The developer edits a plan a field at a time, never its body: the body is
 * the fixed template formatted from the fields (`plan-template.ts`), so a
 * field is the unit the service stores, the notetaker writes, and the window
 * opens an editor over, and every heading stays the formatter's. An edit
 * names the field, the answer the editor opened on (`base`), and the answer
 * the developer wrote (`value`), null for a field left unanswered.
 *
 * Luke may write while the developer types, on a call, so the field the edit
 * lands in need not still hold its base. Where it does, the edit replaces it.
 * Where it does not, the developer's change is taken as a patch from the base
 * to their answer and laid over what the field holds now; a patch whose lines
 * still stand applies, so a point Luke added elsewhere in the field survives
 * the developer's edit and the edit survives the point. A patch that does not
 * apply is a conflict, answered with what the field holds now, and nothing is
 * changed: the developer chooses whether their answer stands.
 */

/** A text settled with its ends trimmed, refused when nothing but whitespace stands, and bounded. */
function trimmedText(maximumChars: number) {
  return EffectSchema.Trim.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(maximumChars));
}

/** A field's answer as an edit names it: its Markdown, or null while unanswered. */
const ANSWER = EffectSchema.NullOr(trimmedText(PLAN_FIELD_BOUNDS.MAX_ANSWER_CHARS));

/** One edit of one text field (POST `/api/plans/{id}/edit`). */
export const planEditRequestSchema = EffectSchema.Struct({
  field: EffectSchema.Literals(PLAN_TEXT_FIELDS),
  /** The answer the editor opened on, or the developer's own last saved answer since. */
  base: EffectSchema.NullOr(
    EffectSchema.String.check(EffectSchema.isMaxLength(PLAN_FIELD_BOUNDS.MAX_ANSWER_CHARS)),
  ),
  value: ANSWER,
});

export type PlanEditRequest = typeof planEditRequestSchema.Type;

/** Why an edit saved nothing that is the developer's to change. */
export const PLAN_EDIT_REFUSAL = {
  /** The plan formatted with the edit would be longer than a plan may be. */
  TOO_LONG: "too-long",
} as const;

/** What an edit answers: the plan as saved, the field as it now stands where the edit conflicts with it, or why it was refused. */
export const planEditAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ plan: planSchema }),
  EffectSchema.Struct({
    conflict: EffectSchema.Struct({ current: EffectSchema.NullOr(EffectSchema.String) }),
  }),
  EffectSchema.Struct({ refused: EffectSchema.Literals(Object.values(PLAN_EDIT_REFUSAL)) }),
]);

export type PlanEditAnswer = typeof planEditAnswerSchema.Type;

/** An edit taken into a plan's content: the content with it, the same content where it changed nothing, or the field as it stands where it conflicts. */
export type PlanEditOutcome =
  | { readonly applied: PlanContent }
  | { readonly conflict: { readonly current: string | null } };

/** An answer as lines for the patch, each closed by a break, so a line added after the last one leaves the last one's patch standing. */
function linesOf(answer: string | null): string {
  return answer === null ? "" : `${answer}\n`;
}

/** Lines back as an answer: null where nothing but whitespace stands. */
function answerOf(lines: string): string | null {
  const answer = lines.trim();
  return answer === "" ? null : answer;
}

/**
 * The developer's change from `base` to `value` laid over what the field
 * holds now, or nothing where the lines it changes no longer stand as they
 * did. A field the developer cleared is a conflict whenever it has changed,
 * since clearing it again would strike words they never read.
 */
function rebased(base: string | null, value: string | null, current: string | null) {
  if (value === null) return undefined;
  const patch = structuredPatch("", "", linesOf(base), linesOf(value), "", "");
  const applied = applyPatch(linesOf(current), patch);
  return applied === false ? undefined : answerOf(applied);
}

/** The edit taken into the content, rebased over what the field holds now where it moved since the edit's base. */
export function applyDeveloperEdit(content: PlanContent, edit: PlanEditRequest): PlanEditOutcome {
  const field: PlanTextField = edit.field;
  const current = planTextFieldValue(content.fields, field);
  const value = current === edit.base ? edit.value : rebased(edit.base, edit.value, current);
  if (value === undefined) return { conflict: { current } };
  if (value === current) return { applied: content };
  return { applied: { ...content, fields: withPlanTextField(content.fields, field, value) } };
}
