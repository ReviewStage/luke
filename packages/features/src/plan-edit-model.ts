import { diffArrays } from "diff";
import { Schema } from "effect";
import type { PlanCommentAnchors } from "./plan-comment-wire.js";
import { PLAN_EDIT_REFUSAL, type PlanEditRequest, type PlanEditValue } from "./plan-edit.js";
import { type PlanLastEdit, TASK_BOUNDS } from "./task-wire.js";
import { TASK_CALL_FAILURE, type TasksEditAnswer, type TasksEditFailure } from "./tasks-view.js";

/**
 * plan-edit-model.ts -- the open plan's text in its editor: what the developer typed, what the service holds of theirs, and when to save.
 *
 * The developer edits a plan whole, as one document. An editor opens on the
 * text as the plan holds it, which is the edit's base: what the developer's
 * words were written from. Each save sends that base and the words, and the
 * service lays the change over whatever anyone else wrote meanwhile
 * (`@luke/features/plan-edit`). Each save that lands moves the base to what
 * was saved, so the next save is a change from the developer's own last
 * words. One save is out at a time; words typed while it is out are saved
 * once it answers. A conflict holds the editor open with the developer's
 * words, naming who wrote what the text holds now, until they keep theirs,
 * which lays their change over the other writer's, theirs standing only where
 * the two changed the same lines, or take the other writer's, which closes the
 * editor on those. A save that failed keeps the
 * words and waits: it is tried again when the developer asks or types on,
 * never on its own, so a service that keeps refusing is not asked again and
 * again. A text past the bound a document may hold is refused here rather
 * than sent. An editor whose task is left tries a failed save once more,
 * and words the service still does not hold of theirs outlive it, to open
 * in its place when the developer comes back. Everything here is pure.
 */

/** Where an editor stands with the service. */
export const DOCUMENT_EDITOR_STATE = {
  /** Nothing out and nothing refused; words not yet saved are saved on the next pause. */
  EDITING: "editing",
  /** Someone else changed the text where the developer's words land; nothing is saved until they choose. */
  CONFLICT: "conflict",
  /** The last save failed; the words stand until the developer tries again or types on. */
  FAILED: "failed",
} as const;

type DocumentEditorState =
  | { readonly kind: typeof DOCUMENT_EDITOR_STATE.EDITING }
  | {
      readonly kind: typeof DOCUMENT_EDITOR_STATE.CONFLICT;
      readonly current: string;
      /** Who last wrote `current`, as the service named them; none where it named nobody. */
      readonly by?: PlanLastEdit;
    }
  | { readonly kind: typeof DOCUMENT_EDITOR_STATE.FAILED; readonly note: string };

/** The open plan's text in its editor. */
export interface DocumentEditor {
  /** The words in the editor. */
  readonly draft: string;
  /** Where the editor's comment threads stand in the words, where it carries any (`plan-comment-wire.ts`). */
  readonly anchors?: PlanCommentAnchors;
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
  [PLAN_EDIT_REFUSAL.TOO_LONG]: "Not saved: the plan is too long.",
} as const satisfies Record<TasksEditFailure, string>;

/** Whether a text is past what a document may hold, which the service would refuse. */
function tooLong(text: string): boolean {
  return text.length > TASK_BOUNDS.MAX_BODY_CHARS;
}

const isText = Schema.is(Schema.String);

/** One change of a text from the base: the base's lines from `from` to `to` replaced by `lines`, the developer's or the other writer's. */
interface LineChange {
  readonly from: number;
  readonly to: number;
  readonly lines: readonly string[];
  readonly mine: boolean;
}

/** A text's changes from the base, line by line, as jsdiff finds them, a run of lines struck and written in taken as one change. */
function lineChanges(base: string[], text: string, mine: boolean): LineChange[] {
  const changes: LineChange[] = [];
  let at = 0;
  for (const part of diffArrays(base, text.split("\n"))) {
    const last = changes.at(-1);
    const changed = part.added || part.removed;
    // Note that a part following a change with no line kept between them is part of that change.
    const joins = changed && last !== undefined && last.to === at;
    if (joins) changes.pop();
    const change = joins ? last : { from: at, to: at, lines: [], mine };
    if (part.added) changes.push({ ...change, lines: [...change.lines, ...part.value] });
    if (part.removed) changes.push({ ...change, to: at + part.count });
    if (!part.added) at += part.count;
  }
  return changes;
}

/** Changes in the base's order, a line written in before the change to the line it stands at, the other writer's before the developer's. */
function byPlace(a: LineChange, b: LineChange): number {
  const aWrites = a.from === a.to ? 0 : 1;
  const bWrites = b.from === b.to ? 0 : 1;
  return a.from - b.from || aWrites - bWrites || Number(a.mine) - Number(b.mine);
}

/**
 * The changes of one place both writers may have changed: each's where only
 * one did; where both wrote lines in at one place, both, the other writer's
 * first, or one where they wrote the same; and the developer's alone where
 * the two changed the same lines.
 */
function settledChanges(place: readonly LineChange[]): readonly LineChange[] {
  const mine = place.filter((change) => change.mine);
  const theirs = place.filter((change) => !change.mine);
  if (mine.length === 0 || theirs.length === 0) return place;
  if (!place.every((change) => change.from === change.to)) return mine;
  const same = mine[0]?.lines.join("\n") === theirs[0]?.lines.join("\n");
  return same ? mine : [...theirs, ...mine];
}

/**
 * Changes in the base's order cut into the places they change, where a
 * change touching lines of the place before it, or writing lines in where
 * that place only wrote lines in, joins it, so a run of changes overlapping
 * one another is settled whole.
 */
function placesOf(changes: readonly LineChange[]): (readonly LineChange[])[] {
  const places: LineChange[][] = [];
  let from = 0;
  let to = -1;
  for (const change of changes) {
    const place = places.at(-1);
    const insertsHere = from === to && change.from === to && change.to === to;
    if (place !== undefined && (change.from < to || insertsHere)) place.push(change);
    else {
      places.push([change]);
      from = change.from;
    }
    to = Math.max(to, change.to);
  }
  return places;
}

/**
 * The developer's change from `base` to `mine` laid over the other writer's
 * from `base` to `theirs`, line by line: each change stands where the other
 * writer left its lines alone, and the developer's where both changed the
 * same lines.
 */
function keptOver(base: string, mine: string, theirs: string): string {
  const lines = base.split("\n");
  const changes = [...lineChanges(lines, theirs, false), ...lineChanges(lines, mine, true)];
  const merged: string[] = [];
  let at = 0;
  for (const place of placesOf(changes.sort(byPlace))) {
    for (const change of settledChanges(place)) {
      merged.push(...lines.slice(at, change.from), ...change.lines);
      at = change.to;
    }
    // Note that the other writer's lines a place dropped stand as the base held them.
    const to = Math.max(at, ...place.map((change) => change.to));
    merged.push(...lines.slice(at, to));
    at = to;
  }
  merged.push(...lines.slice(at));
  return merged.join("\n");
}

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
 * Words typed, and where the editor's comment threads now stand in them,
 * where it reports any: a failed save is tried again with them on the next
 * pause; a conflict still waits; a text past its bound says so and is not
 * sent.
 */
export function editorTyped(
  editor: DocumentEditor,
  draft: string,
  anchors: PlanCommentAnchors | undefined = editor.anchors,
): DocumentEditor {
  const typed = anchors === undefined ? { ...editor, draft } : { ...editor, draft, anchors };
  if (tooLong(draft)) {
    const note = FAILURE_NOTE[PLAN_EDIT_REFUSAL.TOO_LONG];
    return { ...typed, state: { kind: DOCUMENT_EDITOR_STATE.FAILED, note } };
  }
  if (editor.state.kind === DOCUMENT_EDITOR_STATE.FAILED) {
    return { ...typed, state: { kind: DOCUMENT_EDITOR_STATE.EDITING } };
  }
  return typed;
}

/**
 * The save to make now, or nothing: nothing while a save is out, a conflict
 * waits on the developer, or a failed save waits to be tried again, and
 * nothing where the words already are what the service holds of theirs.
 */
export function pendingSave(editor: DocumentEditor): PlanEditRequest | undefined {
  if (editor.sending !== undefined) return undefined;
  if (editor.state.kind !== DOCUMENT_EDITOR_STATE.EDITING) return undefined;
  const { base, draft, anchors } = editor;
  if (draft === base || tooLong(draft)) return undefined;
  const document = { base, value: draft };
  return anchors === undefined ? { document } : { document, comments: anchors };
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
    const { by } = answer.conflict;
    const kind = DOCUMENT_EDITOR_STATE.CONFLICT;
    return { ...rest, state: by === undefined ? { kind, current } : { kind, current, by } };
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

/** The save to make as the editor's task is left: a failed save is tried once more, and a conflict still waits on the developer. */
export function leavingSave(editor: DocumentEditor): PlanEditRequest | undefined {
  return pendingSave(editorRetried(editor));
}

/** What of an editor outlives its task being left: its words where the service does not hold them, with nothing out and nothing closing; nothing where it does. */
export function editorLeft(editor: DocumentEditor): DocumentEditor | undefined {
  if (editor.draft === editor.base) return undefined;
  const { sending: _sent, ...rest } = editor;
  return { ...rest, closing: false };
}

/**
 * The developer keeps their words over the other writer's: their change is
 * laid over what the text holds now, which becomes the base, so the next save
 * sets their words where the two changed the same lines and leaves the other
 * writer's standing everywhere else. Note that the comment anchors the editor
 * last reported are dropped where the words moved, since they stand in the
 * developer's words alone; the service carries every thread over the save
 * until the editor reports them again.
 */
export function editorKeptMine(editor: DocumentEditor): DocumentEditor {
  if (editor.state.kind !== DOCUMENT_EDITOR_STATE.CONFLICT) return editor;
  const base = editor.state.current;
  const draft = keptOver(editor.base, editor.draft, base);
  const { anchors: _anchors, ...rest } = editor;
  const kept = draft === editor.draft ? editor : rest;
  // Note that two changes each within the bound may merge past it, which says so and holds the editor open.
  return editorTyped({ ...kept, base, state: { kind: DOCUMENT_EDITOR_STATE.EDITING } }, draft);
}

/** The developer takes the other writer's words: the editor holds them and closes, with nothing to save. */
export function editorTookTheirs(editor: DocumentEditor): DocumentEditor {
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
