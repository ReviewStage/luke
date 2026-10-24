import { useAtom, useAtomValue } from "@effect/atom-react";
import { DOCUMENT_EDITOR_STATE, type DocumentEditor } from "@luke/features/plan-edit-model";
import { PLAN_ACTOR, TASK_BOUNDS, type Task } from "@luke/features/task-wire";
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
} from "@luke/ui";
import { markdownClass } from "@luke/ui/markdown-class";
import { openThread, usePlanCommentsControl } from "@luke/ui/plan-comments";
import { Duration, Effect } from "effect";
import { AsyncResult } from "effect/reactivity";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePrefetchEditorBundle, useSideBundles } from "../bundle-loader.js";
import {
  type EditorAnchors,
  PLACEMENT_END,
  PLAN_PLACEHOLDER,
  type PlacedWords,
  type PlanEditorHandle,
  type PlanEditorPlacement,
} from "../plan-editor/contract.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { useEditorPictures } from "./editor-pictures.js";
import { MarkdownEditor } from "./markdown-editor.js";
import { type MentionDoors, retargetedMention } from "./mention-chip.js";
import { useTaskMentions } from "./task-mentions.js";
import {
  EDITOR_PLACE,
  type EditorHost,
  type PlanEditing,
  useMarkTitleUnsaved,
} from "./use-plan-editing.js";

/**
 * plan-document-editor.tsx -- the open plan, edited in place: its title, its sections as blocks, and its whole text in one editor.
 *
 * The text is drawn as its sections, and nothing on them marks them
 * editable. A click into a section's words opens the whole text in place,
 * the caret where the click landed, and so does a press on the empty room
 * around the text (`useTextRoom`); the editor is TipTap, from the editor
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
 * the notetaker's drafts never redraw it. The editor is every Markdown
 * document's (`./markdown-editor.tsx`), with every option a plan takes: its
 * mentions, its pictures, its comment threads and Comment on the format
 * toolbar, in place of the read view's Comment bubble, its sections'
 * placement and the title above, and a Mermaid block's preview.
 */

/** What the open editor's room wears: the text and what it opened inside it, where the focus is the editor's. */
export const EDITOR_ROOM_CLASS = "plan-document-editor";

/** What the developer does that ends the editor keeping the words it opened on where they stood: a scroll, a press, or a key. */
const KEEPING_ENDS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

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

/** Whether a click lands on words to edit: no selection made by the press, and not on a link, a button bar a picture's, a video's player, a task's checkbox or the label around it, or the section's byline. */
export function editsOnClick(target: EventTarget): boolean {
  const selection = window.getSelection();
  if (selection !== null && !selection.isCollapsed) return false;
  // Note that a mention's chip is its own, a link's or a folder's that opens nothing alike, and so is the byline's row, whose writer and ⋯ are presses of their own, a button in the words, a diagram's Show code say, and a task's checkbox, which ticks its item, and the label around it, whose press a finger takes beside the box and hands to it; a comment's marked words open its thread and the editor at them alike. A picture's press is a button that hands on only the press it does not take, a diagram's under a mouse in a wide room, which is the words' as the bare picture's was. A video's player is its own whole, its frame and every control in it, whatever they are drawn as, since a press there plays, seeks, or enlarges it; its caption is the words'.
  return !(
    target instanceof Element &&
    target.closest(
      "a, button:not(.luke-picture-tile), input, label, [data-mention-ref], .plan-unit-row, .picture-block[data-video] > :not(.picture-caption)",
    ) !== null
  );
}

/** Where in the page's words a point stands, by whichever of the two ways the browser offers: WebKit's and Blink's, or Firefox's. */
function rangeAt(x: number, y: number): Range | null {
  // Note that each is read as possibly missing, since a browser offers one of the two and the DOM's types claim both.
  const page: Partial<Pick<Document, "caretRangeFromPoint" | "caretPositionFromPoint">> = document;
  if (page.caretRangeFromPoint !== undefined) return page.caretRangeFromPoint(x, y);
  const position = page.caretPositionFromPoint?.(x, y) ?? null;
  if (position === null) return null;
  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  return range;
}

/** Where the top of a range's line stands in the window, or its words' element's where the browser draws no box for it. */
function lineTop(range: Range, words: Text): number {
  // Note that a range's boxes are read as possibly missing, since a page with no layout, as a test's is, draws none.
  const measured: Partial<Pick<Range, "getClientRects">> = range;
  const box = measured.getClientRects?.()[0];
  return box?.top ?? words.parentElement?.getBoundingClientRect().top ?? 0;
}

/** Whether a text node stands in a code block, as `PlacedWords` counts it. */
function inCode(text: Node): boolean {
  return text.parentElement?.closest("pre") != null;
}

/**
 * The words a click at a point landed on in a section's drawn block, as the
 * editor finds them again (`PlacedWords`); none where it landed on no words.
 */
function wordsUnder(
  block: HTMLElement,
  section: number,
  x: number,
  y: number,
): PlacedWords | undefined {
  const range = rangeAt(x, y);
  const words = range?.startContainer;
  if (range == null || !(words instanceof Text) || !block.contains(words)) return undefined;
  const text = words.data;
  const code = inCode(words);
  let occurrence = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let at = walker.nextNode(); at !== null && at !== words; at = walker.nextNode()) {
    if (at.textContent === text && inCode(at) === code) occurrence += 1;
  }
  return { section, text, occurrence, offset: range.startOffset, code, top: lineTop(range, words) };
}

/** Whether an element is a heading that opens a section, as the editor counts them (`SECTION_LEVELS`). */
function opensSection(element: Element | null | undefined): element is HTMLHeadingElement {
  return (
    element instanceof HTMLHeadingElement && (element.tagName === "H1" || element.tagName === "H2")
  );
}

/**
 * The words a click at a point landed on in a document drawn whole rather
 * than as its sections, as a pull request's description is: the section
 * counted by the headings that open one before the words, as the editor
 * counts them, so it finds them again (`PlacedWords`); none where it landed
 * on no words.
 */
export function documentWordsUnder(
  root: HTMLElement,
  x: number,
  y: number,
): PlacedWords | undefined {
  const range = rangeAt(x, y);
  const words = range?.startContainer;
  if (range == null || !(words instanceof Text) || !root.contains(words)) return undefined;
  const code = inCode(words);
  let section = 0;
  let occurrence = 0;
  // Whether any words came before, since a heading opening the text opens its first section.
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

/** Where the words a closing editor's caret stood on stand in the drawn text now; none where the drawn text holds no such words. */
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

/**
 * The words the caret stood on kept where they stood as the editor closes,
 * as `PlanDocumentEditor` keeps the words a click landed on as it opens:
 * the drawn text may draw what stands above them at another height than the
 * editor did, a picture, a table or a diagram's preview say, so the column
 * is scrolled by as much as the drawn text moved them. Answers where the
 * closing editor leaves its words (`PlanDocumentEditor`'s `closedOn`).
 */
export function useWordsKeptOnClose(
  taskId: string,
  open: boolean,
  body: React.RefObject<HTMLElement | null>,
  scroller: React.RefObject<HTMLElement | null>,
): React.RefObject<PlacedWords | undefined> {
  const closedOn = useRef<PlacedWords | undefined>(undefined);
  // The task the editor opened on, so words left by one closed as another opens move nothing.
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

/** Where a text's words stand in the window. */
export interface TextBox {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** Where the text's blocks under `element` stand together, from the first's top to the last's bottom; none while none is drawn. */
export function textBoxOf(element: HTMLElement | null): TextBox | undefined {
  const blocks = element?.querySelectorAll(EDITABLE_TEXT_BLOCK_SELECTOR) ?? [];
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
 * lines over the text (a title, a byline).
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
 * One section of the text as a block (`EditableBlock`): its drawn words,
 * which a click opens the text at, and the keyboard selects, moves past, or
 * opens at the section's end.
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
        if (!editsOnClick(target)) return;
        const words = wordsUnder(pressed, section, x, y);
        editing.open(words === undefined ? { x, y } : { x, y, words });
      }}
      onOpen={() => editing.open({ section })}
    >
      {children}
    </EditableBlock>
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
  actions,
  onRename,
  onDraft,
}: {
  name: string;
  /** Whether this block is where Tab enters the document. */
  entry: boolean;
  editing: PlanEditing;
  /** How many times Rename was chosen; each change is an ask of its own. */
  renaming?: number;
  /** The title's ⋯, at the end of its line. */
  actions?: ReactNode;
  /** Renames the task, answering whether the name was taken. */
  onRename: (name: string) => Promise<boolean>;
  onDraft: (name: string | undefined) => void;
}): React.JSX.Element {
  const block = useRef<HTMLDivElement>(null);
  const prefetchEditorBundle = usePrefetchEditorBundle();
  const text = useRef<HTMLElement>(null);
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
  // How many renames asked for have not answered; the title's words are unsaved work while any is out or words are typed.
  const asking = useRef(0);
  const markUnsaved = useMarkTitleUnsaved();
  const tellUnsaved = () => markUnsaved(typed.current || asking.current > 0);
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
    // Note that the unit's class lets the ⋯ show as the pointer or the keyboard comes onto the title, as a section's does.
    <div className="task-title plan-unit-attributed ph-no-capture">
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
                if (way === EDITABLE_HEADING_LEAVE.BACK) block.current?.focus();
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

/** What the editor reports its text, its finish, and its leaving through. */
interface DraftDoors {
  readonly onDraft: (markdown: string, anchors?: EditorAnchors) => void;
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

/**
 * Text the open editor did not type taken into it, the caret kept where it
 * stood, since the editor mounts once on its words and never follows them.
 * Three kinds reach it. A save's merged answer: a save that landed shows as
 * the model's base moving to the text it sent; the host draws the plan the
 * service answered before the save's answer arrives, so the plan whose last
 * save is the developer's, and newer than the one last taken, holds the
 * merged text, whose other part is laid in and the model's base becomes
 * what the service holds. A save someone else made, a teammate's, an
 * agent's, or Luke's, reaching an editor holding nothing unsaved: their text
 * is laid in and becomes the base. An editor holding words not yet saved
 * keeps them instead, and its next save is laid over the service's text,
 * whose merged answer then reaches it as the first kind. And words the
 * model moved itself, as Keep mine's merged words: laid in place of the
 * blocks they changed. `handed` is the last text the editor handed over or
 * was laid with, which tells the model's own moves from the editor's.
 */
function useTakenText(
  editor: DocumentEditor,
  editing: PlanEditing,
  task: Task,
  handle: React.RefObject<PlanEditorHandle | undefined>,
  handed: React.RefObject<string>,
): void {
  const seen = useRef({ base: editor.base, draft: editor.draft, updatedAt: task.updatedAt });
  const landed = useRef<string | undefined>(undefined);
  useEffect(() => {
    const { base, draft, sending, state } = editor;
    const settled = sending === undefined && state.kind === DOCUMENT_EDITOR_STATE.EDITING;
    if (settled && base !== seen.current.base) landed.current = base;
    seen.current.base = base;
    // Note that words handed over in this commit reach the draft only in the next, so only a draft that moved is the model's.
    const moved = draft !== seen.current.draft;
    seen.current.draft = draft;
    const mounted = handle.current;
    // Note that an editor still loading mounts on the newest words, which then need no laying in.
    if (moved && draft !== handed.current) {
      handed.current = mounted === undefined ? draft : mounted.take(handed.current, draft).text;
      return;
    }
    if (task.updatedAt === seen.current.updatedAt) return;
    const sent = landed.current;
    if (sent !== undefined) {
      if (task.lastEdit?.actor !== PLAN_ACTOR.DEVELOPER) return;
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

/** What stands under the editor: someone else's change, named, and the choice it asks, or a failed save and its retry; a save under way says nothing. */
function DocumentNote({
  editor,
  editing,
}: {
  editor: DocumentEditor;
  editing: PlanEditing;
}): React.JSX.Element | null {
  useAnnounceShown(
    ANNOUNCE.ALERT,
    editing.conflict?.note ??
      (editor.state.kind === DOCUMENT_EDITOR_STATE.FAILED ? editor.state.note : ""),
  );
  if (editing.conflict !== undefined) {
    return (
      <div className="plan-editor-note">
        <span>{editing.conflict.note}</span>
        <Button onClick={editing.keepMine}>Keep mine</Button>
        <Button onClick={editing.takeTheirs}>{editing.conflict.take}</Button>
      </div>
    );
  }
  if (editor.state.kind === DOCUMENT_EDITOR_STATE.FAILED) {
    return (
      <div className="plan-editor-note">
        <span>{editor.state.note}</span>
        <RetryButton onRetry={editing.retry} />
      </div>
    );
  }
  return null;
}

/**
 * The whole text in its editor (`./markdown-editor.tsx`), with every option
 * a plan takes, in place of its drawn sections, which stand as `drawn` until
 * the editor's bundle has loaded. `hostOf` names the block of a section,
 * which the keyboard goes back to as the editor finishes. Focus leaving the
 * editor closes it, unless it moved to its own buttons or to the menu its
 * toolbar dropped.
 */
export function PlanDocumentEditor({
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
  editing: PlanEditing;
  drawn: ReactNode;
  hostOf: (section: number) => EditorHost;
  /** What the plan's mentions open, drawn as their chips in the editor, with `@` picking new ones; none where the text takes no mentions. */
  mentions?: MentionDoors | undefined;
  /** The column the document scrolls in, whose empty room moves the caret (`useTextRoom`). */
  scroller?: React.RefObject<HTMLElement | null> | undefined;
  /** Where the mounted editor's handle is kept, for the merged answers and for a comment started on its words. */
  handle: React.RefObject<PlanEditorHandle | undefined>;
  /** Where the words the caret stood on are left as the editor closes, for the drawn text to keep them where they stood (`useWordsKeptOnClose`). */
  closedOn?: React.RefObject<PlacedWords | undefined> | undefined;
  /** Starts a thread on the words selected, as the toolbar's Comment over them does; none where the plan takes no comments here. */
  onComment?: (() => void) | undefined;
}): React.JSX.Element {
  // The words the editor last handed over, or was laid with, which it holds unless the model moved them.
  const handed = useRef(editor.draft);
  const doors = useDraftHandOver(editing, hostOf, handed);
  // Note that this runs before the editor itself is taken down, so its caret is still measured.
  useLayoutEffect(
    () => () => {
      if (closedOn !== undefined) closedOn.current = handle.current?.caretWords();
    },
    [],
  );
  // The open threads' words, carried by the editor from the text it opens on, which is the plan's as saved.
  const comments = usePlanCommentsControl();
  const commentAnchors =
    comments === undefined || editor.draft !== task.document.body
      ? undefined
      : comments.threads.flatMap((thread) =>
          thread.anchor === undefined || !openThread(thread)
            ? []
            : [{ thread: thread.id, ...thread.anchor }],
        );
  useTakenText(editor, editing, task, handle, handed);
  // Whether the editor's bundle has landed, which mounts the editor in the room.
  const ready = AsyncResult.isSuccess(useAtomValue(useSideBundles().planEditor));
  const room = useRef<HTMLElement>(null);
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
  // Note that the words a click opened the editor on are kept where they
  // stood, since the editor may draw what stands above them at another
  // height than the text did, a picture, a table or a diagram's preview say,
  // and again each time the editor's height changes as what it draws later
  // lands, a diagram's preview or a chip, until the developer scrolls,
  // presses, or types.
  useLayoutEffect(() => {
    if (!ready) return;
    // Note that a press on the room while the bundle loaded is where the editor opens, which keeps no words.
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
  // The plan's pages, agents, and pull requests are offered as the page's agents' boxes offer them.
  const page = useTaskMentions();
  return (
    <MarkdownEditor
      markdown={editor.draft}
      label="Plan"
      roomLabel="Editing the plan"
      placeholder={PLAN_PLACEHOLDER}
      // Note that the text wears the drawn sections' own classes, so its lists keep their gutter and nothing moves as it opens or closes.
      className={markdownClass("plan-unit")}
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
                taskId: task.id,
                taskName: task.name,
                workspace: mentions.place.workspace,
                repository: task.repository,
                pages: page?.pages,
                agents: page?.agents,
                readAgents: page?.readAgents,
                pullRequests: page?.pullRequests,
                shownCode: page?.shownCode,
                openFiles: page?.openFiles,
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
