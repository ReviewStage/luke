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

const SAVE_PAUSE = Duration.seconds(1);

const savePauseAtom = rendererRuntime.fn((stamp: number) =>
  Effect.as(Effect.sleep(SAVE_PAUSE), stamp),
);

type LeftSave = (request: DescriptionEditRequest) => Promise<TasksEditAnswer>;

const leftUnsavedAtom = Atom.keepAlive(Atom.make<ReadonlyMap<string, DocumentEditor>>(new Map()));

const wordsOwnerAtom = Atom.keepAlive(Atom.make<SignedInAccount | undefined>(undefined));

const openUnsavedAtom = Atom.keepAlive(Atom.make<readonly string[]>([]));

const savingLeftAtom = Atom.keepAlive(Atom.make<readonly symbol[]>([]));

const titlesUnsavedAtom = Atom.keepAlive(Atom.make<readonly string[]>([]));

const descriptionWordsUnsavedAtom = Atom.make(
  (get) =>
    get(openUnsavedAtom).length > 0 ||
    get(savingLeftAtom).length > 0 ||
    get(leftUnsavedAtom).size > 0 ||
    get(titlesUnsavedAtom).length > 0,
);

function mark<Key>(
  registry: AtomRegistry.AtomRegistry,
  marks: Atom.Writable<readonly Key[]>,
  key: Key,
  unsaved: boolean,
): void {
  const others = registry.get(marks).filter((held) => held !== key);
  registry.set(marks, unsaved ? [...others, key] : others);
}

const LEFT_UNSAVED = {
  WORDS: "Your description edits could not be saved.",
  RETRY: "Retry",
  KEEP_MINE: "Keep mine",
} as const;

interface LeftTask {
  readonly taskId: string;
  readonly owner: SignedInAccount | undefined;
  readonly signedIn: () => SignedInAccount | undefined;
  readonly save: LeftSave;
  readonly place: EditPlace;
  readonly registry: AtomRegistry.AtomRegistry;
  readonly toast: (notice: ToastNotice) => void;
}

function takeLeft(registry: AtomRegistry.AtomRegistry, taskId: string): DocumentEditor | undefined {
  const held = registry.get(leftUnsavedAtom);
  const kept = held.get(taskId);
  if (kept === undefined) return undefined;
  const rest = new Map(held);
  rest.delete(taskId);
  registry.set(leftUnsavedAtom, rest);
  return kept;
}

function failureOf(answered: object): object | undefined {
  return "failure" in answered ? answered : undefined;
}

function keepLeft(left: LeftTask, now: DocumentEditor, saving: symbol, cause?: unknown): void {
  const { taskId, registry } = left;
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

function saveLeft(
  left: LeftTask,
  now: DocumentEditor,
  saving = Symbol(left.taskId),
  cause?: unknown,
): void {
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

export const EDITOR_PLACE = {
  TITLE: "title",
} as const;

export type EditorHost = number | typeof EDITOR_PLACE.TITLE;

export interface DescriptionEditing {
  readonly editor: DocumentEditor | undefined;
  readonly placement: DescriptionEditorPlacement | undefined;
  readonly open: (placement?: DescriptionEditorPlacement) => void;
  readonly typeText: (text: string, anchors?: DescriptionCommentAnchors) => void;
  readonly close: (select?: EditorHost) => void;
  readonly selecting: EditorHost | undefined;
  readonly selected: () => void;
  readonly cursor: EditorHost | undefined;
  readonly select: (host: EditorHost) => void;
  readonly holdWords: (handOver: (() => void) | undefined) => void;
  readonly holdingWords: () => void;
  readonly rebase: (base: string, text: string) => void;
  readonly keepMine: () => void;
  readonly takeTheirs: () => void;
  readonly conflict: ConflictWords | undefined;
  readonly retry: () => void;
  readonly saves: number;
}

export function useDescriptionWordsUnsaved(): boolean {
  return useAtomValue(descriptionWordsUnsavedAtom);
}

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

export function useMarkTitleUnsaved(): (unsaved: boolean) => void {
  const registry = useContext(RegistryContext);
  const key = useId();
  return useCallback(
    (unsaved: boolean) => mark(registry, titlesUnsavedAtom, key, unsaved),
    [registry, key],
  );
}

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
  const [holding, setHolding] = useState(false);
  const registry = useContext(RegistryContext);
  const owner = useQuery({ ...appStateQuery, select: selectSignedIn }).data;
  const signedInNow = () => selectSignedIn(queryClient.getQueryData(appStateQuery.queryKey));
  const wroteAs = useRef(owner);
  const toast = useToast();
  const withdrawToast = useWithdrawToast();
  const heldWords = useRef<(() => void) | undefined>(undefined);
  const [pause, restartPause] = useAtom(savePauseAtom);
  const latest = useRef(editor);
  latest.current = editor;
  const stamp = useRef(0);
  const opening = useRef(0);
  const flight = useRef<Promise<TasksEditAnswer> | undefined>(undefined);
  const writes = useRef(edit);
  const drawnPlace = useRef(place);
  useEffect(() => {
    writes.current = edit;
    drawnPlace.current = place;
  });

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

  const changed = (next: (now: DocumentEditor) => DocumentEditor) => {
    if (latest.current === undefined) return;
    latest.current = next(latest.current);
    setEditor(latest.current);
    stamp.current += 1;
    restartPause(stamp.current);
  };

  const unsaved = editor !== undefined && (holding || editor.draft !== editor.base);
  useEffect(() => {
    if (!unsaved) return;
    mark(registry, openUnsavedAtom, taskId, true);
    return () => mark(registry, openUnsavedAtom, taskId, false);
  }, [registry, taskId, unsaved]);

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

  useEffect(() => {
    if (AsyncResult.isSuccess(pause) && !pause.waiting && pause.value === stamp.current) send();
  });

  useEffect(() => {
    if (editor === undefined || !editor.closing) return;
    if (editorCloses(editor)) setEditor(undefined);
    else send();
  });

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
