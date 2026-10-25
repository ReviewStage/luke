import { useAtom, useAtomValue } from "@effect/atom-react";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import type { PlanCommentAnchors } from "@luke/features/plan-comment-wire";
import type { PlanEditRequest } from "@luke/features/plan-edit";
import {
  DOCUMENT_EDITOR_STATE,
  type DocumentEditor,
  editorAnswered,
  editorCloseAsked,
  editorCloses,
  editorKeptMine,
  editorLeft,
  editorOpened,
  editorRebased,
  editorRefused,
  editorRetried,
  editorSent,
  editorTookTheirs,
  editorTyped,
  leavingSave,
  pendingSave,
} from "@luke/features/plan-edit-model";
import type { TasksEditAnswer } from "@luke/features/tasks-view";
import { STATUS_TONE } from "@luke/ui";
import { Duration, Effect } from "effect";
import { AsyncResult } from "effect/reactivity";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { PlanEditorPlacement } from "../plan-editor/contract.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { useSteadyDoor } from "../steady-door.js";
import { type ToastNotice, useToast, useWithdrawToast } from "../toast.js";
import { type ConflictWords, conflictWords, type EditPlace } from "./edit-ref.js";

/**
 * use-plan-editing.ts -- the open task's one editor: whether its text is open, which block the keyboard stands on, and its saves as the developer pauses.
 *
 * The words save a beat after the developer stops typing and again as the
 * editor closes, and the editor waits for that save before it goes
 * (`plan-edit-model.ts` decides every save), and each save the service
 * answers saved moves `saves`, which the byline's Saved tick confirms.
 * Another task opening takes the
 * editor with it, and words not yet saved go to the task they were typed in.
 * Words that save refused, or that wait on a conflict, are kept rather than
 * lost: a toast that stands until it is dismissed says so, its action saving
 * them through that task's door, and coming back to the task opens the
 * editor on them again. Unsaved words live in this window's memory alone and
 * are never written to disk. The editor itself is `plan-document-editor.tsx`.
 */

/** How long the developer pauses before what they typed is saved. */
const SAVE_PAUSE = Duration.seconds(1);

/** The pause before a save, as an atom whose work is the wait; setting it again starts the wait over. */
const savePauseAtom = rendererRuntime.fn((stamp: number) =>
  Effect.as(Effect.sleep(SAVE_PAUSE), stamp),
);

/** How the document saves an edit: what the words were written from, and the developer's. */
export type PlanEditDoor = (request: PlanEditRequest) => Promise<TasksEditAnswer>;

/** The words each task was left with that did not save, by the task's id, until they save or the developer comes back to them. */
const leftUnsavedAtom = Atom.keepAlive(Atom.make<ReadonlyMap<string, DocumentEditor>>(new Map()));

/** The tasks whose open editor holds words the service does not hold yet, while it does. */
const openUnsavedAtom = Atom.keepAlive(Atom.make<readonly string[]>([]));

/** Each leaving save still out, one mark apiece, so a task left twice stays marked until both answer. */
const savingLeftAtom = Atom.keepAlive(Atom.make<readonly symbol[]>([]));

/** The titles being typed in, each by its own id, from the first word typed until the rename it asks for answers. */
const titlesUnsavedAtom = Atom.keepAlive(Atom.make<readonly string[]>([]));

/** Whether any plan holds words not saved: an editor open on them, a task left with them, or a title typed in. */
const planWordsUnsavedAtom = Atom.make(
  (get) =>
    get(openUnsavedAtom).length > 0 ||
    get(savingLeftAtom).length > 0 ||
    get(leftUnsavedAtom).size > 0 ||
    get(titlesUnsavedAtom).length > 0,
);

/** `key` marked in `marks` as holding words not saved, or not. */
function mark<Key>(
  registry: AtomRegistry.AtomRegistry,
  marks: Atom.Writable<readonly Key[]>,
  key: Key,
  unsaved: boolean,
): void {
  const others = registry.get(marks).filter((held) => held !== key);
  registry.set(marks, unsaved ? [...others, key] : others);
}

/** What the toast over words a task was left with says, and its action, by whether they wait on a conflict. */
const LEFT_UNSAVED = {
  WORDS: "Your plan edits could not be saved.",
  RETRY: "Retry",
  KEEP_MINE: "Keep mine",
} as const;

/** What a task's words are saved through once it is left: its id, its door, who its conflict is named for, and where they are kept and said. */
interface LeftTask {
  readonly taskId: string;
  readonly door: PlanEditDoor;
  readonly place: EditPlace;
  readonly registry: AtomRegistry.AtomRegistry;
  readonly toast: (notice: ToastNotice) => void;
}

/** The words left unsaved in `taskId` taken back, so nothing else saves them. */
function takeLeft(registry: AtomRegistry.AtomRegistry, taskId: string): DocumentEditor | undefined {
  const held = registry.get(leftUnsavedAtom);
  const kept = held.get(taskId);
  if (kept === undefined) return undefined;
  const rest = new Map(held);
  rest.delete(taskId);
  registry.set(leftUnsavedAtom, rest);
  return kept;
}

/**
 * The editor as its task was left, kept where its words still did not save,
 * and said in a toast that stands until dismissed, whose action saves them
 * again from what is kept then: a Retry, or a Keep mine over a conflict.
 */
function keepLeft(left: LeftTask, now: DocumentEditor, saving: symbol): void {
  const { taskId, registry } = left;
  const kept = editorLeft(now);
  const held = new Map(registry.get(leftUnsavedAtom));
  if (kept === undefined) held.delete(taskId);
  else held.set(taskId, kept);
  registry.set(leftUnsavedAtom, held);
  mark(registry, savingLeftAtom, saving, false);
  if (kept === undefined) return;
  const { state } = kept;
  const conflict = state.kind === DOCUMENT_EDITOR_STATE.CONFLICT;
  const press = () => {
    const standing = takeLeft(registry, taskId);
    if (standing !== undefined) saveLeft(left, editorKeptMine(standing));
  };
  left.toast({
    words: LEFT_UNSAVED.WORDS,
    ...(conflict ? { detail: conflictWords(state.by, left.place).note } : {}),
    tone: STATUS_TONE.DANGER,
    subject: taskId,
    persists: true,
    action: { label: conflict ? LEFT_UNSAVED.KEEP_MINE : LEFT_UNSAVED.RETRY, onPress: press },
  });
}

/**
 * Saves the words of a task left through its door, keeping them where that
 * save does not land; they are unsaved work under `saving`, its own mark,
 * until it answers.
 */
function saveLeft(left: LeftTask, now: DocumentEditor, saving = Symbol(left.taskId)): void {
  mark(left.registry, savingLeftAtom, saving, true);
  const request = leavingSave(now);
  if (request === undefined) {
    keepLeft(left, now, saving);
    return;
  }
  const sent = editorSent(now, request);
  left.door(request).then(
    (answered) => keepLeft(left, editorAnswered(sent, answered), saving),
    (refused: Error) => keepLeft(left, editorRefused(sent, refused.message), saving),
  );
}

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
  /** Words typed, and where the editor's comment threads stand in them, where it carries any. */
  readonly typeText: (text: string, anchors?: PlanCommentAnchors) => void;
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
  /** The open editor came to hold words it has not handed over yet, which are unsaved until they are. */
  readonly holdingWords: () => void;
  /** The base and words once the open editor has taken Luke's part of a save's merged answer. */
  readonly rebase: (base: string, text: string) => void;
  readonly keepMine: () => void;
  readonly takeTheirs: () => void;
  /** What a standing conflict says, naming who wrote the text it met; none while there is none. */
  readonly conflict: ConflictWords | undefined;
  readonly retry: () => void;
  /** How many of this task's saves the service answered saved, which a Saved tick confirms each of. */
  readonly saves: number;
}

/**
 * Whether any plan holds words the service does not: typed and not yet
 * saved, a save still out, or words a task was left with that its save
 * refused. A shell asks before a way out of Luke while they stand, since
 * no way out of the app saves them.
 */
export function usePlanWordsUnsaved(): boolean {
  return useAtomValue(planWordsUnsavedAtom);
}

/**
 * Marks a title's words as unsaved work, or not, for as long as the title
 * stands and after: words typed stay unsaved until the rename they ask for
 * answers, which may be after the title has gone.
 */
export function useMarkTitleUnsaved(): (unsaved: boolean) => void {
  const registry = useContext(RegistryContext);
  const key = useId();
  return useCallback(
    (unsaved: boolean) => mark(registry, titlesUnsavedAtom, key, unsaved),
    [registry, key],
  );
}

/**
 * The door a task's plan saves through, bound to that task's id and steady
 * across its draws. Note that a door calling the newest `edit` with the id
 * open now would send the words a task was left with, which save after it is
 * left, to the task opened since.
 */
export function usePlanEditDoor(
  taskId: string | undefined,
  edit: (taskId: string, request: PlanEditRequest) => Promise<TasksEditAnswer>,
): PlanEditDoor | undefined {
  const save = useSteadyDoor(edit);
  return useMemo(
    () => (taskId === undefined ? undefined : (request: PlanEditRequest) => save(taskId, request)),
    [taskId, save],
  );
}

/**
 * The editor over the open plan's text as `text` holds it; none can open
 * without one, and a conflict names its writer for the reader `place`
 * holds. Note that a save's answer lands only on the editor it was sent
 * from: each opening is counted, and an answer for an earlier one is
 * dropped.
 */
export function usePlanEditing(
  taskId: string,
  text: string | undefined,
  edit: PlanEditDoor,
  place: EditPlace,
): PlanEditing {
  const [editor, setEditor] = useState<DocumentEditor | undefined>(undefined);
  const [placement, setPlacement] = useState<PlanEditorPlacement | undefined>(undefined);
  const [selecting, setSelecting] = useState<EditorHost | undefined>(undefined);
  const [cursor, setCursor] = useState<EditorHost | undefined>(undefined);
  const [saves, setSaves] = useState(0);
  // Whether the open editor holds words typed since its last hand-over.
  const [holding, setHolding] = useState(false);
  const registry = useContext(RegistryContext);
  const toast = useToast();
  const withdrawToast = useWithdrawToast();
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
  const drawnPlace = useRef(place);
  useEffect(() => {
    door.current = edit;
    drawnPlace.current = place;
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
      (answered) => {
        landed((now) => editorAnswered(now, answered));
        if ("saved" in answered && opening.current === sentFrom) setSaves((count) => count + 1);
      },
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

  // Words the service does not hold yet are marked for as long as they stand
  // open here; once the task is left, the words kept in its place say so.
  const unsaved = editor !== undefined && (holding || editor.draft !== editor.base);
  useEffect(() => {
    if (!unsaved) return;
    mark(registry, openUnsavedAtom, taskId, true);
    return () => mark(registry, openUnsavedAtom, taskId, false);
  }, [registry, taskId, unsaved]);

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
  // holds that task's door and runs before the document can go. A task
  // opening that was left with words unsaved opens its editor on them.
  useEffect(() => {
    opening.current += 1;
    const kept = text === undefined ? undefined : takeLeft(registry, taskId);
    if (kept !== undefined) withdrawToast(taskId);
    latest.current = kept;
    setEditor(kept);
    setSelecting(undefined);
    setCursor(undefined);
    return () => {
      heldWords.current?.();
      const held = latest.current;
      if (held === undefined) return;
      const left: LeftTask = {
        taskId,
        door: door.current,
        place: drawnPlace.current,
        registry,
        toast,
      };
      if (held.sending === undefined) {
        saveLeft(left, held);
        return;
      }
      // Note that words typed while a save was out go once it lands, from
      // what it saved, and are unsaved work while they wait on it.
      const saving = Symbol(taskId);
      mark(registry, savingLeftAtom, saving, true);
      flight.current?.then(
        (answered) => saveLeft(left, editorAnswered(held, answered), saving),
        (refused: Error) => saveLeft(left, editorRefused(held, refused.message), saving),
      );
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
    typeText: (words, anchors) => {
      setHolding(false);
      changed((now) => editorTyped(now, words, anchors));
    },
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
      if (handOver === undefined) setHolding(false);
    },
    holdingWords: () => setHolding(true),
    rebase: (base, words) => {
      if (latest.current === undefined) return;
      latest.current = editorRebased(latest.current, base, words);
      setEditor(latest.current);
    },
    keepMine: () => changed(editorKeptMine),
    takeTheirs: () => setEditor((now) => (now === undefined ? now : editorTookTheirs(now))),
    conflict:
      editor?.state.kind === DOCUMENT_EDITOR_STATE.CONFLICT
        ? conflictWords(editor.state.by, place)
        : undefined,
    retry: () => {
      if (latest.current === undefined) return;
      latest.current = editorRetried(latest.current);
      send();
    },
    saves,
  };
}
