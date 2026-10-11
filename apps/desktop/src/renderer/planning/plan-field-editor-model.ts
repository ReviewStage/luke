import {
  PLAN_EDIT_REFUSAL,
  type PlanEditRequest,
  type PlanEditValue,
} from "@sidecar/hosted/plan-edit";
import {
  PLAN_FIELD,
  PLAN_FIELD_HEADING,
  PLAN_TEXT_FIELDS,
  type PlanContent,
  type PlanTextField,
  planTextFieldValue,
} from "@sidecar/hosted/plan-template";
import {
  PLAN_BOUNDS,
  PLAN_FIELD_BOUNDS,
  type PlanFields,
  type PlanRule,
  planAssumptionSchema,
  planFieldsSchema,
} from "@sidecar/hosted/plan-wire";
import {
  PLAN_CALL_FAILURE,
  type PlanningEditAnswer,
  type PlanningEditFailure,
} from "@sidecar/hosted/planning-view";
import { Schema } from "effect";

/**
 * plan-field-editor-model.ts -- one field of the open plan in an editor: what the developer typed, what the service holds of theirs, and when to save.
 *
 * The developer edits a plan a field at a time, never its headings
 * (`@sidecar/hosted/plan-edit`): a text field's Markdown, one rule of the
 * rules (its statement and its examples), or the open questions or the
 * assumptions, one to a line. An editor opens on the field as the plan holds
 * it, which is the edit's base: what the developer's words were written
 * from. A rule is saved as the rules whole, with that one rule changed, so a
 * rule Luke added meanwhile is merged over on the service like any other
 * line. Each save that lands moves the base to what was saved, so the next
 * save is a change from the developer's own last words. One save is out at a
 * time; words typed while it is out are saved once it answers. A conflict
 * holds the editor open with the developer's words until they keep theirs,
 * which saves them over what the field holds now, or take Luke's, which
 * closes it on his. A save that failed keeps the words and waits: it is
 * tried again when the developer asks or types on, never on its own, so a
 * service that keeps refusing is not asked again and again. Everything here
 * is pure.
 */

/** Where an editor stands with the service. */
export const FIELD_EDITOR_STATE = {
  /** Nothing out and nothing refused; words not yet saved are saved on the next pause. */
  EDITING: "editing",
  /** Luke changed the field where the developer's words land; nothing is saved until they choose. */
  CONFLICT: "conflict",
  /** The last save failed; the words stand until the developer tries again or types on. */
  FAILED: "failed",
} as const;

type FieldEditorState =
  | { readonly kind: typeof FIELD_EDITOR_STATE.EDITING }
  | { readonly kind: typeof FIELD_EDITOR_STATE.CONFLICT; readonly current: PlanEditValue }
  | { readonly kind: typeof FIELD_EDITOR_STATE.FAILED; readonly note: string };

/** What an editor edits: a text field, one rule by its place (the rules' length for a new one), or a list. */
export type EditTarget =
  | { readonly field: PlanTextField }
  | { readonly field: typeof PLAN_FIELD.RULES; readonly rule: number }
  | { readonly field: typeof PLAN_FIELD.OPEN_QUESTIONS }
  | { readonly field: typeof PLAN_FIELD.ASSUMPTIONS };

/** One example of a rule as the editor holds it: each clause as typed, empty while unknown. */
export interface ExampleDraft {
  readonly given: string;
  readonly when: string;
  readonly then: string;
}

/** One rule as the editor holds it. */
export interface RuleDraft {
  readonly statement: string;
  readonly examples: readonly ExampleDraft[];
}

/** The kinds of words an editor holds: a box of text, or a rule's parts. */
export const EDIT_DRAFT = {
  TEXT: "text",
  RULE: "rule",
} as const;

export type EditDraft =
  | { readonly kind: typeof EDIT_DRAFT.TEXT; readonly text: string }
  | { readonly kind: typeof EDIT_DRAFT.RULE; readonly rule: RuleDraft };

/** A field as the service holds it of the developer's, by its kind: the edit's base. */
type EditBase =
  | { readonly field: PlanTextField; readonly base: string | null }
  | { readonly field: typeof PLAN_FIELD.RULES; readonly base: PlanFields["rules"] }
  | { readonly field: typeof PLAN_FIELD.OPEN_QUESTIONS; readonly base: readonly string[] }
  | {
      readonly field: typeof PLAN_FIELD.ASSUMPTIONS;
      readonly base: PlanContent["assumptions"];
    };

/** One field open in an editor. */
export interface FieldEditor {
  readonly target: EditTarget;
  readonly draft: EditDraft;
  /** The field as the developer's words are a change from: what the editor opened on, or their own last save. */
  readonly saved: EditBase;
  /** The save still out; absent while none is. */
  readonly sending?: PlanEditRequest;
  readonly state: FieldEditorState;
  /** Whether the developer asked to close it, which it does once nothing is left to save. */
  readonly closing: boolean;
}

/** What a failed save says beside the editor, by why it failed. */
const FAILURE_NOTE = {
  [PLAN_CALL_FAILURE.UNANSWERED]: "Not saved: the service did not answer.",
  [PLAN_CALL_FAILURE.NOT_FOUND]: "Not saved: this plan no longer exists.",
  [PLAN_EDIT_REFUSAL.TOO_LONG]: "Not saved: the plan would be longer than a plan may be.",
} as const satisfies Record<PlanningEditFailure, string>;

/** What the editor says while Luke's words and the developer's disagree. */
export const CONFLICT_NOTE = "Luke changed this section while you were editing.";

/** The longest each part of an editor may hold, the service's own bounds. */
export const EDITOR_BOUNDS = {
  ANSWER_CHARS: PLAN_FIELD_BOUNDS.MAX_ANSWER_CHARS,
  RULE_CHARS: PLAN_FIELD_BOUNDS.MAX_RULE_CHARS,
  EXAMPLE_PART_CHARS: PLAN_FIELD_BOUNDS.MAX_EXAMPLE_PART_CHARS,
  ASSUMPTION_CHARS: PLAN_BOUNDS.MAX_ASSUMPTION_CHARS,
} as const;

/** A heading line the formatter writes for a section or a field. */
const UNIT_HEADING = /^#{2,3} (.+)$/u;

/** A rule's heading: its number, then its statement. */
const RULE_HEADING = /^### Rule (\d+): /u;

/** The list markers an item's line may open with, which the formatter draws itself. */
const LEADING_LIST_MARKERS = /^(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)+/u;

/** Each text field, by the heading it stands under. */
const FIELD_OF_HEADING: ReadonlyMap<string, PlanTextField> = new Map(
  PLAN_TEXT_FIELDS.map((field) => [PLAN_FIELD_HEADING[field], field]),
);

const isRules = Schema.is(planFieldsSchema.fields.rules);
const isOpenQuestions = Schema.is(planFieldsSchema.fields.openQuestions);
const isAssumptions = Schema.is(Schema.Array(planAssumptionSchema));
const isAnswer = Schema.is(Schema.NullOr(Schema.String));

/** The text field a unit of the body holds, by its heading; none for a section's heading, a rule, or a list. */
export function textFieldOfUnit(words: string): PlanTextField | undefined {
  const heading = UNIT_HEADING.exec(words.split("\n", 1)[0] ?? "")?.[1];
  return heading === undefined ? undefined : FIELD_OF_HEADING.get(heading);
}

/**
 * What a unit of the body is edited as: its text field, its rule by number,
 * the open questions, or, for the rules' own heading, a new rule after the
 * `ruleCount` rules standing; none for a section's heading or the title.
 */
export function editTargetOfUnit(words: string, ruleCount: number): EditTarget | undefined {
  const line = words.split("\n", 1)[0] ?? "";
  const rule = RULE_HEADING.exec(line)?.[1];
  if (rule !== undefined) return { field: PLAN_FIELD.RULES, rule: Number(rule) - 1 };
  const heading = UNIT_HEADING.exec(line)?.[1];
  if (heading === PLAN_FIELD_HEADING.rules) return { field: PLAN_FIELD.RULES, rule: ruleCount };
  if (heading === PLAN_FIELD_HEADING.openQuestions) return { field: PLAN_FIELD.OPEN_QUESTIONS };
  const field = textFieldOfUnit(words);
  return field === undefined ? undefined : { field };
}

/** Whether two targets name the same editor. */
export function sameTarget(left: EditTarget, right: EditTarget): boolean {
  if (left.field !== right.field) return false;
  return !("rule" in left) || !("rule" in right) || left.rule === right.rule;
}

/** An item on one line, its own breaks folded into spaces. */
function oneLine(item: string): string {
  return item.replace(/\s*\n\s*/gu, " ");
}

/** A box of lines as the list it holds: one item a line, list markers dropped, blank lines none. */
function itemsOf(text: string): readonly string[] {
  return text
    .split("\n")
    .map((line) => line.replace(LEADING_LIST_MARKERS, "").trim())
    .filter((line) => line !== "");
}

/** A clause as saved: null where nothing but whitespace stands. */
function clauseOf(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/** A rule's parts as saved, or nothing where its statement is blank, which strikes it; an example of blank clauses is dropped. */
function ruleOf(draft: RuleDraft): PlanRule | undefined {
  const statement = draft.statement.trim();
  if (statement === "") return undefined;
  const examples = draft.examples
    .map((example) => ({
      given: clauseOf(example.given),
      when: clauseOf(example.when),
      // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
      then: clauseOf(example.then), // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
    }))
    .filter((example) => example.given !== null || example.when !== null || example.then !== null);
  return { statement, examples: examples.length === 0 ? null : examples };
}

/** The rules with one changed in its place, added at their end, or struck. */
function rulesWith(
  rules: PlanFields["rules"],
  index: number,
  rule: PlanRule | undefined,
): PlanFields["rules"] {
  const standing = [...(rules ?? [])];
  if (rule === undefined) standing.splice(index, 1);
  else if (index < standing.length) standing[index] = rule;
  else standing.push(rule);
  return standing.length === 0 ? null : standing;
}

/** A rule's draft from the rule as it stands, an empty one for a new rule. */
function ruleDraftOf(rule: PlanRule | undefined): RuleDraft {
  return {
    statement: rule?.statement ?? "",
    examples: (rule?.examples ?? []).map((example) => ({
      given: example.given ?? "",
      when: example.when ?? "",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
      then: example.then ?? "", // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
    })),
  };
}

/** The field a target edits, as the content holds it. */
function baseOf(target: EditTarget, content: PlanContent): EditBase {
  switch (target.field) {
    case PLAN_FIELD.RULES:
      return { field: target.field, base: content.fields.rules };
    case PLAN_FIELD.OPEN_QUESTIONS:
      return { field: target.field, base: content.fields.openQuestions };
    case PLAN_FIELD.ASSUMPTIONS:
      return { field: target.field, base: content.assumptions };
    default:
      return { field: target.field, base: planTextFieldValue(content.fields, target.field) };
  }
}

/** The words an editor holds of a field as it stands. */
function draftOf(target: EditTarget, saved: EditBase): EditDraft {
  switch (saved.field) {
    case PLAN_FIELD.RULES: {
      const index = "rule" in target ? target.rule : 0;
      return { kind: EDIT_DRAFT.RULE, rule: ruleDraftOf(saved.base?.[index]) };
    }
    case PLAN_FIELD.OPEN_QUESTIONS:
      return { kind: EDIT_DRAFT.TEXT, text: saved.base.map(oneLine).join("\n") };
    case PLAN_FIELD.ASSUMPTIONS:
      return {
        kind: EDIT_DRAFT.TEXT,
        text: saved.base.map((assumption) => oneLine(assumption.text)).join("\n"),
      };
    default:
      return { kind: EDIT_DRAFT.TEXT, text: saved.base ?? "" };
  }
}

/** The text a box holds, or none for a rule. */
function textOf(draft: EditDraft): string {
  return draft.kind === EDIT_DRAFT.TEXT ? draft.text : "";
}

/** The save an editor's words make: the field's base and what the words save as. */
function requestOf(editor: FieldEditor): PlanEditRequest {
  const { saved, draft, target } = editor;
  switch (saved.field) {
    case PLAN_FIELD.RULES: {
      const index = "rule" in target ? target.rule : 0;
      const rule = draft.kind === EDIT_DRAFT.RULE ? ruleOf(draft.rule) : undefined;
      return { field: saved.field, base: saved.base, value: rulesWith(saved.base, index, rule) };
    }
    case PLAN_FIELD.OPEN_QUESTIONS:
      return { field: saved.field, base: saved.base, value: itemsOf(textOf(draft)) };
    case PLAN_FIELD.ASSUMPTIONS:
      return {
        field: saved.field,
        base: saved.base,
        value: itemsOf(textOf(draft)).map((text) => ({ text })),
      };
    default:
      return { field: saved.field, base: saved.base, value: clauseOf(textOf(draft)) };
  }
}

/** The field as the service holds it of the developer's once a save lands. */
function savedAs(request: PlanEditRequest): EditBase {
  switch (request.field) {
    case PLAN_FIELD.RULES:
      return { field: request.field, base: request.value };
    case PLAN_FIELD.OPEN_QUESTIONS:
      return { field: request.field, base: request.value };
    case PLAN_FIELD.ASSUMPTIONS:
      return { field: request.field, base: request.value };
    default:
      return { field: request.field, base: request.value };
  }
}

/** The field as a conflict answered it, as a base of its kind; nothing where it is not one. */
function currentAs(field: EditBase["field"], current: PlanEditValue): EditBase | undefined {
  switch (field) {
    case PLAN_FIELD.RULES:
      return isRules(current) ? { field, base: current } : undefined;
    case PLAN_FIELD.OPEN_QUESTIONS:
      return isOpenQuestions(current) ? { field, base: current } : undefined;
    case PLAN_FIELD.ASSUMPTIONS:
      return isAssumptions(current) ? { field, base: current } : undefined;
    default:
      return isAnswer(current) ? { field, base: current } : undefined;
  }
}

/** An editor opened on a field as the content holds it. */
export function editorOpened(target: EditTarget, content: PlanContent): FieldEditor {
  const saved = baseOf(target, content);
  return {
    target,
    draft: draftOf(target, saved),
    saved,
    state: { kind: FIELD_EDITOR_STATE.EDITING },
    closing: false,
  };
}

/** Words typed: a failed save is tried again with them on the next pause; a conflict still waits. */
export function editorTyped(editor: FieldEditor, draft: EditDraft): FieldEditor {
  if (editor.state.kind === FIELD_EDITOR_STATE.FAILED) {
    return { ...editor, draft, state: { kind: FIELD_EDITOR_STATE.EDITING } };
  }
  return { ...editor, draft };
}

/**
 * The save to make now, or nothing: nothing while a save is out, a conflict
 * waits on the developer, or a failed save waits to be tried again, and
 * nothing where the words already are what the service holds of theirs.
 */
export function pendingSave(editor: FieldEditor): PlanEditRequest | undefined {
  if (editor.sending !== undefined) return undefined;
  if (editor.state.kind !== FIELD_EDITOR_STATE.EDITING) return undefined;
  const request = requestOf(editor);
  return JSON.stringify(request.value) === JSON.stringify(request.base) ? undefined : request;
}

export function editorSent(editor: FieldEditor, request: PlanEditRequest): FieldEditor {
  return { ...editor, sending: request };
}

/** The service's answer to the save that was out. */
export function editorAnswered(editor: FieldEditor, answer: PlanningEditAnswer): FieldEditor {
  const { sending: sent, ...rest } = editor;
  if ("saved" in answer) {
    return {
      ...rest,
      saved: sent === undefined ? editor.saved : savedAs(sent),
      state: { kind: FIELD_EDITOR_STATE.EDITING },
    };
  }
  if ("conflict" in answer) {
    return {
      ...rest,
      state: { kind: FIELD_EDITOR_STATE.CONFLICT, current: answer.conflict.current },
    };
  }
  return {
    ...rest,
    state: { kind: FIELD_EDITOR_STATE.FAILED, note: FAILURE_NOTE[answer.failure] },
  };
}

/** The save that was out never answered: the act itself was refused. */
export function editorRefused(editor: FieldEditor, note: string): FieldEditor {
  const { sending: _sent, ...rest } = editor;
  return { ...rest, state: { kind: FIELD_EDITOR_STATE.FAILED, note } };
}

/** The developer asks a failed save to be tried again. */
export function editorRetried(editor: FieldEditor): FieldEditor {
  if (editor.state.kind !== FIELD_EDITOR_STATE.FAILED) return editor;
  return { ...editor, state: { kind: FIELD_EDITOR_STATE.EDITING } };
}

/** The developer keeps their words over Luke's: what the field holds now becomes the base, so the next save sets theirs. */
export function editorKeptMine(editor: FieldEditor): FieldEditor {
  if (editor.state.kind !== FIELD_EDITOR_STATE.CONFLICT) return editor;
  const saved = currentAs(editor.saved.field, editor.state.current) ?? editor.saved;
  return { ...editor, saved, state: { kind: FIELD_EDITOR_STATE.EDITING } };
}

/** The developer takes Luke's words: the editor holds them and closes, with nothing to save. */
export function editorTookLukes(editor: FieldEditor): FieldEditor {
  if (editor.state.kind !== FIELD_EDITOR_STATE.CONFLICT) return editor;
  const saved = currentAs(editor.saved.field, editor.state.current) ?? editor.saved;
  return {
    ...editor,
    saved,
    draft: draftOf(editor.target, saved),
    state: { kind: FIELD_EDITOR_STATE.EDITING },
    closing: true,
  };
}

export function editorCloseAsked(editor: FieldEditor): FieldEditor {
  return { ...editor, closing: true };
}

/** A rule struck from the editor that holds it: its words emptied and the editor closing, which saves the rules without it. */
export function editorRuleStruck(editor: FieldEditor): FieldEditor {
  if (editor.draft.kind !== EDIT_DRAFT.RULE) return editor;
  return {
    ...editor,
    draft: { kind: EDIT_DRAFT.RULE, rule: { statement: "", examples: [] } },
    closing: true,
  };
}

/** Whether the editor closes now: asked to, with nothing out, nothing waiting on the developer, and nothing left to save. */
export function editorCloses(editor: FieldEditor): boolean {
  return (
    editor.closing &&
    editor.sending === undefined &&
    editor.state.kind === FIELD_EDITOR_STATE.EDITING &&
    pendingSave(editor) === undefined
  );
}
