import { applyPatch, structuredPatch } from "diff";
import { Schema as EffectSchema, Result } from "effect";
import {
  PLAN_FIELD,
  PLAN_TEXT_FIELDS,
  type PlanContent,
  type PlanTextField,
  planTextFieldValue,
  withPlanTextField,
} from "./plan-template.js";
import {
  PLAN_BOUNDS,
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
 * unanswered, or a list field whole, the rules, the open questions, or the
 * assumptions.
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

const RULES = planFieldsSchema.fields.rules;
const OPEN_QUESTIONS = planFieldsSchema.fields.openQuestions;
const ASSUMPTIONS = EffectSchema.Array(planAssumptionSchema).check(
  EffectSchema.isMaxLength(PLAN_BOUNDS.MAX_ASSUMPTIONS),
);

/**
 * One edit of one field (POST `/api/plans/{id}/edit`): a text field's
 * answer, or a list field whole. The base is what the editor opened on, or
 * the developer's own last save since.
 */
export const planEditRequestSchema = EffectSchema.Union([
  EffectSchema.Struct({
    field: EffectSchema.Literals(PLAN_TEXT_FIELDS),
    base: ANSWER_BASE,
    value: ANSWER,
  }),
  EffectSchema.Struct({ field: EffectSchema.Literal(PLAN_FIELD.RULES), base: RULES, value: RULES }),
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
]);

export type PlanEditRequest = typeof planEditRequestSchema.Type;

/** What a field holds, whatever its kind, as a conflict answers it. */
export const planEditValueSchema = EffectSchema.Union([
  ANSWER_BASE,
  RULES,
  OPEN_QUESTIONS,
  ASSUMPTIONS,
]);

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

const RULES_LENS = listLens({
  field: RULES,
  empty: null,
  items: (rules) => rules ?? [],
  read: (content) => content.fields.rules,
  write: (content, rules) => ({ ...content, fields: { ...content.fields, rules } }),
});

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

/** The edit taken into the content, rebased over what the field holds now where it moved since the edit's base. */
export function applyDeveloperEdit(content: PlanContent, edit: PlanEditRequest): PlanEditOutcome {
  switch (edit.field) {
    case PLAN_FIELD.RULES:
      return appliedThrough(content, RULES_LENS, edit.base, edit.value);
    case PLAN_FIELD.OPEN_QUESTIONS:
      return appliedThrough(content, OPEN_QUESTIONS_LENS, edit.base, edit.value);
    case PLAN_FIELD.ASSUMPTIONS:
      return appliedThrough(content, ASSUMPTIONS_LENS, edit.base, edit.value);
    default:
      return appliedThrough(content, textLens(edit.field), edit.base, edit.value);
  }
}
