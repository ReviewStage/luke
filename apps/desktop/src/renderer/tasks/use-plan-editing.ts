import { useAtom } from "@effect/atom-react";
import type { PlanEditRequest } from "@luke/features/plan-edit";
import {
  type DocumentEditor,
  editorAnswered,
  editorCloseAsked,
  editorCloses,
  editorKeptMine,
  editorOpened,
  editorRebased,
  editorRefused,
  editorRetried,
  editorSent,
  editorTookLukes,
  editorTyped,
  pendingSave,
} from "@luke/features/plan-edit-model";
import type { TasksEditAnswer } from "@luke/features/tasks-view";
import { rendererRuntime } from "@luke/panel/renderer-runtime";
import { Duration, Effect } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";
import type { PlanEditorPlacement } from "../plan-editor/contract";

/**
 * use-plan-editing.ts -- the open task's one editor: whether its text is open, which block the keyboard stands on, and its saves as the developer pauses.
 *
 * The words save a beat after the developer stops typing and again as the
 * editor closes, and the editor waits for that save before it goes
 * (`plan-edit-model.ts` decides every save). Another task opening takes the
 * editor with it, and words not yet saved go to the task they were typed in.
 * Unsaved words live in this window's memory alone and are never written to
 * disk. The editor itself is `plan-document-editor.tsx`.
 */

/** How long the developer pauses before what they typed is saved. */
const SAVE_PAUSE = Duration.seconds(1);

/** The pause before a save, as an atom whose work is the wait; setting it again starts the wait over. */
const savePauseAtom = rendererRuntime.fn((stamp: number) =>
  Effect.as(Effect.sleep(SAVE_PAUSE), stamp),
);

/** A save that failed as a task was left, which nothing is left to say to. */
const ignore = () => undefined;

/** How the document saves an edit: what the words were written from, and the developer's. */
export type PlanEditDoor = (request: PlanEditRequest) => Promise<TasksEditAnswer>;

/** The blocks of the document that are no section of its text. */
export const EDITOR_PLACE = {
  /** The title over the text: a block the keyboard selects. */
  TITLE: "title",
} as const;

/** A block of the document the keyboard selects: a section, by its unit's id, or the title. */
export type EditorHost = number | typeof EDITOR_PLACE.TITLE;

/** The document's one editor, the block the keyboard stands on, and their doors. */
export interface PlanEditing {
  readonly editor: DocumentEditor | undefined;
  /** Where the editor's caret went as it opened; the start of the text without one. */
  readonly placement: PlanEditorPlacement | undefined;
  readonly open: (placement?: PlanEditorPlacement) => void;
  readonly typeText: (text: string) => void;
  /** Ends the edit; `select` is the block the keyboard goes back to once the editor has gone. */
  readonly close: (select?: EditorHost) => void;
  /** The block to take the keyboard back once the editor has gone, until it has. */
  readonly selecting: EditorHost | undefined;
  readonly selected: () => void;
  /** The block the keyboard last selected, which is the document's one Tab stop. */
  readonly cursor: EditorHost | undefined;
  readonly select: (host: EditorHost) => void;
  /** An open editor's way to hand over words it still holds, which the document calls before it saves what is left; none once it goes. */
  readonly holdWords: (handOver: (() => void) | undefined) => void;
  /** The base and words once the open editor has taken Luke's part of a save's merged answer. */
  readonly rebase: (base: string, text: string) => void;
  readonly keepMine: () => void;
  readonly takeLukes: () => void;
  readonly retry: () => void;
}

/**
 * The editor over the open plan's text as `text` holds it; none can open
 * without one. Note that a save's answer lands only on the editor it was
 * sent from: each opening is counted, and an answer for an earlier one is
 * dropped.
 */
export function usePlanEditing(
  taskId: string,
  text: string | undefined,
  edit: PlanEditDoor,
): PlanEditing {
  const [editor, setEditor] = useState<DocumentEditor | undefined>(undefined);
  const [placement, setPlacement] = useState<PlanEditorPlacement | undefined>(undefined);
  const [selecting, setSelecting] = useState<EditorHost | undefined>(undefined);
  const [cursor, setCursor] = useState<EditorHost | undefined>(undefined);
  // The open editor's words not yet handed over, which a task leaving must save too.
  const heldWords = useRef<(() => void) | undefined>(undefined);
  const [pause, restartPause] = useAtom(savePauseAtom);
  // Note that these are refs, because a save's answer and the pause's end
  // read them as they land, which no render stands between.
  const latest = useRef(editor);
  latest.current = editor;
  const stamp = useRef(0);
  const opening = useRef(0);
  // The save out, which words typed after it wait on as a task is left.
  const flight = useRef<Promise<TasksEditAnswer> | undefined>(undefined);
  // The door of the task last drawn, moved on after each commit, so a
  // cleanup as another task opens still holds the door of the one it leaves.
  const door = useRef(edit);
  useEffect(() => {
    door.current = edit;
  });

  // Note that the save out is reserved on the ref before anything renders,
  // so a pause and a close landing in one flush start one save, not two.
  const send = () => {
    const held = latest.current;
    if (held === undefined) return;
    const request = pendingSave(held);
    if (request === undefined) return;
    const sentFrom = opening.current;
    const landed = (next: (now: DocumentEditor) => DocumentEditor) =>
      setEditor((now) => (now !== undefined && opening.current === sentFrom ? next(now) : now));
    latest.current = editorSent(held, request);
    setEditor(latest.current);
    flight.current = door.current(request);
    flight.current.then(
      (answered) => landed((now) => editorAnswered(now, answered)),
      (refused: Error) => landed((now) => editorRefused(now, refused.message)),
    );
  };

  /** The words changed: the editor holds them, and the pause before their save starts over. */
  // Note that the ref moves with the words, so a close in the same tick as an
  // editor's last hand-over saves those words rather than the ones before.
  const changed = (next: (now: DocumentEditor) => DocumentEditor) => {
    if (latest.current === undefined) return;
    latest.current = next(latest.current);
    setEditor(latest.current);
    stamp.current += 1;
    restartPause(stamp.current);
  };

  // A pause that ran out on the newest keystroke saves what stands.
  useEffect(() => {
    if (AsyncResult.isSuccess(pause) && !pause.waiting && pause.value === stamp.current) send();
  });

  // An editor asked to close saves what is left, then goes once nothing is.
  useEffect(() => {
    if (editor === undefined || !editor.closing) return;
    if (editorCloses(editor)) setEditor(undefined);
    else send();
  });

  // Another task opened, or the document gone, takes the editor with it, and
  // words not yet saved are sent through the door of the task they were
  // typed in. Note that the cleanup is what sends them, because it still
  // holds that task's door and runs before the document can go.
  useEffect(() => {
    opening.current += 1;
    setEditor(undefined);
    setSelecting(undefined);
    setCursor(undefined);
    return () => {
      heldWords.current?.();
      const held = latest.current;
      const leaving = door.current;
      const rest = (now: DocumentEditor) => {
        const request = pendingSave(now);
        if (request !== undefined) leaving(request).catch(ignore);
      };
      if (held === undefined) return;
      if (held.sending === undefined) rest(held);
      // Note that words typed while a save was out go once it lands, from what it saved.
      else flight.current?.then((answered) => rest(editorAnswered(held, answered)), ignore);
    };
  }, [taskId]);

  return {
    editor,
    placement,
    open: (place) => {
      if (text === undefined) return;
      if (editor !== undefined && !editorCloses(editorCloseAsked(editor))) return;
      opening.current += 1;
      setEditor(editorOpened(text));
      setPlacement(place);
      setSelecting(undefined);
    },
    typeText: (words) => changed((now) => editorTyped(now, words)),
    // The save starts with the close, not a render later, since the close may
    // be focus leaving for another task that takes the document with it.
    close: (select) => {
      if (latest.current === undefined) return;
      if (select !== undefined) setSelecting(select);
      latest.current = editorCloseAsked(latest.current);
      setEditor(latest.current);
      send();
    },
    selecting,
    selected: () => setSelecting(undefined),
    cursor,
    select: setCursor,
    holdWords: (handOver) => {
      heldWords.current = handOver;
    },
    rebase: (base, words) => {
      if (latest.current === undefined) return;
      latest.current = editorRebased(latest.current, base, words);
      setEditor(latest.current);
    },
    keepMine: () => changed(editorKeptMine),
    takeLukes: () => setEditor((now) => (now === undefined ? now : editorTookLukes(now))),
    retry: () => {
      if (latest.current === undefined) return;
      latest.current = editorRetried(latest.current);
      send();
    },
  };
}
