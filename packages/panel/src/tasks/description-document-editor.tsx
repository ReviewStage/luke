import { useAtom, useAtomValue } from "@effect/atom-react";
import { DOCUMENT_EDITOR_STATE, type DocumentEditor } from "@repo/features/description-edit-model";
import { DESCRIPTION_ACTOR, TASK_BOUNDS, type Task } from "@repo/features/task-wire";
import {
  ANNOUNCE,
  Button,
  EDITABLE_BLOCK_KIND,
  EDITABLE_HEADING_LEAVE,
  EDITABLE_TEXT_BLOCK_SELECTOR,
  EditableBlock,
  EditableHeading,
  PageHeader,
  RetryButton,
} from "@repo/ui";
import { markdownClass } from "@repo/ui/markdown-class";
import { openThread, useDescriptionCommentsControl } from "@repo/ui/description-comments";
import { Duration, Effect } from "effect";
import { AsyncResult } from "effect/reactivity";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePrefetchEditorBundle, useSideBundles } from "../bundle-loader.js";
import {
  type EditorAnchor,
  type EditorAnchors,
  PLACEMENT_END,
  DESCRIPTION_PLACEHOLDER,
  type PlacedWords,
  type DescriptionEditorHandle,
  type DescriptionEditorPlacement,
} from "../description-editor/contract.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { useEditorPictures } from "./editor-pictures.js";
import { EDITOR_NOTE_CLASS, MarkdownEditor } from "./markdown-editor.js";
import { type MentionDoors, retargetedMention } from "./mention-chip.js";
import { UNIT_ATTRIBUTED_CLASS } from "./description-unit-look.js";
import { useTaskMentions } from "./task-mentions.js";
import {
  EDITOR_PLACE,
  type EditorHost,
  type DescriptionEditing,
  useMarkTitleUnsaved,
} from "./use-description-editing.js";

export const EDITOR_ROOM_CLASS = "description-document-editor";

const KEEPING_ENDS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

const DRAFT_PAUSE = Duration.millis(150);

const draftPauseAtom = rendererRuntime.fn((stamp: number) =>
  Effect.as(Effect.sleep(DRAFT_PAUSE), stamp),
);

const titlePauseAtom = rendererRuntime.fn((stamp: number) =>
  Effect.as(Effect.sleep(DRAFT_PAUSE), stamp),
);

function pressesWords(target: EventTarget): boolean {
  return !(
    target instanceof Element &&
    target.closest(
      "a, button:not(.ui-picture-tile), input, label, [data-mention-ref], .description-unit-row, .picture-block[data-video] > :not(.picture-caption)",
    ) !== null
  );
}

function pointAt(node: Node, offset: number): Range {
  const range = document.createRange();
  range.setStart(node, offset);
  return range;
}

function rangeAt(x: number, y: number): Range | null {
  const page: Partial<Pick<Document, "caretRangeFromPoint" | "caretPositionFromPoint">> = document;
  if (page.caretRangeFromPoint !== undefined) return page.caretRangeFromPoint(x, y);
  const position = page.caretPositionFromPoint?.(x, y) ?? null;
  return position === null ? null : pointAt(position.offsetNode, position.offset);
}

function lineTop(range: Range, words: Text): number {
  const measured: Partial<Pick<Range, "getClientRects">> = range;
  const box = measured.getClientRects?.()[0];
  return box?.top ?? words.parentElement?.getBoundingClientRect().top ?? 0;
}

function inCode(text: Node): boolean {
  return text.parentElement?.closest("pre") != null;
}

function sectionWordsAt(
  block: HTMLElement,
  section: number,
  range: Range,
): PlacedWords | undefined {
  const words = range.startContainer;
  if (!(words instanceof Text) || !block.contains(words)) return undefined;
  const text = words.data;
  const code = inCode(words);
  let occurrence = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let at = walker.nextNode(); at !== null && at !== words; at = walker.nextNode()) {
    if (at.textContent === text && inCode(at) === code) occurrence += 1;
  }
  return { section, text, occurrence, offset: range.startOffset, code, top: lineTop(range, words) };
}

function opensSection(element: Element | null | undefined): element is HTMLHeadingElement {
  return (
    element instanceof HTMLHeadingElement && (element.tagName === "H1" || element.tagName === "H2")
  );
}

export function documentWordsAt(root: HTMLElement, range: Range): PlacedWords | undefined {
  const words = range.startContainer;
  if (!(words instanceof Text) || !root.contains(words)) return undefined;
  const code = inCode(words);
  let section = 0;
  let occurrence = 0;
  let begun = false;
  let heading: Element | undefined;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let at = walker.nextNode(); at !== null; at = walker.nextNode()) {
    const opens = at.parentElement?.closest("h1, h2");
    if (opensSection(opens) && opens !== heading) {
      heading = opens;
      section += begun ? 1 : 0;
      occurrence = begun ? 0 : occurrence;
    }
    if (at === words) break;
    if ((at.textContent ?? "").trim() !== "") begun = true;
    if (at.textContent === words.data && inCode(at) === code) occurrence += 1;
  }
  return {
    section,
    text: words.data,
    occurrence,
    offset: range.startOffset,
    code,
    top: lineTop(range, words),
  };
}

export function clickPlacement(
  target: EventTarget,
  x: number,
  y: number,
  place: (range: Range) => PlacedWords | undefined,
): DescriptionEditorPlacement | undefined {
  if (!pressesWords(target)) return undefined;
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed) {
    const range = rangeAt(x, y);
    const words = range === null ? undefined : place(range);
    return words === undefined ? { x, y } : { x, y, words };
  }
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  const from = anchorNode === null ? undefined : place(pointAt(anchorNode, anchorOffset));
  const words = focusNode === null ? undefined : place(pointAt(focusNode, focusOffset));
  return from === undefined || words === undefined ? undefined : { x, y, words, from };
}

function drawnWordsTop(body: HTMLElement, words: PlacedWords): number | undefined {
  const block = body.querySelectorAll(EDITABLE_TEXT_BLOCK_SELECTOR)[words.section];
  if (block === undefined) return undefined;
  let seen = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let at = walker.nextNode(); at !== null; at = walker.nextNode()) {
    if (!(at instanceof Text) || at.data !== words.text || inCode(at) !== words.code) continue;
    if (seen === words.occurrence) {
      const range = document.createRange();
      range.setStart(at, Math.min(words.offset, at.data.length));
      return lineTop(range, at);
    }
    seen += 1;
  }
  return undefined;
}

export function useWordsKeptOnClose(
  taskId: string,
  open: boolean,
  body: React.RefObject<HTMLElement | null>,
  scroller: React.RefObject<HTMLElement | null>,
): React.RefObject<PlacedWords | undefined> {
  const closedOn = useRef<PlacedWords | undefined>(undefined);
  const openedOn = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (open) {
      openedOn.current = taskId;
      return;
    }
    const words = closedOn.current;
    closedOn.current = undefined;
    if (words === undefined || openedOn.current !== taskId) return;
    const top = body.current === null ? undefined : drawnWordsTop(body.current, words);
    if (top !== undefined && scroller.current !== null)
      scroller.current.scrollTop += top - words.top;
  }, [open]);
  return closedOn;
}

export interface TextBox {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export function textBoxOf(element: HTMLElement | null): TextBox | undefined {
  const blocks = element?.querySelectorAll(EDITABLE_TEXT_BLOCK_SELECTOR) ?? [];
  const first = blocks[0]?.getBoundingClientRect();
  const last = blocks[blocks.length - 1]?.getBoundingClientRect();
  if (first === undefined || last === undefined) return undefined;
  return { top: first.top, bottom: last.bottom, left: first.left, right: first.right };
}

function scrollRoomOf(element: HTMLElement): HTMLElement | undefined {
  for (let at = element.parentElement; at !== null; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === "auto" || overflowY === "scroll") return at;
  }
  return undefined;
}

function roomPlacement(
  event: MouseEvent,
  box: TextBox | undefined,
): DescriptionEditorPlacement | undefined {
  if (box === undefined || event.clientY > box.bottom) return PLACEMENT_END;
  if (event.clientY < box.top) return undefined;
  const x = Math.min(Math.max(event.clientX, box.left + 1), box.right - 1);
  return { x, y: event.clientY };
}

function landsInRoom(event: MouseEvent, room: HTMLElement, text: HTMLElement): boolean {
  const { target } = event;
  if (event.button !== 0 || !(target instanceof Element) || !target.contains(text)) return false;
  const bar = room.offsetWidth - room.clientWidth - room.clientLeft;
  return target !== room || event.clientX < room.getBoundingClientRect().right - bar;
}

export function useTextRoom({
  text,
  box,
  room,
  open,
  onPlace,
}: {
  text: React.RefObject<HTMLElement | null>;
  box: () => TextBox | undefined;
  open: boolean;
  room?: React.RefObject<HTMLElement | null> | undefined;
  onPlace: ((placement: DescriptionEditorPlacement) => void) | undefined;
}): void {
  const latest = useRef({ box, onPlace, open });
  latest.current = { box, onPlace, open };
  const placing = onPlace !== undefined;
  const [held, setHeld] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (text.current !== held) setHeld(text.current);
  });
  useEffect(() => {
    const column = room?.current ?? (held === null ? undefined : scrollRoomOf(held));
    if (!placing || held === null || column === undefined || column === null) return;
    const placement = (event: MouseEvent) =>
      landsInRoom(event, column, held) ? roomPlacement(event, latest.current.box()) : undefined;
    const selecting = () => {
      const selection = window.getSelection();
      return selection !== null && !selection.isCollapsed;
    };
    let clearing = false;
    const press = (event: MouseEvent) => {
      clearing = selecting();
      if (clearing || !latest.current.open || placement(event) === undefined) return;
      event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      if (clearing || selecting()) return;
      const at = placement(event);
      if (at !== undefined) latest.current.onPlace?.(at);
    };
    column.addEventListener("mousedown", press);
    column.addEventListener("click", click);
    return () => {
      column.removeEventListener("mousedown", press);
      column.removeEventListener("click", click);
    };
  }, [held, room, placing]);
}

function useSelectedOnClose(editing: DescriptionEditing, key: EditorHost, take: () => void): void {
  useEffect(() => {
    if (editing.editor !== undefined || editing.selecting !== key) return;
    take();
    editing.selected();
  });
}

export function DocumentBlock({
  host,
  section,
  label,
  entry,
  editing,
  children,
}: {
  host: EditorHost;
  section: number;
  label: string;
  entry: boolean;
  editing: DescriptionEditing;
  children: ReactNode;
}): React.JSX.Element {
  const block = useRef<HTMLDivElement>(null);
  const prefetchEditorBundle = usePrefetchEditorBundle();
  useSelectedOnClose(editing, host, () => block.current?.focus());
  return (
    <EditableBlock
      ref={block}
      label={label}
      kind={EDITABLE_BLOCK_KIND.TEXT}
      entry={entry}
      onPointerEnter={prefetchEditorBundle}
      onFocus={() => {
        prefetchEditorBundle();
        editing.select(host);
      }}
      onPress={({ target, x, y, block: pressed }) => {
        const placement = clickPlacement(target, x, y, (range) =>
          sectionWordsAt(pressed, section, range),
        );
        if (placement !== undefined) editing.open(placement);
      }}
      onOpen={() => editing.open({ section })}
    >
      {children}
    </EditableBlock>
  );
}

function caretAtEnd(element: HTMLElement): void {
  element.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

function typedName(element: HTMLElement): string {
  return (element.textContent ?? "").trim().slice(0, TASK_BOUNDS.MAX_NAME_CHARS).trim();
}

function boundTitle(element: HTMLElement): void {
  const words = element.textContent ?? "";
  if (words.length <= TASK_BOUNDS.MAX_NAME_CHARS) return;
  element.textContent = words.slice(0, TASK_BOUNDS.MAX_NAME_CHARS);
  caretAtEnd(element);
}

export function EditableTitle({
  name,
  entry,
  editing,
  alone = false,
  renaming = 0,
  actions,
  onRename,
  onDraft,
}: {
  name: string;
  entry: boolean;
  editing: DescriptionEditing;
  alone?: boolean;
  renaming?: number;
  actions?: ReactNode;
  onRename: (name: string) => Promise<boolean>;
  onDraft: (name: string | undefined) => void;
}): React.JSX.Element {
  const block = useRef<HTMLDivElement>(null);
  const prefetchEditorBundle = usePrefetchEditorBundle();
  const text = useRef<HTMLElement>(null);
  const [pause, restartPause] = useAtom(titlePauseAtom);
  const stamp = useRef(0);
  useSelectedOnClose(editing, EDITOR_PLACE.TITLE, () => {
    if (text.current !== null) caretAtEnd(text.current);
  });
  const saved = useRef(true);
  const typed = useRef(false);
  const base = useRef(name);
  const echo = useRef<string | undefined>(undefined);
  const doors = useRef({ onRename, onDraft });
  doors.current = { onRename, onDraft };
  const asking = useRef(0);
  const markUnsaved = useMarkTitleUnsaved();
  const tellUnsaved = () => markUnsaved(typed.current || asking.current > 0);
  const renamed = useRef(renaming);
  useEffect(() => {
    if (renaming === renamed.current || text.current === null) return;
    renamed.current = renaming;
    caretAtEnd(text.current);
  }, [renaming]);
  useLayoutEffect(() => {
    const element = text.current;
    if (element === null || name === echo.current) return;
    base.current = name;
    const typing = element === document.activeElement;
    if (typing && echo.current === undefined) return;
    echo.current = undefined;
    element.textContent = name;
    if (typing) caretAtEnd(element);
  }, [name]);
  const rename = (element: HTMLElement) => {
    typed.current = false;
    const next = typedName(element);
    if (next === "" || next === base.current) {
      tellUnsaved();
      return;
    }
    base.current = next;
    const asked = stamp.current;
    asking.current += 1;
    tellUnsaved();
    doors.current.onRename(next).then((renamed) => {
      asking.current -= 1;
      tellUnsaved();
      if (renamed) return;
      if (stamp.current !== asked) {
        if (base.current === next) base.current = "";
        return;
      }
      if (element === document.activeElement) echo.current = next;
      doors.current.onDraft(undefined);
    });
  };
  const save = (element: HTMLElement) => {
    if (saved.current) return;
    saved.current = true;
    rename(element);
    const next = typedName(element);
    element.textContent = next === "" ? base.current : next;
    echo.current = undefined;
    doors.current.onDraft(undefined);
  };
  useEffect(() => {
    const element = text.current;
    if (element === null || !typed.current || !AsyncResult.isSuccess(pause)) return;
    if (!pause.waiting && pause.value === stamp.current) rename(element);
  });
  useLayoutEffect(() => {
    const element = text.current;
    return () => {
      if (element !== null) save(element);
    };
  }, []);
  return (
    <div className={`task-title ${UNIT_ATTRIBUTED_CLASS} ph-no-capture`}>
      <EditableBlock
        ref={block}
        label="Title"
        kind={EDITABLE_BLOCK_KIND.TITLE}
        entry={entry}
        onPointerEnter={prefetchEditorBundle}
        onFocus={(event) => {
          prefetchEditorBundle();
          if (event.target === event.currentTarget) editing.select(EDITOR_PLACE.TITLE);
        }}
        onOpen={() => {
          if (text.current !== null) caretAtEnd(text.current);
        }}
      >
        <PageHeader
          title={
            <EditableHeading
              ref={text}
              label="Task name"
              onFocus={() => {
                saved.current = false;
              }}
              onInput={(event) => {
                saved.current = false;
                if (!typed.current) {
                  typed.current = true;
                  tellUnsaved();
                }
                boundTitle(event.currentTarget);
                const next = typedName(event.currentTarget);
                echo.current = next === "" ? undefined : next;
                onDraft(echo.current);
                stamp.current += 1;
                restartPause(stamp.current);
              }}
              onBlur={(event) => save(event.currentTarget)}
              onLeave={(way, heading) => {
                save(heading);
                if (way === EDITABLE_HEADING_LEAVE.BACK || alone) block.current?.focus();
                else editing.open();
              }}
            />
          }
          actions={actions}
        />
      </EditableBlock>
    </div>
  );
}

interface DraftDoors {
  readonly onDraft: (markdown: string, anchors?: EditorAnchors) => void;
  readonly onFinish: (section: number) => void;
  readonly onLeave: () => void;
  readonly onLeaveUp: () => void;
}

function useDraftHandOver(
  editing: DescriptionEditing,
  hostOf: (section: number) => EditorHost,
  handed: React.RefObject<string>,
): DraftDoors {
  const [pause, restartPause] = useAtom(draftPauseAtom);
  const pending = useRef<{ markdown: string; anchors: EditorAnchors | undefined } | undefined>(
    undefined,
  );
  const stamp = useRef(0);
  const door = useRef(editing);
  door.current = editing;
  const flush = () => {
    const next = pending.current;
    pending.current = undefined;
    if (next === undefined) return;
    handed.current = next.markdown;
    door.current.typeText(next.markdown, next.anchors);
  };
  useEffect(() => {
    if (AsyncResult.isSuccess(pause) && !pause.waiting && pause.value === stamp.current) flush();
  });
  useLayoutEffect(() => {
    door.current.holdWords(flush);
    return () => {
      door.current.holdWords(undefined);
      flush();
    };
  }, []);
  return {
    onDraft: (markdown, anchors) => {
      if (pending.current === undefined) door.current.holdingWords();
      pending.current = { markdown, anchors };
      stamp.current += 1;
      restartPause(stamp.current);
    },
    onFinish: (section) => {
      flush();
      door.current.close(hostOf(section));
    },
    onLeave: () => {
      flush();
      door.current.close();
    },
    onLeaveUp: () => {
      flush();
      door.current.close(EDITOR_PLACE.TITLE);
    },
  };
}

function useTakenText(
  editor: DocumentEditor,
  editing: DescriptionEditing,
  task: Task,
  handle: React.RefObject<DescriptionEditorHandle | undefined>,
  handed: React.RefObject<string>,
): void {
  const seen = useRef({ base: editor.base, draft: editor.draft, updatedAt: task.updatedAt });
  const landed = useRef<string | undefined>(undefined);
  useEffect(() => {
    const { base, draft, sending, state } = editor;
    const settled = sending === undefined && state.kind === DOCUMENT_EDITOR_STATE.EDITING;
    if (settled && base !== seen.current.base) landed.current = base;
    seen.current.base = base;
    const moved = draft !== seen.current.draft;
    seen.current.draft = draft;
    const mounted = handle.current;
    if (moved && draft !== handed.current) {
      handed.current = mounted === undefined ? draft : mounted.take(handed.current, draft).text;
      return;
    }
    if (task.updatedAt === seen.current.updatedAt) return;
    const sent = landed.current;
    if (sent !== undefined) {
      if (task.lastEdit?.actor !== DESCRIPTION_ACTOR.DEVELOPER) return;
      landed.current = undefined;
      seen.current.updatedAt = task.updatedAt;
      const taken = mounted?.take(sent, task.document.body);
      if (taken === undefined) return;
      seen.current.base = taken.base;
      handed.current = taken.text;
      editing.rebase(taken.base, taken.text);
      return;
    }
    if (!settled || editor.closing || draft !== base) return;
    seen.current.updatedAt = task.updatedAt;
    const theirs = task.document.body;
    if (theirs === base) return;
    const taken =
      mounted === undefined ? { base: theirs, text: theirs } : mounted.take(base, theirs);
    seen.current.base = taken.base;
    handed.current = taken.text;
    editing.rebase(taken.base, taken.text);
  });
}

function sameThreads(a: readonly string[], b: readonly string[]): boolean {
  const named = new Set(a);
  return a.length === b.length && b.every((thread) => named.has(thread));
}

interface HandedThreads {
  readonly editor: DescriptionEditorHandle;
  readonly open: readonly string[];
  readonly anchored: readonly string[];
}

function useAnchorsFollowed(
  handle: React.RefObject<DescriptionEditorHandle | undefined>,
  text: string,
  anchors: readonly EditorAnchor[],
  open: readonly string[],
): void {
  const handed = useRef<HandedThreads | undefined>(undefined);
  useLayoutEffect(() => {
    const editor = handle.current;
    if (editor === undefined) return;
    const anchored = anchors.map((anchor) => anchor.thread);
    const was = handed.current;
    if (
      was !== undefined &&
      was.editor === editor &&
      sameThreads(was.open, open) &&
      sameThreads(was.anchored, anchored)
    ) {
      return;
    }
    handed.current = { editor, open, anchored };
    editor.replaceAnchors(text, anchors, open);
  });
}

function DocumentNote({
  editor,
  editing,
}: {
  editor: DocumentEditor;
  editing: DescriptionEditing;
}): React.JSX.Element | null {
  useAnnounceShown(
    ANNOUNCE.ALERT,
    editing.conflict?.note ??
      (editor.state.kind === DOCUMENT_EDITOR_STATE.FAILED ? editor.state.note : ""),
  );
  if (editing.conflict !== undefined) {
    return (
      <div className={EDITOR_NOTE_CLASS}>
        <span>{editing.conflict.note}</span>
        <Button onClick={editing.keepMine}>Keep mine</Button>
        <Button onClick={editing.takeTheirs}>{editing.conflict.take}</Button>
      </div>
    );
  }
  if (editor.state.kind === DOCUMENT_EDITOR_STATE.FAILED) {
    return (
      <div className={EDITOR_NOTE_CLASS}>
        <span>{editor.state.note}</span>
        <RetryButton onRetry={editing.retry} />
      </div>
    );
  }
  return null;
}

export function DescriptionDocumentEditor({
  task,
  editor,
  editing,
  drawn,
  hostOf,
  mentions,
  scroller,
  handle,
  closedOn,
  onComment,
}: {
  task: Task;
  editor: DocumentEditor;
  editing: DescriptionEditing;
  drawn: ReactNode;
  hostOf: (section: number) => EditorHost;
  mentions?: MentionDoors | undefined;
  scroller?: React.RefObject<HTMLElement | null> | undefined;
  handle: React.RefObject<DescriptionEditorHandle | undefined>;
  closedOn?: React.RefObject<PlacedWords | undefined> | undefined;
  onComment?: (() => void) | undefined;
}): React.JSX.Element {
  const handed = useRef(editor.draft);
  const doors = useDraftHandOver(editing, hostOf, handed);
  useLayoutEffect(
    () => () => {
      if (closedOn !== undefined) closedOn.current = handle.current?.caretWords();
    },
    [],
  );
  const comments = useDescriptionCommentsControl();
  const openThreads = comments === undefined ? [] : comments.threads.filter(openThread);
  const openAnchors = openThreads.flatMap((thread) =>
    thread.anchor === undefined ? [] : [{ thread: thread.id, ...thread.anchor }],
  );
  const commentAnchors =
    openAnchors.length === 0 || editor.draft !== task.document.body ? undefined : openAnchors;
  useTakenText(editor, editing, task, handle, handed);
  useAnchorsFollowed(
    handle,
    task.document.body,
    openAnchors,
    openThreads.map((thread) => thread.id),
  );
  const ready = AsyncResult.isSuccess(useAtomValue(useSideBundles().descriptionEditor));
  const room = useRef<HTMLElement>(null);
  const pictures = useEditorPictures(task.id, mentions?.place.workspace, handle);
  const [pending, setPending] = useState<DescriptionEditorPlacement | undefined>(undefined);
  useTextRoom({
    text: room,
    box: () => room.current?.getBoundingClientRect(),
    room: scroller,
    open: true,
    onPlace: (placement) => {
      if (handle.current === undefined) setPending(placement);
      else handle.current.focusAt(placement);
    },
  });
  useLayoutEffect(() => {
    if (!ready) return;
    const place = pending ?? editing.placement;
    const target = place !== undefined && "words" in place ? place.words?.top : undefined;
    const column = scroller?.current;
    const text = room.current;
    if (target === undefined || column == null || text === null) return;
    const keep = () => {
      const top = handle.current?.wordsTop();
      if (top !== undefined) column.scrollTop += top - target;
    };
    keep();
    const observer = new ResizeObserver(keep);
    observer.observe(text);
    const release = () => {
      observer.disconnect();
      for (const kind of KEEPING_ENDS) column.removeEventListener(kind, release);
    };
    for (const kind of KEEPING_ENDS) column.addEventListener(kind, release, { passive: true });
    return release;
  }, [ready]);
  const page = useTaskMentions();
  return (
    <MarkdownEditor
      markdown={editor.draft}
      label="Description"
      roomLabel="Editing the description"
      placeholder={DESCRIPTION_PLACEHOLDER}
      className={markdownClass("description-unit")}
      roomClassName={EDITOR_ROOM_CLASS}
      onDraft={doors.onDraft}
      onFinish={doors.onFinish}
      onLeave={doors.onLeave}
      handle={handle}
      room={room}
      loading={drawn}
      placement={pending ?? editing.placement}
      onLeaveUp={doors.onLeaveUp}
      mentions={
        mentions === undefined
          ? undefined
          : {
              doors: mentions,
              source: {
                holder: { taskId: task.id },
                taskName: task.name,
                workspace: mentions.place.workspace,
                repository: task.repository,
                pages: page?.pages,
                agents: page?.agents,
                readAgents: page?.readAgents,
                pullRequests: page?.pullRequests,
              },
              retarget: (target, change) =>
                retargetedMention(task.id, mentions.place, target, change),
            }
      }
      pictures={pictures}
      anchors={commentAnchors}
      onComment={onComment}
      diagrams
    >
      <DocumentNote editor={editor} editing={editing} />
    </MarkdownEditor>
  );
}
