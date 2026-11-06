import { diffArrays } from "diff";
import { Schema } from "effect";
import type { DescriptionCommentAnchors } from "./description-comment-wire.js";
import {
  DESCRIPTION_EDIT_REFUSAL,
  type DescriptionEditRequest,
  type DescriptionEditValue,
} from "./description-edit.js";
import { type DescriptionLastEdit, TASK_BOUNDS } from "./task-wire.js";
import { TASK_CALL_FAILURE, type TasksEditAnswer, type TasksEditFailure } from "./tasks-view.js";

export const DOCUMENT_EDITOR_STATE = {
  EDITING: "editing",
  CONFLICT: "conflict",
  FAILED: "failed",
} as const;

type DocumentEditorState =
  | { readonly kind: typeof DOCUMENT_EDITOR_STATE.EDITING }
  | {
      readonly kind: typeof DOCUMENT_EDITOR_STATE.CONFLICT;
      readonly current: string;
      readonly by?: DescriptionLastEdit;
    }
  | { readonly kind: typeof DOCUMENT_EDITOR_STATE.FAILED; readonly note: string };

export interface DocumentEditor {
  readonly draft: string;
  readonly anchors?: DescriptionCommentAnchors;
  readonly base: string;
  readonly sending?: DescriptionEditRequest;
  readonly state: DocumentEditorState;
  readonly closing: boolean;
}

const FAILURE_NOTE = {
  [TASK_CALL_FAILURE.UNANSWERED]: "Not saved: the service did not answer.",
  [TASK_CALL_FAILURE.NOT_FOUND]: "Not saved: this task no longer exists.",
  [DESCRIPTION_EDIT_REFUSAL.TOO_LONG]: "Not saved: the description is too long.",
} as const satisfies Record<TasksEditFailure, string>;

function tooLong(text: string): boolean {
  return text.length > TASK_BOUNDS.MAX_BODY_CHARS;
}

const isText = Schema.is(Schema.String);

interface LineChange {
  readonly from: number;
  readonly to: number;
  readonly lines: readonly string[];
  readonly mine: boolean;
}

function lineChanges(base: string[], text: string, mine: boolean): LineChange[] {
  const changes: LineChange[] = [];
  let at = 0;
  for (const part of diffArrays(base, text.split("\n"))) {
    const last = changes.at(-1);
    const changed = part.added || part.removed;
    const joins = changed && last !== undefined && last.to === at;
    if (joins) changes.pop();
    const change = joins ? last : { from: at, to: at, lines: [], mine };
    if (part.added) changes.push({ ...change, lines: [...change.lines, ...part.value] });
    if (part.removed) changes.push({ ...change, to: at + part.count });
    if (!part.added) at += part.count;
  }
  return changes;
}

function byPlace(a: LineChange, b: LineChange): number {
  const aWrites = a.from === a.to ? 0 : 1;
  const bWrites = b.from === b.to ? 0 : 1;
  return a.from - b.from || aWrites - bWrites || Number(a.mine) - Number(b.mine);
}

function settledChanges(place: readonly LineChange[]): readonly LineChange[] {
  const mine = place.filter((change) => change.mine);
  const theirs = place.filter((change) => !change.mine);
  if (mine.length === 0 || theirs.length === 0) return place;
  if (!place.every((change) => change.from === change.to)) return mine;
  const same = mine[0]?.lines.join("\n") === theirs[0]?.lines.join("\n");
  return same ? mine : [...theirs, ...mine];
}

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
    const to = Math.max(at, ...place.map((change) => change.to));
    merged.push(...lines.slice(at, to));
    at = to;
  }
  merged.push(...lines.slice(at));
  return merged.join("\n");
}

function currentOr(base: string, current: DescriptionEditValue): string {
  return isText(current) ? current : base;
}

export function editorOpened(text: string): DocumentEditor {
  return {
    draft: text,
    base: text,
    state: { kind: DOCUMENT_EDITOR_STATE.EDITING },
    closing: false,
  };
}

export function editorTyped(
  editor: DocumentEditor,
  draft: string,
  anchors: DescriptionCommentAnchors | undefined = editor.anchors,
): DocumentEditor {
  const typed = anchors === undefined ? { ...editor, draft } : { ...editor, draft, anchors };
  if (tooLong(draft)) {
    const note = FAILURE_NOTE[DESCRIPTION_EDIT_REFUSAL.TOO_LONG];
    return { ...typed, state: { kind: DOCUMENT_EDITOR_STATE.FAILED, note } };
  }
  if (editor.state.kind === DOCUMENT_EDITOR_STATE.FAILED) {
    return { ...typed, state: { kind: DOCUMENT_EDITOR_STATE.EDITING } };
  }
  return typed;
}

export function pendingSave(editor: DocumentEditor): DescriptionEditRequest | undefined {
  if (editor.sending !== undefined) return undefined;
  if (editor.state.kind !== DOCUMENT_EDITOR_STATE.EDITING) return undefined;
  const { base, draft, anchors } = editor;
  if (draft === base || tooLong(draft)) return undefined;
  const document = { base, value: draft };
  return anchors === undefined ? { document } : { document, comments: anchors };
}

export function editorSent(
  editor: DocumentEditor,
  request: DescriptionEditRequest,
): DocumentEditor {
  return { ...editor, sending: request };
}

export function editorAnswered(editor: DocumentEditor, answer: TasksEditAnswer): DocumentEditor {
  const { sending: sent, ...rest } = editor;
  if ("saved" in answer) {
    const base = sent === undefined ? editor.base : sent.document.value;
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

export function editorRefused(editor: DocumentEditor, note: string): DocumentEditor {
  const { sending: _sent, ...rest } = editor;
  return { ...rest, state: { kind: DOCUMENT_EDITOR_STATE.FAILED, note } };
}

export function editorRetried(editor: DocumentEditor): DocumentEditor {
  if (editor.state.kind !== DOCUMENT_EDITOR_STATE.FAILED) return editor;
  return { ...editor, state: { kind: DOCUMENT_EDITOR_STATE.EDITING } };
}

export function leavingSave(editor: DocumentEditor): DescriptionEditRequest | undefined {
  return pendingSave(editorRetried(editor));
}

export function editorLeft(editor: DocumentEditor): DocumentEditor | undefined {
  if (editor.draft === editor.base) return undefined;
  const { sending: _sent, ...rest } = editor;
  return { ...rest, closing: false };
}

export function editorKeptMine(editor: DocumentEditor): DocumentEditor {
  if (editor.state.kind !== DOCUMENT_EDITOR_STATE.CONFLICT) return editor;
  const base = editor.state.current;
  const draft = keptOver(editor.base, editor.draft, base);
  const { anchors: _anchors, ...rest } = editor;
  const kept = draft === editor.draft ? editor : rest;
  return editorTyped({ ...kept, base, state: { kind: DOCUMENT_EDITOR_STATE.EDITING } }, draft);
}

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

export function editorRebased(editor: DocumentEditor, base: string, draft: string): DocumentEditor {
  return { ...editor, draft, base };
}

export function editorCloseAsked(editor: DocumentEditor): DocumentEditor {
  return { ...editor, closing: true };
}

export function editorCloses(editor: DocumentEditor): boolean {
  return (
    editor.closing &&
    editor.sending === undefined &&
    editor.state.kind === DOCUMENT_EDITOR_STATE.EDITING &&
    pendingSave(editor) === undefined
  );
}
