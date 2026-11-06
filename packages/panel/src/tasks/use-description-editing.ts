import { useAtom, useAtomValue } from "@effect/atom-react";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import type { DescriptionCommentAnchors } from "@repo/features/description-comment-wire";
import type { DescriptionEditRequest } from "@repo/features/description-edit";
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
} from "@repo/features/description-edit-model";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { TasksEditAnswer } from "@repo/features/tasks-view";
import { STATUS_TONE } from "@repo/ui";
import { MutationObserver, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Duration, Effect } from "effect";
import { AsyncResult } from "effect/reactivity";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { DescriptionEditorPlacement } from "../description-editor/contract.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { type ToastNotice, useToast, useWithdrawToast } from "../toast.js";
import {
  appStateQuery,
  type SignedInAccount,
  sameAccount,
  selectSignedIn,
} from "../use-app-state.js";
import type { DescriptionEditMutation } from "./description-edit-mutation.js";
import { type ConflictWords, conflictWords, type EditPlace } from "./edit-ref.js";

/**
 * use-description-editing.ts -- the open task's one editor: whether its text is open, which block the keyboard stands on, and its saves as the developer pauses.
 *
 * The words save a beat after the developer stops typing and again as the
 * editor closes, and the editor waits for that save before it goes
 * (`description-edit-model.ts` decides every save), and each save the service
 * answers saved moves `saves`, which the byline's Saved tick confirms.
 * Another task opening takes the
 * editor with it, and words not yet saved go to the task they were typed in.
 * Words that save refused, or that wait on a conflict, are kept rather than
 * lost: a toast that stands until it is dismissed says so, its action saving
 * them through that task's door, and coming back to the task opens the
 * editor on them again. Unsaved words live in this window's memory alone and
 * are never written to disk, and are the account's that wrote them: another
 * signing in lets go of them (`useDescriptionWordsOwner`), so no Retry or
 * return saves them as an account that did not write them. The editor itself is `description-document-editor.tsx`.
 */

/** How long the developer pauses before what they typed is saved. */
const SAVE_PAUSE = Duration.seconds(1);

/** The pause before a save, as an atom whose work is the wait; setting it again starts the wait over. */
const savePauseAtom = rendererRuntime.fn((stamp: number) =>
  Effect.as(Effect.sleep(SAVE_PAUSE), stamp),
);

/** How words are saved once their task is left: through a mutation of that task's own, which outlives the editor. */
type LeftSave = (request: DescriptionEditRequest) => Promise<TasksEditAnswer>;

/** The words each task was left with that did not save, by the task's id, until they save or the developer comes back to them. */
const leftUnsavedAtom = Atom.keepAlive(Atom.make<ReadonlyMap<string, DocumentEditor>>(new Map()));

/** The account signed in as the window's owner hook last drew it, whose change lets go of the words tasks were left with. */
const wordsOwnerAtom = Atom.keepAlive(Atom.make<SignedInAccount | undefined>(undefined));

/** The tasks whose open editor holds words the service does not hold yet, while it does. */
const openUnsavedAtom = Atom.keepAlive(Atom.make<readonly string[]>([]));

/** Each leaving save still out, one mark apiece, so a task left twice stays marked until both answer. */
const savingLeftAtom = Atom.keepAlive(Atom.make<readonly symbol[]>([]));

/** The titles being typed in, each by its own id, from the first word typed until the rename it asks for answers. */
const titlesUnsavedAtom = Atom.keepAlive(Atom.make<readonly string[]>([]));

/** Whether any description holds words not saved: an editor open on them, a task left with them, or a title typed in. */
const descriptionWordsUnsavedAtom = Atom.make(
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
  WORDS: "Your description edits could not be saved.",
  RETRY: "Retry",
  KEEP_MINE: "Keep mine",
} as const;

/** What a task's words are saved through once it is left: its id, the account that wrote them and the one signed in as it asks, its save, who its conflict is named for, and where they are kept and said. */
interface LeftTask {
  readonly taskId: string;
  readonly owner: SignedInAccount | undefined;
  readonly signedIn: () => SignedInAccount | undefined;
  readonly save: LeftSave;
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

/** A save's answer where it refused the words, for the toast to report; none where it saved them. */
function failureOf(answered: object): object | undefined {
  return "failure" in answered ? answered : undefined;
}

/**
 * The editor as its task was left, kept where its words still did not save,
 * and said in a toast that stands until dismissed, whose action saves them
 * again from what is kept then: a Retry, or a Keep mine over a conflict.
 * `cause` is the answer or error the last save came to, which the toast
 * reports.
 */
function keepLeft(left: LeftTask, now: DocumentEditor, saving: symbol, cause?: unknown): void {
  const { taskId, registry } = left;
  // Note that a save answered after another account signed in keeps nothing
  // and lets go of nothing kept, because its words are no longer the account's
  // signed in and what is kept for the task now is the next account's.
  if (!sameAccount(left.signedIn(), left.owner)) {
    mark(registry, savingLeftAtom, saving, false);
    return;
  }
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
    // Note that a conflict's detail names who wrote over the section, so it stays masked.
    replayUnmasked: !conflict,
    words: LEFT_UNSAVED.WORDS,
    ...(conflict ? { detail: conflictWords(state.by, left.place).note } : {}),
    tone: STATUS_TONE.DANGER,
    subject: taskId,
    persists: true,
    action: {
      label: conflict ? LEFT_UNSAVED.KEEP_MINE : LEFT_UNSAVED.RETRY,
      replayUnmasked: true,
      onPress: press,
    },
    failure: conflict
      ? {
          surface: FAILURE_SURFACE.DESCRIPTION_SAVE,
          cause: FAILURE_CONDITION.CONFLICT,
          about: { taskId },
          refused: true,
        }
      : {
          surface: FAILURE_SURFACE.DESCRIPTION_SAVE,
          cause: cause ?? FAILURE_CONDITION.NOT_KEPT,
          about: { taskId },
        },
  });
}

/**
 * Saves the words of a task left through its save, keeping them where that
 * save does not land; they are unsaved work under `saving`, its own mark,
 * until it answers. `cause` is what the save before it came to, where one
 * did, kept for the toast where there is nothing to send again.
 */
function saveLeft(
  left: LeftTask,
  now: DocumentEditor,
  saving = Symbol(left.taskId),
  cause?: unknown,
): void {
  // Note that words are never sent once another account has signed in, because they would save as it.
  if (!sameAccount(left.signedIn(), left.owner)) {
    mark(left.registry, savingLeftAtom, saving, false);
    return;
  }
  mark(left.registry, savingLeftAtom, saving, true);
  const request = leavingSave(now);
  if (request === undefined) {
    keepLeft(left, now, saving, cause);
    return;
  }
  const sent = editorSent(now, request);
  left.save(request).then(
    (answered) => keepLeft(left, editorAnswered(sent, answered), saving, failureOf(answered)),
    (refused: Error) => keepLeft(left, editorRefused(sent, refused.message), saving, refused),
  );
}

/** The blocks of the document that are no section of its text. */
export const EDITOR_PLACE = {
  /** The title over the text: a block the keyboard selects. */
  TITLE: "title",
  /** An empty description's one block, its placeholder, which stands where its first section will. */
  EMPTY: "empty",
} as const;

/** A block of the document the keyboard selects: a section, by its unit's id, the title, or an empty description's placeholder. */
export type EditorHost = number | (typeof EDITOR_PLACE)[keyof typeof EDITOR_PLACE];

/** The document's one editor, the block the keyboard stands on, and their doors. */
export interface DescriptionEditing {
  readonly editor: DocumentEditor | undefined;
  /** Where the editor's caret went as it opened; the start of the text without one. */
  readonly placement: DescriptionEditorPlacement | undefined;
  readonly open: (placement?: DescriptionEditorPlacement) => void;
  /** Words typed, and where the editor's comment threads stand in them, where it carries any. */
  readonly typeText: (text: string, anchors?: DescriptionCommentAnchors) => void;
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
  /** The base and words once the open editor has taken the app's part of a save's merged answer. */
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
 * Whether any description holds words the service does not: typed and not yet
 * saved, a save still out, or words a task was left with that its save
 * refused. A shell asks before a way out of the app while they stand, since
 * no way out of the app saves them.
 */
export function useDescriptionWordsUnsaved(): boolean {
  return useAtomValue(descriptionWordsUnsavedAtom);
}

/**
 * Tells the descriptions' words which account is signed in: once another
 * signs in, the words its tasks were left with go, and the toasts over them,
 * because they are the words of the account that wrote them and a Retry or a
 * return would save them as the next. The window calls it once; it reads
 * the account from main's document.
 */
export function useDescriptionWordsOwner(): void {
  const account = useQuery({ ...appStateQuery, select: selectSignedIn }).data;
  const registry = useContext(RegistryContext);
  const withdrawToast = useWithdrawToast();
  useLayoutEffect(() => {
    const held = registry.get(wordsOwnerAtom);
    registry.set(wordsOwnerAtom, account);
    if (sameAccount(held, account)) return;
    for (const taskId of registry.get(leftUnsavedAtom).keys()) withdrawToast(taskId);
    registry.set(leftUnsavedAtom, new Map());
  }, [registry, withdrawToast, account]);
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
 * The editor over the open description's text as `text` holds it; none can open
 * without one, and a conflict names its writer for the reader `place`
 * holds. Note that a save's answer lands only on the editor it was sent
 * from: each opening is counted, and an answer for an earlier one is
 * dropped.
 */
export function useDescriptionEditing(
  taskId: string,
  text: string | undefined,
  edit: DescriptionEditMutation,
  place: EditPlace,
): DescriptionEditing {
  const queryClient = useQueryClient();
  const { mutateAsync: save } = useMutation(edit);
  const [editor, setEditor] = useState<DocumentEditor | undefined>(undefined);
  const [placement, setPlacement] = useState<DescriptionEditorPlacement | undefined>(undefined);
  const [selecting, setSelecting] = useState<EditorHost | undefined>(undefined);
  const [cursor, setCursor] = useState<EditorHost | undefined>(undefined);
  const [saves, setSaves] = useState(0);
  // Whether the open editor holds words typed since its last hand-over.
  const [holding, setHolding] = useState(false);
  const registry = useContext(RegistryContext);
  const owner = useQuery({ ...appStateQuery, select: selectSignedIn }).data;
  // Note that whose words are sent is read from main's document as it stands
  // at the send, never as a render drew it, so no order of draws sends them as another.
  const signedInNow = () => selectSignedIn(queryClient.getQueryData(appStateQuery.queryKey));
  // The account signed in as the open editor opened, whose words it holds.
  const wroteAs = useRef(owner);
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
  // The writes of the task last drawn, moved on after each commit, so a
  // cleanup as another task opens still holds the writes of the one it leaves.
  const writes = useRef(edit);
  const drawnPlace = useRef(place);
  useEffect(() => {
    writes.current = edit;
    drawnPlace.current = place;
  });

  // Note that the save out is reserved on the ref before anything renders,
  // so a pause and a close landing in one flush start one save, not two.
  const send = () => {
    const held = latest.current;
    if (held === undefined || !sameAccount(signedInNow(), wroteAs.current)) return;
    const request = pendingSave(held);
    if (request === undefined) return;
    const sentFrom = opening.current;
    const landed = (next: (now: DocumentEditor) => DocumentEditor) =>
      setEditor((now) => (now !== undefined && opening.current === sentFrom ? next(now) : now));
    latest.current = editorSent(held, request);
    setEditor(latest.current);
    flight.current = save(request);
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

  // Another account signing in closes an editor open on the last one's words,
  // which are never saved as it; a save's answer still out lands on no editor.
  // The same account read anew, its id among it, is what the editor holds.
  useEffect(() => {
    if (sameAccount(wroteAs.current, owner)) {
      wroteAs.current = owner;
      return;
    }
    if (latest.current === undefined) return;
    opening.current += 1;
    latest.current = undefined;
    setEditor(undefined);
    setHolding(false);
  }, [owner]);

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
  // words not yet saved are sent through the writes of the task they were
  // typed in. Note that the cleanup is what sends them, because it still
  // holds that task's writes and runs before the document can go. A task
  // opening that was left with words unsaved opens its editor on them.
  useEffect(() => {
    opening.current += 1;
    const kept = text === undefined ? undefined : takeLeft(registry, taskId);
    if (kept !== undefined) withdrawToast(taskId);
    wroteAs.current = signedInNow();
    latest.current = kept;
    setEditor(kept);
    setSelecting(undefined);
    setCursor(undefined);
    return () => {
      heldWords.current?.();
      const held = latest.current;
      if (held === undefined) return;
      // Note that words left save through a mutation of the task they were typed in, which outlives this editor and runs in that plan's order.
      const leaving = new MutationObserver(queryClient, writes.current);
      const left: LeftTask = {
        taskId,
        owner: wroteAs.current,
        signedIn: signedInNow,
        save: (request) => leaving.mutate(request),
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
        (answered) => saveLeft(left, editorAnswered(held, answered), saving, failureOf(answered)),
        (refused: Error) => saveLeft(left, editorRefused(held, refused.message), saving, refused),
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
      wroteAs.current = signedInNow();
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
