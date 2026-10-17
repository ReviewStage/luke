import { applyPatch, structuredPatch } from "diff";
import { Schema as EffectSchema } from "effect";
import { planCommentAnchorsSchema } from "./plan-comment-wire.js";
import { TASK_BOUNDS, taskSchema } from "./task-wire.js";

/**
 * plan-edit.ts -- the developer's own edit of a plan's text: what the window sends, what the service answers, and how the edit is taken into the text.
 *
 * A plan is one Markdown text (`plan-document.ts`), and the developer edits
 * it whole: the edit names the text the editor opened on (`base`), or the
 * developer's own last save since, and the text the developer wrote
 * (`value`). Luke may write while the developer types, on a call, so the
 * text need not still hold the base. Where it does, the edit replaces it.
 * Where it does not, the developer's change is taken as a patch from the base
 * to their text and laid over what the text holds now, line by line, so a
 * point Luke wrote in another section meanwhile survives the developer's edit
 * and the edit survives the point. A patch that does not apply is a conflict,
 * answered with what the text holds now, and nothing is changed: the
 * developer chooses whether their text stands.
 *
 * Note that `plan` keeps the wire's legacy spelling of a task, because a
 * released desktop sends and reads them; they are renamed with the wire in a
 * follow-up, with no alias.
 */

/**
 * A plan's text as an edit names it, kept exactly as written and held to the
 * plan's bound. A text the developer's change lays past the bound over Luke's
 * is the save's to refuse as too long.
 */
const DOCUMENT_TEXT = EffectSchema.String.check(
  EffectSchema.isMaxLength(TASK_BOUNDS.MAX_BODY_CHARS),
);

/**
 * The developer's edit of the plan's whole text (POST `/api/plans/{id}/edit`):
 * the text the editor opened on, or their own last save since, and the text
 * they wrote; and where the editor's comment anchors stand in that text,
 * from an editor that carries them (`plan-comment-wire.ts`).
 */
export const planEditRequestSchema = EffectSchema.Struct({
  document: EffectSchema.Struct({ base: DOCUMENT_TEXT, value: DOCUMENT_TEXT }),
  comments: EffectSchema.optionalKey(planCommentAnchorsSchema),
});

export type PlanEditRequest = typeof planEditRequestSchema.Type;

/** The plan's text as a conflict answers it. */
export const planEditValueSchema = DOCUMENT_TEXT;

export type PlanEditValue = typeof planEditValueSchema.Type;

/** Why an edit saved nothing that is the developer's to change. */
export const PLAN_EDIT_REFUSAL = {
  /** The plan with the edit would be longer than a plan may be. */
  TOO_LONG: "too-long",
} as const;

/** What an edit answers: the plan as saved, the text as it now stands where the edit conflicts with it, or why it was refused. */
export const planEditAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ plan: taskSchema }),
  EffectSchema.Struct({
    conflict: EffectSchema.Struct({ current: planEditValueSchema }),
  }),
  EffectSchema.Struct({ refused: EffectSchema.Literals(Object.values(PLAN_EDIT_REFUSAL)) }),
]);

export type PlanEditAnswer = typeof planEditAnswerSchema.Type;

/** An edit taken into the text: the text with it, or the text as it stands where it conflicts. */
export type PlanEditOutcome =
  | { readonly applied: string }
  | { readonly conflict: { readonly current: string } };

/**
 * A text as a patch reads it. Note that it is closed by one more line break
 * than it holds, because a patch that adds after the last line leaves that
 * line's own patch standing, and the break is taken off again once read.
 */
function patchLines(text: string): string {
  return `${text}\n`;
}

/** The developer's change from `base` to `value` laid over `current`, or nothing where the lines it changes no longer stand as they did. */
function rebased(base: string, value: string, current: string): string | undefined {
  const patch = structuredPatch("", "", patchLines(base), patchLines(value), "", "");
  const applied = applyPatch(patchLines(current), patch);
  if (applied === false) return undefined;
  return applied.endsWith("\n") ? applied.slice(0, -1) : applied;
}

/**
 * The developer's edit taken into the text as it stands now: their text
 * where it still holds the base, their change laid over it where it moved
 * since, or a conflict where it cannot be, or where they cleared a text that
 * has changed since, which would strike words they never read.
 */
export function applyDocumentEdit(current: string, edit: PlanEditRequest): PlanEditOutcome {
  const { base, value } = edit.document;
  if (current === base) return { applied: value };
  const next = value === "" ? undefined : rebased(base, value, current);
  return next === undefined ? { conflict: { current } } : { applied: next };
}
