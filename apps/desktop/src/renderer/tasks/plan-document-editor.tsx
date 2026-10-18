import { useAtom, useAtomValue } from "@effect/atom-react";
import { decodeMention } from "@luke/features/mention-link";
import {
  CONFLICT_NOTE,
  DOCUMENT_EDITOR_STATE,
  type DocumentEditor,
} from "@luke/features/plan-edit-model";
import { PLAN_ACTOR, TASK_BOUNDS, type Task } from "@luke/features/task-wire";
import {
  type EditorDiagram,
  type MentionNode,
  PLACEMENT_END,
  type PlanEditorHandle,
  type PlanEditorModule,
  type PlanEditorPlacement,
  type PlanEditorProps,
} from "@luke/panel/plan-editor/contract";
import { rendererRuntime } from "@luke/panel/renderer-runtime";
import { useKnownNames } from "@luke/panel/tasks/use-known-names";
import {
  EDITOR_PLACE,
  type EditorHost,
  type PlanEditing,
} from "@luke/panel/tasks/use-plan-editing";
import { Button, PROSE_CLASS } from "@luke/ui";
import { Duration, Effect } from "effect";
import { AsyncResult } from "effect/reactivity";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePrefetchEditorBundle, useSideBundles } from "../bundle-loader";
import { DiagramPreview } from "../plan-diagram";
import { RetryButton } from "../retry-button";
import { useEditorPictures } from "./editor-pictures";
import {
  type MentionDoors,
  MentionNodeChip,
  pastedMentionNode,
  retargetedMention,
} from "./mention-chip";
import { MENTION_MENU_SIDE, useMentionPicker } from "./mention-picker";
import { useTaskMentions } from "./task-mentions";

/**
 * plan-document-editor.tsx -- the open plan, edited in place: its title, its sections as blocks, and its whole text in one editor.
 *
 * The text is drawn as its sections, and nothing on them marks them
 * editable. A click into a section's words opens the whole text in place,
 * the caret where the click landed, and so does a press on the empty room
 * around the text (`useTextRoom`), which an issue's description shares; the
 * editor is TipTap, from the editor
 * bundle the panel starts loading as it first paints, and again the first
 * time a section is hovered or selected (`../bundle-loader.ts`), and draws the words exactly as the
 * sections drew them, so nothing moves. Until the bundle has loaded the
 * sections stay drawn, so a click's point still lands on the same word. The
 * keyboard moves between the title and the sections as a document editor
 * moves between blocks: the document is one Tab stop, at the block selected
 * last; ↑ and ↓ move between blocks; Return edits the selected section with
 * the caret at its end; and Esc in the editor saves and selects the section
 * the caret stood in. The title is edited where it stands (Return or ↓ goes
 * into the text, ↑ on the text's first line comes back to it, Esc saves and
 * selects it) and saved by renaming the task as the typing pauses and as it
 * is left, so the name never enters the text; meanwhile its words are drawn
 * as the task's name wherever the window names it. The words save as the
 * developer pauses (`use-plan-editing.ts`), and the service merges them with
 * what Luke writes.
 * A save's merged answer is taken into the open editor block by block, and
 * the notetaker's drafts never redraw it. A Mermaid code block's diagram is
 * previewed under it, drawn here as the read view draws it
 * (`../plan-diagram.tsx`), so the editor's bundle carries no Mermaid. The editor stands under
 * `ph-no-capture`, and its words are document text, which the recording masks.
 */

/** What every block of a document the keyboard moves between wears: the title, and each section. */
export const DOCUMENT_BLOCK_CLASS = "plan-document-block";

/** What the text says while the editor's bundle could not be loaded. */
export const EDITOR_LOAD_FAILED = "The editor could not be loaded.";

/** How long the typing pauses before the document hears the text. */
const DRAFT_PAUSE = Duration.millis(150);

/** The pause before the text is handed over, as an atom whose work is the wait; setting it again starts the wait over. */
const draftPauseAtom = rendererRuntime.fn((stamp: number) =>
  Effect.as(Effect.sleep(DRAFT_PAUSE), stamp),
);

/** The pause before the title's words are saved, the text's own pause apart, so neither's wait starts the other's over. */
const titlePauseAtom = rendererRuntime.fn((stamp: number) =>
  Effect.as(Effect.sleep(DRAFT_PAUSE), stamp),
);

/** The keyboard moved to the block before or after this one in the document. */
function stepBlock(from: HTMLElement, by: 1 | -1): void {
  const blocks = [...document.querySelectorAll<HTMLElement>(`.${DOCUMENT_BLOCK_CLASS}`)];
  blocks[blocks.indexOf(from) + by]?.focus();
}

/** The arrows move to the next or previous block. */
function steppedByArrow(event: React.KeyboardEvent<HTMLElement>): boolean {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return false;
  event.preventDefault();
  stepBlock(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
  return true;
}

/** Whether a click lands on words to edit: no selection made by the press, and not on a link, a button, a task's checkbox, or the section's byline. */
export function editsOnClick(target: EventTarget): boolean {
  const selection = window.getSelection();
  if (selection !== null && !selection.isCollapsed) return false;
  // Note that a mention's chip is its own, a link's or a folder's that opens nothing alike, and so is the byline's row, whose writer and ⋯ are presses of their own, a button in the words, a diagram's Show code say, and a task's checkbox, which ticks its item.
  return !(
    target instanceof Element &&
    target.closest("a, button, input, [data-mention-ref], .plan-unit-row") !== null
  );
}

/** Where a text's words stand in the window. */
export interface TextBox {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** What every block of a document's text wears, the title's apart, so its room knows where the words stand. */
const TEXT_BLOCK_ATTRIBUTE = "data-text-block";

/** Where the text's blocks under `element` stand together, from the first's top to the last's bottom; none while none is drawn. */
export function textBoxOf(element: HTMLElement | null): TextBox | undefined {
  const blocks = element?.querySelectorAll(`[${TEXT_BLOCK_ATTRIBUTE}]`) ?? [];
  const first = blocks[0]?.getBoundingClientRect();
  const last = blocks[blocks.length - 1]?.getBoundingClientRect();
  if (first === undefined || last === undefined) return undefined;
  return { top: first.top, bottom: last.bottom, left: first.left, right: first.right };
}

/** The scrolling column a text stands in, whose empty room is the text's way in; none outside one. */
function scrollRoomOf(element: HTMLElement): HTMLElement | undefined {
  for (let at = element.parentElement; at !== null; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === "auto" || overflowY === "scroll") return at;
  }
  return undefined;
}

/**
 * Where a press on a text's room puts the caret: at the end where it lands
 * under the text's last line, or no text is drawn; on the nearest line where
 * it lands beside the text; and nowhere where it lands above it, among the
 * lines over the text (a title, a byline, an issue's properties).
 */
function roomPlacement(
  event: MouseEvent,
  box: TextBox | undefined,
): PlanEditorPlacement | undefined {
  if (box === undefined || event.clientY > box.bottom) return PLACEMENT_END;
  if (event.clientY < box.top) return undefined;
  const x = Math.min(Math.max(event.clientX, box.left + 1), box.right - 1);
  return { x, y: event.clientY };
}

/**
 * Whether a press landed on the room around `text` rather than on anything
 * drawn in it: on the text's own box or one holding it, as the column's
 * margins and its scroller are, and not on the scroller's bar.
 */
function landsInRoom(event: MouseEvent, room: HTMLElement, text: HTMLElement): boolean {
  const { target } = event;
  if (event.button !== 0 || !(target instanceof Element) || !target.contains(text)) return false;
  const bar = room.offsetWidth - room.clientWidth - room.clientLeft;
  return target !== room || event.clientX < room.getBoundingClientRect().right - bar;
}

/**
 * A text's empty room as its way in, as a document editor's page is
 * (Notion's, Google Docs'): a press anywhere on the room around the text
 * that lands on nothing drawn there puts the caret in the text, where
 * `roomPlacement` says, through `onPlace`, which opens the editor there
 * while it is closed and moves the caret while it is open. `text` is what
 * holds the text, or the column it would stand in while none is drawn;
 * `box` is where its words stand now. The room is `room` where given, and
 * otherwise the scrolling column around the text. Note that while the
 * editor is `open` the press itself is taken, so focus stays in it, and
 * that a press made with words selected only clears them, as it would
 * anywhere, and one that ends a selection places nothing.
 */
export function useTextRoom({
  text,
  box,
  room,
  open,
  onPlace,
}: {
  text: React.RefObject<HTMLElement | null>;
  box: () => TextBox | undefined;
  /** Whether the editor stands open, whose focus a press on the room keeps. */
  open: boolean;
  room?: React.RefObject<HTMLElement | null> | undefined;
  /** Puts the caret where a press on the room asks; none where the text takes no caret. */
  onPlace: ((placement: PlanEditorPlacement) => void) | undefined;
}): void {
  const latest = useRef({ box, onPlace, open });
  latest.current = { box, onPlace, open };
  const placing = onPlace !== undefined;
  // The text's element as last drawn, which the listeners are put on again once it changes, as an editor's bundle landing changes it.
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
    // Whether the press went down on words selected, which it clears and places nothing for.
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

/** The block an editor closed from by the keyboard takes the keyboard back, once. */
function useSelectedOnClose(editing: PlanEditing, key: EditorHost, take: () => void): void {
  useEffect(() => {
    if (editing.editor !== undefined || editing.selecting !== key) return;
    take();
    editing.selected();
  });
}

/**
 * One section of the text as a block: its drawn words, which a click opens
 * the text at, and the keyboard selects, moves past, or opens at the
 * section's end. A block is a labelled group rather than a button, so a
 * screen reader still reads the words inside it.
 */
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
  /** Whether this block is where Tab enters the document. */
  entry: boolean;
  editing: PlanEditing;
  children: ReactNode;
}): React.JSX.Element {
  const block = useRef<HTMLDivElement>(null);
  const prefetchEditorBundle = usePrefetchEditorBundle();
  useSelectedOnClose(editing, host, () => block.current?.focus());
  // Note that a code block is taken out of the Tab order, because Chrome makes
  // a scrolling `<pre>` a Tab stop of its own inside the document's one.
  useEffect(() => {
    for (const code of block.current?.querySelectorAll("pre") ?? []) code.tabIndex = -1;
  });
  return (
    // biome-ignore lint/a11y/useSemanticElements: a block holds a section's words, not a form's controls, so it is no `<fieldset>`.
    <div
      ref={block}
      className={DOCUMENT_BLOCK_CLASS}
      // Note that the attribute is `TEXT_BLOCK_ATTRIBUTE`, which marks the block as the text's for its room.
      data-text-block=""
      role="group"
      tabIndex={entry ? 0 : -1}
      aria-label={label}
      aria-keyshortcuts="Enter"
      onPointerEnter={prefetchEditorBundle}
      onFocus={() => {
        prefetchEditorBundle();
        editing.select(host);
      }}
      onClick={(event) => {
        // Note that a click on a menu or a card portaled out of the block still
        // bubbles here through React's tree, and opens no editor.
        if (!(event.target instanceof Node && event.currentTarget.contains(event.target))) return;
        if (editsOnClick(event.target)) editing.open({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (steppedByArrow(event)) return;
        if (event.key !== "Enter") return;
        event.preventDefault();
        editing.open({ section });
      }}
    >
      {children}
    </div>
  );
}

/** The caret at the end of an element's words. */
function caretAtEnd(element: HTMLElement): void {
  element.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

/** The title's words as a name: trimmed, and cut to the bound as the name field's own `maxLength` cuts a paste. */
function typedName(element: HTMLElement): string {
  return (element.textContent ?? "").trim().slice(0, TASK_BOUNDS.MAX_NAME_CHARS).trim();
}

/** The title's words held to the bound as they are typed, as the name field's `maxLength` holds its own, so no word stands past what is saved. */
function boundTitle(element: HTMLElement): void {
  const words = element.textContent ?? "";
  if (words.length <= TASK_BOUNDS.MAX_NAME_CHARS) return;
  element.textContent = words.slice(0, TASK_BOUNDS.MAX_NAME_CHARS);
  caretAtEnd(element);
}

/**
 * The title over the text, edited where it stands. A click puts the caret
 * in it; Return or ↓ saves it and goes into the text at its start; Esc saves
 * it and selects it as a block, from which Return comes back into it. Its
 * words are drawn as the task's name everywhere at every keystroke, through
 * `onDraft`, and saved by renaming the task at each pause in the typing and
 * as it is left. A title left empty or unchanged renames nothing, as a
 * rename anywhere else does, and one left empty is drawn as the saved name
 * again. Its words are the name's own but while they are typed, so a
 * refused rename puts the saved name back here and everywhere, unless words
 * were typed since it was asked for, which are the newest and are kept for
 * the next pause to ask for again. Each Rename chosen from the title's ⋯
 * puts the caret at its end, as ↑ from the text's first line does.
 */
export function EditableTitle({
  name,
  entry,
  editing,
  renaming = 0,
  onRename,
  onDraft,
}: {
  name: string;
  /** Whether this block is where Tab enters the document. */
  entry: boolean;
  editing: PlanEditing;
  /** How many times Rename was chosen; each change is an ask of its own. */
  renaming?: number;
  /** Renames the task, answering whether the name was taken. */
  onRename: (name: string) => Promise<boolean>;
  onDraft: (name: string | undefined) => void;
}): React.JSX.Element {
  const block = useRef<HTMLDivElement>(null);
  const prefetchEditorBundle = usePrefetchEditorBundle();
  const text = useRef<HTMLDivElement>(null);
  const [pause, restartPause] = useAtom(titlePauseAtom);
  const stamp = useRef(0);
  // ↑ on the text's first line comes back into the title, its caret at the end.
  useSelectedOnClose(editing, EDITOR_PLACE.TITLE, () => {
    if (text.current !== null) caretAtEnd(text.current);
  });
  // Whether the words as they stand were saved as the title was left, so a blur that follows renames nothing again.
  const saved = useRef(true);
  // Whether words were typed since the last pause saved them.
  const typed = useRef(false);
  // The name last saved or asked for, which words typed back to rename nothing; none while the last asked for was refused.
  const base = useRef(name);
  // The draft this title last drew, which comes back to it as `name` and is not drawn over its own words.
  const echo = useRef<string | undefined>(undefined);
  const doors = useRef({ onRename, onDraft });
  doors.current = { onRename, onDraft };
  // The Rename last answered, so only a newer one puts the caret here.
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
  // Note that a refusal is judged by what was typed since the ask, not by
  // the words, because words typed away and back are a newer edit of their own.
  const rename = (element: HTMLElement) => {
    typed.current = false;
    const next = typedName(element);
    if (next === "" || next === base.current) return;
    base.current = next;
    const asked = stamp.current;
    doors.current.onRename(next).then((renamed) => {
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
  // A pause that ran out on the newest words saves them.
  useEffect(() => {
    const element = text.current;
    if (element === null || !typed.current || !AsyncResult.isSuccess(pause)) return;
    if (!pause.waiting && pause.value === stamp.current) rename(element);
  });
  // Note that a title going while typed in saves its words to the task it
  // was drawn for, because no blur reaches an element taken out of the page.
  useLayoutEffect(() => {
    const element = text.current;
    return () => {
      if (element !== null) save(element);
    };
  }, []);
  return (
    // biome-ignore lint/a11y/useSemanticElements: the title's block holds its words, not a form's controls, so it is no `<fieldset>`.
    <div
      ref={block}
      className={DOCUMENT_BLOCK_CLASS}
      role="group"
      tabIndex={entry ? 0 : -1}
      aria-label="Title"
      aria-keyshortcuts="Enter"
      onPointerEnter={prefetchEditorBundle}
      onFocus={(event) => {
        prefetchEditorBundle();
        if (event.target === event.currentTarget) editing.select(EDITOR_PLACE.TITLE);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (steppedByArrow(event)) return;
        if (event.key !== "Enter" || text.current === null) return;
        event.preventDefault();
        caretAtEnd(text.current);
      }}
    >
      <div className="markdown task-title ph-no-capture">
        {/* biome-ignore lint/a11y/useSemanticElements: the title is edited in the heading's own look, which wraps as a heading does; an input cannot. */}
        <div
          ref={text}
          className="markdown-heading task-title-text"
          data-level="1"
          contentEditable="plaintext-only"
          suppressContentEditableWarning
          role="textbox"
          aria-label="Task name"
          tabIndex={-1}
          spellCheck
          onFocus={() => {
            saved.current = false;
          }}
          onInput={(event) => {
            saved.current = false;
            typed.current = true;
            boundTitle(event.currentTarget);
            const next = typedName(event.currentTarget);
            echo.current = next === "" ? undefined : next;
            onDraft(echo.current);
            stamp.current += 1;
            restartPause(stamp.current);
          }}
          onBlur={(event) => save(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              save(event.currentTarget);
              block.current?.focus();
              return;
            }
            if (event.key !== "Enter" && event.key !== "ArrowDown") return;
            event.preventDefault();
            save(event.currentTarget);
            editing.open();
          }}
        />
      </div>
    </div>
  );
}

/** What the editor reports its text, its finish, and its leaving through. */
interface DraftDoors {
  readonly onDraft: (markdown: string) => void;
  readonly onFinish: (section: number) => void;
  readonly onLeave: () => void;
  readonly onLeaveUp: () => void;
}

/**
 * The editor's text, handed to the model once per pause in the typing.
 * Note that it is held back, because each hand-over draws the document
 * around the editor again, and the editor holds the text meanwhile; a
 * finish, a leaving, or the editor going hands over the last first, and the
 * document hands over what is held before it saves what is left as a plan
 * goes.
 */
function useDraftHandOver(
  editing: PlanEditing,
  hostOf: (section: number) => EditorHost,
): DraftDoors {
  const [pause, restartPause] = useAtom(draftPauseAtom);
  const pending = useRef<string | undefined>(undefined);
  const stamp = useRef(0);
  const door = useRef(editing);
  door.current = editing;
  const flush = () => {
    const next = pending.current;
    pending.current = undefined;
    if (next !== undefined) door.current.typeText(next);
  };
  // A pause that ran out on the newest text hands it over.
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
    onDraft: (markdown) => {
      pending.current = markdown;
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

/** The bundle's editor mounted in place, built once, on the text it opened with; its handle kept for the merged answers. */
export function MountedPlanEditor({
  module,
  props,
  handle,
}: {
  module: PlanEditorModule;
  props: PlanEditorProps;
  handle: React.RefObject<PlanEditorHandle | undefined>;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  useLayoutEffect(() => {
    if (host.current === null) return;
    const { mentions } = latest.current;
    const mounted = module.mount(host.current, {
      ...latest.current,
      onDraft: (markdown) => latest.current.onDraft(markdown),
      onFinish: (section) => latest.current.onFinish(section),
      onLeaveUp: () => latest.current.onLeaveUp(),
      // Note that the mentions' doors are read as they are used, as the rest are.
      mentions:
        mentions === undefined
          ? undefined
          : {
              onTrigger: (trigger) => latest.current.mentions?.onTrigger(trigger),
              onKey: (event) => latest.current.mentions?.onKey(event) ?? false,
              drawMention: (element, mention) =>
                latest.current.mentions?.drawMention(element, mention) ?? (() => undefined),
              retarget: (target, renamed) => latest.current.mentions?.retarget(target, renamed),
              pasted: (words) => latest.current.mentions?.pasted(words),
              namesMention: (target) => latest.current.mentions?.namesMention(target) ?? false,
            },
      drawDiagram:
        latest.current.drawDiagram === undefined
          ? undefined
          : (element, diagram) =>
              latest.current.drawDiagram?.(element, diagram) ?? (() => undefined),
    });
    handle.current = mounted;
    return () => {
      handle.current = undefined;
      mounted.destroy();
    };
  }, [module, handle]);
  return <div ref={host} />;
}

/**
 * A save's merged answer taken into the open editor. A save that landed shows
 * as the model's base moving to the text it sent; the host draws the plan
 * the service answered before the save's answer arrives, so the plan whose
 * last save is the developer's, and newer than the one last taken, holds
 * the merged text. Then Luke's part of it is laid in and the model's base
 * becomes what the service holds. A draft never moves the last save, and a
 * save of Luke's is not the developer's, so neither reaches the editor.
 */
function useMergedAnswers(
  editor: DocumentEditor,
  editing: PlanEditing,
  task: Task,
  handle: React.RefObject<PlanEditorHandle | undefined>,
): void {
  const seen = useRef({ base: editor.base, updatedAt: task.updatedAt });
  const landed = useRef<string | undefined>(undefined);
  useEffect(() => {
    const { base, sending, state } = editor;
    const settled = sending === undefined && state.kind === DOCUMENT_EDITOR_STATE.EDITING;
    if (settled && base !== seen.current.base) landed.current = base;
    seen.current.base = base;
    const sent = landed.current;
    if (sent === undefined || task.updatedAt === seen.current.updatedAt) return;
    if (task.lastEdit?.actor !== PLAN_ACTOR.DEVELOPER) return;
    landed.current = undefined;
    seen.current.updatedAt = task.updatedAt;
    const taken = handle.current?.take(sent, task.document.body);
    if (taken === undefined) return;
    seen.current.base = taken.base;
    editing.rebase(taken.base, taken.text);
  });
}

/** What stands under the editor: Luke's change and the choice it asks, or a failed save and its retry; a save under way says nothing. */
function DocumentNote({
  editor,
  editing,
}: {
  editor: DocumentEditor;
  editing: PlanEditing;
}): React.JSX.Element | null {
  if (editor.state.kind === DOCUMENT_EDITOR_STATE.CONFLICT) {
    return (
      <div className="plan-editor-note" role="alert">
        <span>{CONFLICT_NOTE}</span>
        <Button onClick={editing.keepMine}>Keep mine</Button>
        <Button onClick={editing.takeLukes}>Use Luke's</Button>
      </div>
    );
  }
  if (editor.state.kind === DOCUMENT_EDITOR_STATE.FAILED) {
    return (
      <div className="plan-editor-note" role="alert">
        <span>{editor.state.note}</span>
        <RetryButton onRetry={editing.retry} />
      </div>
    );
  }
  return null;
}

/**
 * The whole text in its editor, in place of its drawn sections, which stand
 * as `drawn` until the editor's bundle has loaded. `hostOf` names the block
 * of a section, which the keyboard goes back to as the editor finishes.
 * Focus leaving the editor closes it, unless it moved to its own buttons.
 */
export function PlanDocumentEditor({
  task,
  editor,
  editing,
  drawn,
  hostOf,
  mentions,
  scroller,
}: {
  task: Task;
  editor: DocumentEditor;
  editing: PlanEditing;
  drawn: ReactNode;
  hostOf: (section: number) => EditorHost;
  /** What the plan's mentions open, drawn as their chips in the editor, with `@` picking new ones; none where the text takes no mentions. */
  mentions?: MentionDoors | undefined;
  /** The column the document scrolls in, whose empty room moves the caret (`useTextRoom`). */
  scroller?: React.RefObject<HTMLElement | null> | undefined;
}): React.JSX.Element {
  const doors = useDraftHandOver(editing, hostOf);
  const handle = useRef<PlanEditorHandle | undefined>(undefined);
  useMergedAnswers(editor, editing, task, handle);
  const module = useAtomValue(useSideBundles().planEditor);
  const room = useRef<HTMLElement>(null);
  const chips = useEditorDrawings<MentionNode>();
  const diagrams = useEditorDrawings<EditorDiagram>();
  const pictures = useEditorPictures(task.id, mentions?.place.workspace, handle);
  // A press on the document's empty room puts the caret there, at the text's end where it lands under it; one before the editor has loaded is where it opens.
  const [pending, setPending] = useState<PlanEditorPlacement | undefined>(undefined);
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
  // Note that a finish or a leaving waits for a picture still being kept, since only the open editor can lay in its address; it goes once none is.
  const held = useRef<(() => void) | undefined>(undefined);
  const once = (close: () => void) => {
    if (pictures.sending) held.current = close;
    else close();
  };
  useEffect(() => {
    const close = held.current;
    if (pictures.sending || close === undefined) return;
    held.current = undefined;
    close();
  });
  // Note that the editor's own text is read, since the draft is handed over only once typing pauses.
  const text = () => handle.current?.markdown() ?? editor.draft;
  // The plan's pages, agents, and pull requests are offered as the page's agents' boxes offer them.
  const page = useTaskMentions();
  // A Luke address pasted whole is called by the name the window holds for what it names.
  const known = useKnownNames();
  const picker = useMentionPicker({
    source: {
      taskId: task.id,
      taskName: task.name,
      workspace: mentions?.place.workspace ?? "",
      repository: task.repository,
      text,
      pages: page?.pages,
      agents: page?.agents,
      readAgents: page?.readAgents,
      pullRequests: page?.pullRequests,
    },
    room,
    side: MENTION_MENU_SIDE.BELOW,
    onChoose: (mention) => handle.current?.chooseMention(mention),
  });
  if (!AsyncResult.isSuccess(module)) {
    return (
      <section ref={room} className="plan-document-editor ph-no-capture" aria-busy="true">
        {drawn}
        {AsyncResult.isFailure(module) ? (
          <p className="plan-editor-note" role="alert">
            {EDITOR_LOAD_FAILED}
          </p>
        ) : null}
      </section>
    );
  }
  const props: PlanEditorProps = {
    markdown: editor.draft,
    placement: pending ?? editing.placement,
    focus: true,
    label: "Plan",
    className: `markdown ${PROSE_CLASS} plan-unit`,
    onDraft: doors.onDraft,
    onFinish: (section) => once(() => doors.onFinish(section)),
    onLeaveUp: doors.onLeaveUp,
    mentions:
      mentions === undefined
        ? undefined
        : {
            onTrigger: picker.onTrigger,
            onKey: picker.onKey,
            drawMention: chips.draw,
            retarget: (target, change) =>
              retargetedMention(task.id, mentions.place, target, change),
            pasted: (words) =>
              pastedMentionNode(words, mentions.place, { known, taskId: task.id, text }),
            namesMention: (target) =>
              decodeMention(target, mentions.place.repository) !== undefined,
          },
    drawDiagram: diagrams.draw,
    pictures: pictures.pictures,
  };
  return (
    <section
      ref={room}
      className="plan-document-editor ph-no-capture"
      aria-label="Editing the plan"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) once(doors.onLeave);
      }}
    >
      <MountedPlanEditor module={module.value} props={props} handle={handle} />
      <DocumentNote editor={editor} editing={editing} />
      {pictures.drawn}
      {mentions === undefined ? null : picker.menu}
      {mentions === undefined
        ? null
        : chips.drawn.map((each) =>
            createPortal(
              <MentionNodeChip mention={each.what} doors={mentions} />,
              each.element,
              each.key,
            ),
          )}
      {diagrams.drawn.map((each) =>
        createPortal(
          <DiagramPreview code={each.what.code} previous={each.what.previous} />,
          each.element,
          each.key,
        ),
      )}
    </section>
  );
}

/** Something the editor asked to be drawn: the element it stands as, what it is, and the key its drawing goes under. */
interface DrawnInEditor<A> {
  readonly element: HTMLElement;
  readonly what: A;
  readonly key: number;
}

/** What the editor holds as drawn, and the door the editor asks to draw one through. */
interface EditorDrawings<A> {
  readonly drawn: readonly DrawnInEditor<A>[];
  readonly draw: (element: HTMLElement, what: A) => () => void;
}

/**
 * What the editor asks the panel to draw, a mention or a diagram, each drawn
 * into its own element while it stands, as the composer draws its chips.
 */
export function useEditorDrawings<A>(): EditorDrawings<A> {
  const [drawn, setDrawn] = useState<readonly DrawnInEditor<A>[]>([]);
  const counted = useRef(0);
  const draw = (element: HTMLElement, what: A) => {
    counted.current += 1;
    const key = counted.current;
    setDrawn((was) => [...was, { element, what, key }]);
    return () => setDrawn((was) => was.filter((each) => each.key !== key));
  };
  return { drawn, draw };
}
