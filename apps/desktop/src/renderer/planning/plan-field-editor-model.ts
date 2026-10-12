import {
  PLAN_EDIT_REFUSAL,
  type PlanEditRequest,
  type PlanEditValue,
} from "@sidecar/hosted/plan-edit";
import {
  EMPTY_PLAN_CONTENT,
  PLAN_FIELD_HEADING,
  PLAN_TEXT_FIELDS,
  type PlanContent,
  type PlanTextField,
  planTextFieldValue,
} from "@sidecar/hosted/plan-template";
import {
  PLAN_BOUNDS,
  PLAN_FIELD,
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
 * (`@sidecar/hosted/plan-edit`): a section's Markdown, or the open questions
 * or the assumptions, one to a line. An editor opens on the field as the plan
 * holds it, which is the edit's base: what the developer's words were
 * written from. A list is saved whole, so an item Luke added meanwhile is
 * merged over on the service like any other line. Each save that lands
 * moves the base to what was saved, so the next
 * save is a change from the developer's own last words. One save is out at a
 * time; words typed while it is out are saved once it answers. A conflict
 * holds the editor open with the developer's words until they keep theirs,
 * which saves them over what the field holds now, or take Luke's, which
 * closes it on his. A save that failed keeps the words and waits: it is
 * tried again when the developer asks or types on, never on its own, so a
 * service that keeps refusing is not asked again and again. A plan that is
 * one document is edited whole, the same way: its text is the one field, saved
 * as the document's base and value, and a text past the bound a document may
 * hold is refused here rather than sent. Everything here is pure.
 */

/** What an editor may edit beside a field: a plan that is one document, whole. */
export const EDIT_SCOPE = {
  DOCUMENT: "document",
} as const;

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

/** What a unit of a plan of the template's fields is edited as: a text field, or a list. */
export type FieldTarget =
  | { readonly field: PlanTextField }
  | { readonly field: typeof PLAN_FIELD.OPEN_QUESTIONS }
  | { readonly field: typeof PLAN_FIELD.ASSUMPTIONS };

/** What an editor edits: a field, or a plan's whole document. */
export type EditTarget = FieldTarget | { readonly field: typeof EDIT_SCOPE.DOCUMENT };

/** What an editor and its way in are called in the developer's words: the field's heading, or the plan. */
export function targetHeading(target: EditTarget): string {
  return target.field === EDIT_SCOPE.DOCUMENT ? "Plan" : PLAN_FIELD_HEADING[target.field];
}

/** A field as the service holds it of the developer's, by its kind: the edit's base. */
type EditBase =
  | { readonly field: typeof EDIT_SCOPE.DOCUMENT; readonly base: string }
  | { readonly field: PlanTextField; readonly base: string | null }
  | { readonly field: typeof PLAN_FIELD.OPEN_QUESTIONS; readonly base: readonly string[] }
  | {
      readonly field: typeof PLAN_FIELD.ASSUMPTIONS;
      readonly base: PlanContent["assumptions"];
    };

/** One field open in an editor. */
export interface FieldEditor {
  readonly target: EditTarget;
  /** The words in the editor's box: a section's Markdown, or a list one item to a line. */
  readonly draft: string;
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
  [PLAN_CALL_FAILURE.PLAN_ARCHIVED]: "Not saved: this plan is archived.",
  [PLAN_EDIT_REFUSAL.TOO_LONG]: "Not saved: the plan would be longer than a plan may be.",
} as const satisfies Record<PlanningEditFailure, string>;

/** What the editor says while Luke's words and the developer's disagree. */
export const CONFLICT_NOTE = "Luke changed this section while you were editing.";

/** A heading line the formatter writes for a section. */
const UNIT_HEADING = /^## (.+)$/u;

/** The list markers an item's line may open with, which the formatter draws itself. */
const LEADING_LIST_MARKERS = /^(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)+/u;

/** Each field a unit of the body is edited as, by the heading it stands under: the text fields and the open questions. */
const FIELD_OF_HEADING: ReadonlyMap<string, FieldTarget["field"]> = new Map(
  [...PLAN_TEXT_FIELDS, PLAN_FIELD.OPEN_QUESTIONS].map((field) => [
    PLAN_FIELD_HEADING[field],
    field,
  ]),
);

const isOpenQuestions = Schema.is(planFieldsSchema.fields.openQuestions);
const isAssumptions = Schema.is(Schema.Array(planAssumptionSchema));
const isAnswer = Schema.is(Schema.NullOr(Schema.String));
const isDocumentText = Schema.is(Schema.String);

/** What a unit of the body is edited as, by its heading: its text field, or the open questions; none for the title. */
export function editTargetOfUnit(words: string): FieldTarget | undefined {
  const heading = UNIT_HEADING.exec(words.split("\n", 1)[0] ?? "")?.[1];
  const field = heading === undefined ? undefined : FIELD_OF_HEADING.get(heading);
  return field === undefined ? undefined : { field };
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

/**
 * The box's items with each line left as typed from an item standing back to
 * that item, its own line breaks and all, since the box drew it on one line;
 * only a line the developer changed or added saves as typed.
 */
function itemsKept(lines: readonly string[], standing: readonly string[]): readonly string[] {
  const byLine = new Map(standing.map((item) => [oneLine(item), item]));
  return lines.map((line) => byLine.get(line) ?? line);
}

/** A text field's answer as saved: null where nothing but whitespace stands. */
function answerOf(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/** What an editor opens on: a plan's fields, or the text of a plan that is one document. */
export type EditContent = PlanContent | { readonly text: string };

/** Whether a document's text is past what a document may hold, which the service would refuse. */
function tooLong(text: string): boolean {
  return text.length > PLAN_BOUNDS.MAX_BODY_CHARS;
}

/** The field a target edits, as the content holds it. */
function baseOf(target: EditTarget, content: EditContent): EditBase {
  if (target.field === EDIT_SCOPE.DOCUMENT) {
    return { field: target.field, base: "text" in content ? content.text : "" };
  }
  const { fields, assumptions } = "fields" in content ? content : EMPTY_PLAN_CONTENT;
  switch (target.field) {
    case PLAN_FIELD.OPEN_QUESTIONS:
      return { field: target.field, base: fields.openQuestions };
    case PLAN_FIELD.ASSUMPTIONS:
      return { field: target.field, base: assumptions };
    default:
      return { field: target.field, base: planTextFieldValue(fields, target.field) };
  }
}

/** The words an editor holds of a field as it stands. */
function draftOf(saved: EditBase): string {
  switch (saved.field) {
    case EDIT_SCOPE.DOCUMENT:
      return saved.base;
    case PLAN_FIELD.OPEN_QUESTIONS:
      return saved.base.map(oneLine).join("\n");
    case PLAN_FIELD.ASSUMPTIONS:
      return saved.base.map((assumption) => oneLine(assumption.text)).join("\n");
    default:
      return saved.base ?? "";
  }
}

/** The save an editor's words make: the field's base and what the words save as. */
function requestOf(editor: FieldEditor): PlanEditRequest {
  const { saved, draft } = editor;
  switch (saved.field) {
    case EDIT_SCOPE.DOCUMENT:
      return { document: { base: saved.base, value: draft } };
    case PLAN_FIELD.OPEN_QUESTIONS:
      return { field: saved.field, base: saved.base, value: itemsKept(itemsOf(draft), saved.base) };
    case PLAN_FIELD.ASSUMPTIONS: {
      const standing = saved.base.map((assumption) => assumption.text);
      return {
        field: saved.field,
        base: saved.base,
        value: itemsKept(itemsOf(draft), standing).map((text) => ({ text })),
      };
    }
    default:
      return { field: saved.field, base: saved.base, value: answerOf(draft) };
  }
}

/** The field as the service holds it of the developer's once a save lands. */
function savedAs(request: PlanEditRequest): EditBase {
  if ("document" in request) return { field: EDIT_SCOPE.DOCUMENT, base: request.document.value };
  switch (request.field) {
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
    case EDIT_SCOPE.DOCUMENT:
      return isDocumentText(current) ? { field, base: current } : undefined;
    case PLAN_FIELD.OPEN_QUESTIONS:
      return isOpenQuestions(current) ? { field, base: current } : undefined;
    case PLAN_FIELD.ASSUMPTIONS:
      return isAssumptions(current) ? { field, base: current } : undefined;
    default:
      return isAnswer(current) ? { field, base: current } : undefined;
  }
}

/** An editor opened on a field as the content holds it. */
export function editorOpened(target: EditTarget, content: EditContent): FieldEditor {
  const saved = baseOf(target, content);
  return {
    target,
    draft: draftOf(saved),
    saved,
    state: { kind: FIELD_EDITOR_STATE.EDITING },
    closing: false,
  };
}

/**
 * Words typed: a failed save is tried again with them on the next pause; a
 * conflict still waits; a document past its bound says so and is not sent.
 */
export function editorTyped(editor: FieldEditor, draft: string): FieldEditor {
  if (editor.target.field === EDIT_SCOPE.DOCUMENT && tooLong(draft)) {
    const note = FAILURE_NOTE[PLAN_EDIT_REFUSAL.TOO_LONG];
    return { ...editor, draft, state: { kind: FIELD_EDITOR_STATE.FAILED, note } };
  }
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
  if ("document" in request) {
    const { base, value } = request.document;
    return value === base || tooLong(value) ? undefined : request;
  }
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
    draft: draftOf(saved),
    state: { kind: FIELD_EDITOR_STATE.EDITING },
    closing: true,
  };
}

/**
 * A document once the open editor has taken Luke's part of a save's merged
 * answer into its words: the base becomes the text the service holds of the
 * developer's and Luke's alike, and the words what the editor holds now, in
 * one step, so no save goes out from the one without the other.
 */
export function editorRebased(editor: FieldEditor, base: string, draft: string): FieldEditor {
  if (editor.saved.field !== EDIT_SCOPE.DOCUMENT) return editor;
  return { ...editor, draft, saved: { field: EDIT_SCOPE.DOCUMENT, base } };
}

export function editorCloseAsked(editor: FieldEditor): FieldEditor {
  return { ...editor, closing: true };
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
