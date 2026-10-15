import { Schema } from "effect";
import { PLAN_EDIT_REFUSAL, type PlanEditRequest, type PlanEditValue } from "./plan-edit.js";
import { TASK_BOUNDS } from "./task-wire.js";
import { TASK_CALL_FAILURE, type TasksEditAnswer, type TasksEditFailure } from "./tasks-view.js";

/**
 * plan-edit-model.ts -- the open plan's text in its editor: what the developer typed, what the service holds of theirs, and when to save.
 *
 * The developer edits a plan whole, as one document. An editor opens on the
 * text as the plan holds it, which is the edit's base: what the developer's
 * words were written from. Each save sends that base and the words, and the
 * service lays the change over whatever Luke wrote meanwhile
 * (`@luke/features/plan-edit`). Each save that lands moves the base to what
 * was saved, so the next save is a change from the developer's own last
 * words. One save is out at a time; words typed while it is out are saved
 * once it answers. A conflict holds the editor open with the developer's
 * words until they keep theirs, which saves them over what the text holds
 * now, or take Luke's, which closes it on his. A save that failed keeps the
 * words and waits: it is tried again when the developer asks or types on,
 * never on its own, so a service that keeps refusing is not asked again and
 * again. A text past the bound a document may hold is refused here rather
 * than sent. Everything here is pure.
 */

/** Where an editor stands with the service. */
export const DOCUMENT_EDITOR_STATE = {
  /** Nothing out and nothing refused; words not yet saved are saved on the next pause. */
  EDITING: "editing",
  /** Luke changed the text where the developer's words land; nothing is saved until they choose. */
  CONFLICT: "conflict",
  /** The last save failed; the words stand until the developer tries again or types on. */
  FAILED: "failed",
} as const;

type DocumentEditorState =
  | { readonly kind: typeof DOCUMENT_EDITOR_STATE.EDITING }
  | { readonly kind: typeof DOCUMENT_EDITOR_STATE.CONFLICT; readonly current: string }
  | { readonly kind: typeof DOCUMENT_EDITOR_STATE.FAILED; readonly note: string };

/** The open plan's text in its editor. */
export interface DocumentEditor {
  /** The words in the editor. */
  readonly draft: string;
  /** The text the developer's words are a change from: what the editor opened on, or their own last save. */
  readonly base: string;
  /** The save still out; absent while none is. */
  readonly sending?: PlanEditRequest;
  readonly state: DocumentEditorState;
  /** Whether the developer asked to close it, which it does once nothing is left to save. */
  readonly closing: boolean;
}

/** What a failed save says beside the editor, by why it failed. */
const FAILURE_NOTE = {
  [TASK_CALL_FAILURE.UNANSWERED]: "Not saved: the service did not answer.",
  [TASK_CALL_FAILURE.NOT_FOUND]: "Not saved: this task no longer exists.",
  [TASK_CALL_FAILURE.TASK_ARCHIVED]: "Not saved: this task is archived.",
  [PLAN_EDIT_REFUSAL.TOO_LONG]: "Not saved: the plan is too long.",
} as const satisfies Record<TasksEditFailure, string>;

/** What the editor says while Luke's words and the developer's disagree. */
export const CONFLICT_NOTE = "Luke changed this section while you were editing.";

/** Whether a text is past what a document may hold, which the service would refuse. */
function tooLong(text: string): boolean {
  return text.length > TASK_BOUNDS.MAX_BODY_CHARS;
}

const isText = Schema.is(Schema.String);

/** The text a conflict answered, which a document's conflict always is; the base kept where it is not. */
function currentOr(base: string, current: PlanEditValue): string {
  return isText(current) ? current : base;
}

/** An editor opened on the plan's text as it stands. */
export function editorOpened(text: string): DocumentEditor {
  return {
    draft: text,
    base: text,
    state: { kind: DOCUMENT_EDITOR_STATE.EDITING },
    closing: false,
  };
}

/**
 * Words typed: a failed save is tried again with them on the next pause; a
 * conflict still waits; a text past its bound says so and is not sent.
 */
export function editorTyped(editor: DocumentEditor, draft: string): DocumentEditor {
  if (tooLong(draft)) {
    const note = FAILURE_NOTE[PLAN_EDIT_REFUSAL.TOO_LONG];
    return { ...editor, draft, state: { kind: DOCUMENT_EDITOR_STATE.FAILED, note } };
  }
  if (editor.state.kind === DOCUMENT_EDITOR_STATE.FAILED) {
    return { ...editor, draft, state: { kind: DOCUMENT_EDITOR_STATE.EDITING } };
  }
  return { ...editor, draft };
}

/**
 * The save to make now, or nothing: nothing while a save is out, a conflict
 * waits on the developer, or a failed save waits to be tried again, and
 * nothing where the words already are what the service holds of theirs.
 */
export function pendingSave(editor: DocumentEditor): PlanEditRequest | undefined {
  if (editor.sending !== undefined) return undefined;
  if (editor.state.kind !== DOCUMENT_EDITOR_STATE.EDITING) return undefined;
  const { base, draft } = editor;
  if (draft === base || tooLong(draft)) return undefined;
  return { document: { base, value: draft } };
}

export function editorSent(editor: DocumentEditor, request: PlanEditRequest): DocumentEditor {
  return { ...editor, sending: request };
}

/** The service's answer to the save that was out. */
export function editorAnswered(editor: DocumentEditor, answer: TasksEditAnswer): DocumentEditor {
  const { sending: sent, ...rest } = editor;
  if ("saved" in answer) {
    const base = sent === undefined ? editor.base : sent.document.value;
    // Note that words typed past the bound while the save was out still say so, so they hold the editor open.
    return editorTyped(
      { ...rest, base, state: { kind: DOCUMENT_EDITOR_STATE.EDITING } },
      rest.draft,
    );
  }
  if ("conflict" in answer) {
    const current = currentOr(editor.base, answer.conflict.current);
    return { ...rest, state: { kind: DOCUMENT_EDITOR_STATE.CONFLICT, current } };
  }
  return {
    ...rest,
    state: { kind: DOCUMENT_EDITOR_STATE.FAILED, note: FAILURE_NOTE[answer.failure] },
  };
}

/** The save that was out never answered: the act itself was refused. */
export function editorRefused(editor: DocumentEditor, note: string): DocumentEditor {
  const { sending: _sent, ...rest } = editor;
  return { ...rest, state: { kind: DOCUMENT_EDITOR_STATE.FAILED, note } };
}

/** The developer asks a failed save to be tried again. */
export function editorRetried(editor: DocumentEditor): DocumentEditor {
  if (editor.state.kind !== DOCUMENT_EDITOR_STATE.FAILED) return editor;
  return { ...editor, state: { kind: DOCUMENT_EDITOR_STATE.EDITING } };
}

/** The developer keeps their words over Luke's: what the text holds now becomes the base, so the next save sets theirs. */
export function editorKeptMine(editor: DocumentEditor): DocumentEditor {
  if (editor.state.kind !== DOCUMENT_EDITOR_STATE.CONFLICT) return editor;
  const base = editor.state.current;
  return { ...editor, base, state: { kind: DOCUMENT_EDITOR_STATE.EDITING } };
}

/** The developer takes Luke's words: the editor holds them and closes, with nothing to save. */
export function editorTookLukes(editor: DocumentEditor): DocumentEditor {
  if (editor.state.kind !== DOCUMENT_EDITOR_STATE.CONFLICT) return editor;
  const base = editor.state.current;
  return {
    ...editor,
    base,
    draft: base,
    state: { kind: DOCUMENT_EDITOR_STATE.EDITING },
    closing: true,
  };
}

/**
 * The text once the open editor has taken Luke's part of a save's merged
 * answer into its words: the base becomes the text the service holds of the
 * developer's and Luke's alike, and the words what the editor holds now, in
 * one step, so no save goes out from the one without the other.
 */
export function editorRebased(editor: DocumentEditor, base: string, draft: string): DocumentEditor {
  return { ...editor, draft, base };
}

export function editorCloseAsked(editor: DocumentEditor): DocumentEditor {
  return { ...editor, closing: true };
}

/** Whether the editor closes now: asked to, with nothing out, nothing waiting on the developer, and nothing left to save. */
export function editorCloses(editor: DocumentEditor): boolean {
  return (
    editor.closing &&
    editor.sending === undefined &&
    editor.state.kind === DOCUMENT_EDITOR_STATE.EDITING &&
    pendingSave(editor) === undefined
  );
}
