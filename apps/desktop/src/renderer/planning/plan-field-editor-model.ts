import { PLAN_EDIT_REFUSAL } from "@sidecar/hosted/plan-edit";
import {
  PLAN_FIELD_HEADING,
  PLAN_TEXT_FIELDS,
  type PlanTextField,
} from "@sidecar/hosted/plan-template";
import {
  PLAN_CALL_FAILURE,
  type PlanningEditAnswer,
  type PlanningEditFailure,
} from "@sidecar/hosted/planning-view";

/**
 * plan-field-editor-model.ts -- one field of the open plan in an editor: what the developer typed, what the service holds of theirs, and when to save.
 *
 * The developer edits a plan a field at a time, never its headings
 * (`@sidecar/hosted/plan-edit`). An editor opens on the field's answer as
 * the plan holds it, which is the edit's base: what the developer's words
 * were written from. Each save that lands moves the base to what was saved,
 * so the next save is a change from the developer's own last words, and Luke
 * writing elsewhere in the field meanwhile is merged over on the service
 * rather than struck. One save is out at a time; words typed while it is out
 * are saved once it answers. A conflict holds the editor open with the
 * developer's words until they keep theirs, which saves them over what the
 * field holds now, or take Luke's, which closes it on his. A save that
 * failed keeps the words and waits: it is tried again when the developer asks
 * or types on, never on its own, so a service that keeps refusing is not
 * asked again and again. Everything here is pure.
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
  | { readonly kind: typeof FIELD_EDITOR_STATE.CONFLICT; readonly current: string | null }
  | { readonly kind: typeof FIELD_EDITOR_STATE.FAILED; readonly note: string };

/** One field open in an editor. */
export interface FieldEditor {
  readonly field: PlanTextField;
  /** What stands in the editor. */
  readonly text: string;
  /** The answer the developer's words are a change from: what the editor opened on, or their own last save. */
  readonly base: string | null;
  /** The answer a save still out is saving; absent while none is out. */
  readonly sending?: string | null;
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

/** A heading line the formatter writes for a section or a field. */
const UNIT_HEADING = /^#{2,3} (.+)$/u;

/** Each text field, by the heading it stands under. */
const FIELD_OF_HEADING: ReadonlyMap<string, PlanTextField> = new Map(
  PLAN_TEXT_FIELDS.map((field) => [PLAN_FIELD_HEADING[field], field]),
);

/** The text field a unit of the body holds, by its heading; none for a section's heading, a rule, or a list. */
export function textFieldOfUnit(words: string): PlanTextField | undefined {
  const heading = UNIT_HEADING.exec(words.split("\n", 1)[0] ?? "")?.[1];
  return heading === undefined ? undefined : FIELD_OF_HEADING.get(heading);
}

/** What the editor's words save as: null where nothing but whitespace stands. */
function answerOf(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/** An editor opened on a field's answer as the plan holds it. */
export function editorOpened(field: PlanTextField, answer: string | null): FieldEditor {
  return {
    field,
    text: answer ?? "",
    base: answer,
    state: { kind: FIELD_EDITOR_STATE.EDITING },
    closing: false,
  };
}

/** Words typed: a failed save is tried again with them on the next pause; a conflict still waits. */
export function editorTyped(editor: FieldEditor, text: string): FieldEditor {
  if (editor.state.kind === FIELD_EDITOR_STATE.FAILED) {
    return { ...editor, text, state: { kind: FIELD_EDITOR_STATE.EDITING } };
  }
  return { ...editor, text };
}

/** The developer asks a failed save to be tried again. */
export function editorRetried(editor: FieldEditor): FieldEditor {
  if (editor.state.kind !== FIELD_EDITOR_STATE.FAILED) return editor;
  return { ...editor, state: { kind: FIELD_EDITOR_STATE.EDITING } };
}

/**
 * The answer to save now, or nothing: nothing while a save is out, a
 * conflict waits on the developer, or a failed save waits to be tried again,
 * and nothing where the words already are what the service holds of theirs.
 */
export function pendingAnswer(editor: FieldEditor): string | null | undefined {
  if (editor.sending !== undefined) return undefined;
  if (editor.state.kind !== FIELD_EDITOR_STATE.EDITING) return undefined;
  const answer = answerOf(editor.text);
  return answer === editor.base ? undefined : answer;
}

export function editorSent(editor: FieldEditor, answer: string | null): FieldEditor {
  return { ...editor, sending: answer };
}

/** The service's answer to the save that was out. */
export function editorAnswered(editor: FieldEditor, answer: PlanningEditAnswer): FieldEditor {
  const { sending: sent, ...rest } = editor;
  if ("saved" in answer) {
    return { ...rest, base: sent ?? null, state: { kind: FIELD_EDITOR_STATE.EDITING } };
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

/** The developer keeps their words over Luke's: what the field holds now becomes the base, so the next save sets theirs. */
export function editorKeptMine(editor: FieldEditor): FieldEditor {
  if (editor.state.kind !== FIELD_EDITOR_STATE.CONFLICT) return editor;
  return { ...editor, base: editor.state.current, state: { kind: FIELD_EDITOR_STATE.EDITING } };
}

/** The developer takes Luke's words: the editor holds them and closes, with nothing to save. */
export function editorTookLukes(editor: FieldEditor): FieldEditor {
  if (editor.state.kind !== FIELD_EDITOR_STATE.CONFLICT) return editor;
  const { current } = editor.state;
  return {
    ...editor,
    text: current ?? "",
    base: current,
    state: { kind: FIELD_EDITOR_STATE.EDITING },
    closing: true,
  };
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
    pendingAnswer(editor) === undefined
  );
}
