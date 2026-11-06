import { applyPatch, structuredPatch } from "diff";
import { Schema as EffectSchema } from "effect";
import { descriptionCommentAnchorsSchema } from "./description-comment-wire.js";
import { descriptionLastEditSchema, TASK_BOUNDS, taskSchema, taskTxidSchema } from "./task-wire.js";

const DOCUMENT_TEXT = EffectSchema.String.check(
  EffectSchema.isMaxLength(TASK_BOUNDS.MAX_BODY_CHARS),
);

export const descriptionEditRequestSchema = EffectSchema.Struct({
  document: EffectSchema.Struct({ base: DOCUMENT_TEXT, value: DOCUMENT_TEXT }),
  comments: EffectSchema.optionalKey(descriptionCommentAnchorsSchema),
});

export type DescriptionEditRequest = typeof descriptionEditRequestSchema.Type;

export const descriptionEditValueSchema = DOCUMENT_TEXT;

export type DescriptionEditValue = typeof descriptionEditValueSchema.Type;

export const descriptionEditConflictSchema = EffectSchema.Struct({
  current: descriptionEditValueSchema,
  by: EffectSchema.optionalKey(descriptionLastEditSchema),
});

export const DESCRIPTION_EDIT_REFUSAL = {
  TOO_LONG: "too-long",
} as const;

export const descriptionEditAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ plan: taskSchema, txid: EffectSchema.optionalKey(taskTxidSchema) }),
  EffectSchema.Struct({ conflict: descriptionEditConflictSchema }),
  EffectSchema.Struct({ refused: EffectSchema.Literals(Object.values(DESCRIPTION_EDIT_REFUSAL)) }),
]);

export type DescriptionEditAnswer = typeof descriptionEditAnswerSchema.Type;

export type DescriptionEditOutcome =
  | { readonly applied: string }
  | { readonly conflict: { readonly current: string } };

function patchLines(text: string): string {
  return `${text}\n`;
}

function rebased(base: string, value: string, current: string): string | undefined {
  const patch = structuredPatch("", "", patchLines(base), patchLines(value), "", "");
  const applied = applyPatch(patchLines(current), patch);
  if (applied === false) return undefined;
  return applied.endsWith("\n") ? applied.slice(0, -1) : applied;
}

export function applyDocumentEdit(
  current: string,
  edit: DescriptionEditRequest,
): DescriptionEditOutcome {
  const { base, value } = edit.document;
  if (current === base) return { applied: value };
  const next = value === "" ? undefined : rebased(base, value, current);
  return next === undefined ? { conflict: { current } } : { applied: next };
}
