import { applyPatch, structuredPatch } from "diff";
import { Schema as EffectSchema, Result } from "effect";
import {
  PLAN_TEXT_FIELDS,
  type PlanContent,
  type PlanTextField,
  planTextFieldValue,
  withPlanTextField,
} from "./plan-template.js";
import {
  PLAN_BOUNDS,
  PLAN_FIELD,
  PLAN_FIELD_BOUNDS,
  planAssumptionSchema,
  planFieldsSchema,
  planSchema,
} from "./plan-wire.js";

/**
 * plan-edit.ts -- the developer's own edit of one field of a plan: what the window sends, what the service answers, and how the edit is taken into the fields.
 *
 * The developer edits a plan a field at a time, never its body: the body is
 * the fixed template formatted from the fields (`plan-template.ts`), so a
 * field is the unit the service stores, the notetaker writes, and the window
 * opens an editor over, and every heading stays the formatter's. An edit
 * names the field, the answer the editor opened on (`base`), and the answer
 * the developer wrote (`value`): a text field's Markdown, null for one left
 * unanswered, or a list field whole, the open questions or the assumptions.
 *
 * Luke may write while the developer types, on a call, so the field the edit
 * lands in need not still hold its base. Where it does, the edit replaces it.
 * Where it does not, the developer's change is taken as a patch from the base
 * to their answer and laid over what the field holds now, line by line for a
 * text field and item by item for a list; a patch whose lines still stand
 * applies, so a point Luke added elsewhere in the field survives the
 * developer's edit and the edit survives the point. A patch that does not
 * apply is a conflict, answered with what the field holds now, and nothing is
 * changed: the developer chooses whether their answer stands.
 *
 * A plan that is one document (`plan-document.ts`) is edited whole: the edit
 * names the text the editor opened on and the text the developer wrote, and
 * is taken the same way over the whole text, line by line, so a point Luke
 * wrote in another section meanwhile survives the developer's edit.
 */

/** A text settled with its ends trimmed, refused when nothing but whitespace stands, and bounded. */
function trimmedText(maximumChars: number) {
  return EffectSchema.Trim.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(maximumChars));
}

/** A text field's answer as an edit names it: its Markdown, or null while unanswered. */
const ANSWER = EffectSchema.NullOr(trimmedText(PLAN_FIELD_BOUNDS.MAX_ANSWER_CHARS));

/** The answer a text field's editor opened on, or the developer's own last saved answer since. */
const ANSWER_BASE = EffectSchema.NullOr(
  EffectSchema.String.check(EffectSchema.isMaxLength(PLAN_FIELD_BOUNDS.MAX_ANSWER_CHARS)),
);

const OPEN_QUESTIONS = planFieldsSchema.fields.openQuestions;
const ASSUMPTIONS = EffectSchema.Array(planAssumptionSchema).check(
  EffectSchema.isMaxLength(PLAN_BOUNDS.MAX_ASSUMPTIONS),
);

/**
 * A document's text as an edit names it, kept exactly as written and held to
 * the plan's bound, so an edit is no larger a request than a field's. A text
 * the developer's change lays past the bound over Luke's is the save's to
 * refuse as too long.
 */
const DOCUMENT_TEXT = EffectSchema.String.check(
  EffectSchema.isMaxLength(PLAN_BOUNDS.MAX_BODY_CHARS),
);

/**
 * One edit (POST `/api/plans/{id}/edit`): of one field, a text field's
 * answer or a list field whole, or of a plan that is one document, its whole
 * text. The base is what the editor opened on, or the developer's own last
 * save since.
 */
export const planEditRequestSchema = EffectSchema.Union([
  EffectSchema.Struct({
    field: EffectSchema.Literals(PLAN_TEXT_FIELDS),
    base: ANSWER_BASE,
    value: ANSWER,
  }),
  EffectSchema.Struct({
    field: EffectSchema.Literal(PLAN_FIELD.OPEN_QUESTIONS),
    base: OPEN_QUESTIONS,
    value: OPEN_QUESTIONS,
  }),
  EffectSchema.Struct({
    field: EffectSchema.Literal(PLAN_FIELD.ASSUMPTIONS),
    base: ASSUMPTIONS,
    value: ASSUMPTIONS,
  }),
  EffectSchema.Struct({
    document: EffectSchema.Struct({ base: DOCUMENT_TEXT, value: DOCUMENT_TEXT }),
  }),
]);

export type PlanEditRequest = typeof planEditRequestSchema.Type;

/** An edit of one field, as against a document's whole text. */
export type PlanFieldEditRequest = Exclude<PlanEditRequest, { readonly document: unknown }>;

/** An edit of a document's whole text. */
export type PlanDocumentEditRequest = Extract<PlanEditRequest, { readonly document: unknown }>;

/** What a field holds, whatever its kind, as a conflict answers it. */
export const planEditValueSchema = EffectSchema.Union([ANSWER_BASE, OPEN_QUESTIONS, ASSUMPTIONS]);

export type PlanEditValue = typeof planEditValueSchema.Type;

/** Why an edit saved nothing that is the developer's to change. */
export const PLAN_EDIT_REFUSAL = {
  /** The plan formatted with the edit would be longer than a plan may be. */
  TOO_LONG: "too-long",
} as const;

/** What an edit answers: the plan as saved, the field as it now stands where the edit conflicts with it, or why it was refused. */
export const planEditAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ plan: planSchema }),
  EffectSchema.Struct({
    conflict: EffectSchema.Struct({ current: planEditValueSchema }),
  }),
  EffectSchema.Struct({ refused: EffectSchema.Literals(Object.values(PLAN_EDIT_REFUSAL)) }),
]);

export type PlanEditAnswer = typeof planEditAnswerSchema.Type;

/** An edit taken into a plan's content: the content with it, the same content where it changed nothing, or the field as it stands where it conflicts. */
export type PlanEditOutcome =
  | { readonly applied: PlanContent }
  | { readonly conflict: { readonly current: PlanEditValue } };

/**
 * How one field is read, written, and laid out as lines for a patch: a text
 * field line by line, a list one item to a line, each item as its JSON so
 * an item's own line breaks stay inside it. `parsed` reads lines back, or
 * nothing where they no longer read as the field.
 */
interface FieldLens<V> {
  readonly read: (content: PlanContent) => V;
  readonly write: (content: PlanContent, value: V) => PlanContent;
  readonly lines: (value: V) => string;
  readonly parsed: (lines: string) => V | undefined;
}

/** A text field's lens: each line closed by a break, so a line added after the last leaves the last one's patch standing. */
function textLens(field: PlanTextField): FieldLens<string | null> {
  return {
    read: (content) => planTextFieldValue(content.fields, field),
    write: (content, value) => ({
      ...content,
      fields: withPlanTextField(content.fields, field, value),
    }),
    lines: (value) => (value === null ? "" : `${value}\n`),
    parsed: (lines) => {
      const answer = lines.trim();
      return answer === "" ? null : answer;
    },
  };
}

/**
 * A list field's lens: one item to a line as its JSON, read back as one JSON
 * list under the field's own schema, and no lines as the field's empty
 * value (the rules being null rather than empty).
 */
function listLens<I, V>(lens: {
  readonly field: EffectSchema.Codec<V, unknown>;
  readonly empty: V;
  readonly items: (value: V) => readonly I[];
  readonly read: (content: PlanContent) => V;
  readonly write: (content: PlanContent, value: V) => PlanContent;
}): FieldLens<V> {
  const decode = EffectSchema.decodeUnknownResult(EffectSchema.fromJsonString(lens.field));
  return {
    read: lens.read,
    write: lens.write,
    lines: (value) =>
      lens
        .items(value)
        .map((item) => `${JSON.stringify(item)}\n`)
        .join(""),
    parsed: (lines) => {
      const items = lines.split("\n").filter((line) => line !== "");
      if (items.length === 0) return lens.empty;
      return Result.getOrUndefined(decode(`[${items.join(",")}]`));
    },
  };
}

const OPEN_QUESTIONS_LENS = listLens({
  field: OPEN_QUESTIONS,
  empty: [],
  items: (questions) => questions,
  read: (content) => content.fields.openQuestions,
  write: (content, openQuestions) => ({ ...content, fields: { ...content.fields, openQuestions } }),
});

const ASSUMPTIONS_LENS = listLens({
  field: ASSUMPTIONS,
  empty: [],
  items: (assumptions) => assumptions,
  read: (content) => content.assumptions,
  write: (content, assumptions) => ({ ...content, assumptions }),
});

/** Whether two values of a field hold the same words. */
function same(left: PlanEditValue, right: PlanEditValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * The developer's change from `base` to `value` laid over what the field
 * holds now, or nothing where the lines it changes no longer stand as they
 * did, or the result no longer reads as the field.
 */
function rebased<V>(lens: FieldLens<V>, base: V, value: V, current: V): V | undefined {
  const patch = structuredPatch("", "", lens.lines(base), lens.lines(value), "", "");
  const applied = applyPatch(lens.lines(current), patch);
  return applied === false ? undefined : lens.parsed(applied);
}

/** One edit taken through its field's lens, rebased where the field moved since its base. */
function appliedThrough<V extends PlanEditValue>(
  content: PlanContent,
  lens: FieldLens<V>,
  base: V,
  value: V,
): PlanEditOutcome {
  const current = lens.read(content);
  // A field the developer cleared that has changed since is a conflict: clearing it again would strike words they never read.
  const cleared = value === null && !same(current, base);
  const next = same(current, base)
    ? value
    : cleared
      ? undefined
      : rebased(lens, base, value, current);
  if (next === undefined) return { conflict: { current } };
  if (same(next, current)) return { applied: content };
  return { applied: lens.write(content, next) };
}

/**
 * A document's lens. Note that each text is closed by one more line break
 * than it holds, because a patch that adds after the last line leaves that
 * line's own patch standing, and the break is taken off again once read.
 */
const DOCUMENT_LENS: FieldLens<string> = {
  read: () => "",
  write: (content) => content,
  lines: (value) => `${value}\n`,
  parsed: (lines) => (lines.endsWith("\n") ? lines.slice(0, -1) : lines),
};

/** A document edit taken into the text: the text with it, or the text as it stands where it conflicts. */
export type PlanDocumentEditOutcome =
  | { readonly applied: string }
  | { readonly conflict: { readonly current: string } };

/**
 * The developer's edit of a document taken into the text as it stands now:
 * their text where it still holds the base, their change laid over it where
 * it moved since, or a conflict where it cannot be, or where they cleared a
 * text that has changed since, which would strike words they never read.
 */
export function applyDocumentEdit(
  current: string,
  edit: PlanDocumentEditRequest,
): PlanDocumentEditOutcome {
  const { base, value } = edit.document;
  if (current === base) return { applied: value };
  const next = value === "" ? undefined : rebased(DOCUMENT_LENS, base, value, current);
  return next === undefined ? { conflict: { current } } : { applied: next };
}

/** The edit taken into the content, rebased over what the field holds now where it moved since the edit's base. */
export function applyDeveloperEdit(
  content: PlanContent,
  edit: PlanFieldEditRequest,
): PlanEditOutcome {
  switch (edit.field) {
    case PLAN_FIELD.OPEN_QUESTIONS:
      return appliedThrough(content, OPEN_QUESTIONS_LENS, edit.base, edit.value);
    case PLAN_FIELD.ASSUMPTIONS:
      return appliedThrough(content, ASSUMPTIONS_LENS, edit.base, edit.value);
    default:
      return appliedThrough(content, textLens(edit.field), edit.base, edit.value);
  }
}
