import { CloseIcon } from "@sidecar/panel";
import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { Tooltip } from "../tooltip";
import { useClipped } from "../use-clipped";
import {
  ActionMenu,
  atPointer,
  MENU_ALIGN,
  MENU_DROP,
  type MenuAction,
  type MenuPlacement,
  useActionMenu,
} from "./action-menu";
import { type TabMove, useTabDrag } from "./use-tab-drag";

/**
 * tab-strip.tsx -- the window's one tab strip, drawn alike across the plan's column and the side panel, the way an editor draws its tabs.
 *
 * A tab is its glyph and its label in a compact pill: raised while it is the
 * chosen one, plain and muted otherwise. A tab that may be closed carries an
 * × at its end, standing on the chosen tab and shown on the others while the
 * pointer is on them. The strip is one stop for Tab: the arrow keys, Home,
 * and End move between its tabs, Return or Space chooses the one focused,
 * and Delete or Backspace closes it, handing focus to the tab chosen in its
 * place. The × is for the pointer alone, so it takes no stop of its own.
 *
 * A strip whose owner keeps the tabs' order lets them be moved: dragged
 * along it (use-tab-drag.ts), or the focused one stepped left or right by
 * ⇧⌘← and ⇧⌘→, as VS Code moves an editor, with focus kept on it. Either
 * way the strip says where the tab now stands to whoever reads it aloud. A
 * tab anchored at the strip's start, as the plan's tab is in its column,
 * stands there for good, as a browser's pinned tab does: it is not moved,
 * and no tab is moved before it.
 *
 * A tab something arrived on while another was chosen reads in semibold
 * until it is chosen, the sidebar's convention for a plan saved unseen,
 * rather than wearing a dot, and says "New result" in its hint and to a
 * reader.
 *
 * A tab with actions of its own offers them on a
 * right-click, or from the keyboard on the menu key or ⇧F10, hanging where
 * the pointer is or under the tab (`MenuTab`), and closing that menu hands
 * focus back to the tab.
 *
 * Every tab stands whole, its glyph and its label, a long label cut short
 * and said whole in its hint, or in the card a tab with more to say hangs
 * in its hint's place. A label measured cut short wears
 * `data-overflow`, which desktop.css fades out at its end, as Chrome's and
 * Arc's tabs do, rather than ending it in an ellipsis. Past holding them all,
 * the strip scrolls along, as Chrome's and VS Code's do: a mouse's wheel runs it
 * sideways, and the tab chosen, or the one the keyboard reaches, is brought
 * into the room it shows, and kept there as the strip is narrowed. An edge
 * the strip hides tabs beyond wears `data-overflow-start` or
 * `data-overflow-end`, which desktop.css fades.
 *
 * Its words are text, which the session recording masks with the rest.
 */

const TAB = '[role="tab"]';

/** A tab that moves: every one but those anchored at the strip's start. */
const MOVABLE_TAB = `.tab:not([data-anchored="true"]) ${TAB}`;

/** What a wheel's delta counts, as its `deltaMode` says: pixels, lines, or pages. */
const WHEEL_DELTA = {
  PIXEL: 0,
  LINE: 1,
  PAGE: 2,
} as const;

/** The CSS pixels a wheel's line stands for, the tabs' own line of text. */
const WHEEL_LINE = 16;

/**
 * How far, in CSS pixels, the strip hides its tabs past an edge before that
 * edge fades: more than the sub-pixel the tabs' fractional widths can leave
 * over a strip that, to the eye, holds them all.
 */
const OVERFLOW_SLACK = 1;

/** What an unread tab says in its hint and to a reader beyond its label. */
const UNREAD_TAB_NOTE = "New result";

/** The words a tab's hint joins: its label where it is cut short, what the tab adds, and its news. */
function tabHint(input: {
  label: string;
  clipped: boolean;
  tooltip: string | undefined;
  unread: boolean;
}): string | undefined {
  const words = [
    input.clipped ? input.label : undefined,
    input.tooltip,
    input.unread ? UNREAD_TAB_NOTE : undefined,
  ].filter((word) => word !== undefined);
  return words.length === 0 ? undefined : words.join(" · ");
}

/**
 * The tab a navigation key moves to from the focused one, or nothing for any
 * other key. Note that a key held with a modifier moves nothing, because
 * ⇧⌘← and ⇧⌘→ move the tab itself rather than focus.
 */
function tabAfter(event: React.KeyboardEvent, at: number, count: number): number | undefined {
  if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return undefined;
  switch (event.key) {
    case "ArrowRight":
      return (at + 1) % count;
    case "ArrowLeft":
      return (at <= 0 ? count : at) - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}

function closesTab(key: string): boolean {
  return key === "Delete" || key === "Backspace";
}

/** Scrolls the strip `by` along, gliding as its stylesheet says or at once. */
function scrollStrip(strip: HTMLElement, by: number, glide: boolean): void {
  if (!glide) strip.style.scrollBehavior = "auto";
  strip.scrollLeft += by;
  strip.style.scrollBehavior = "";
}

/**
 * Scrolls the strip, and nothing around it, the least that shows the whole
 * of `tab`'s pill clear of the faded edges. Note that the strip's own scroll
 * padding is that clearance, and its scroll behaviour whether it glides, so
 * the stylesheet holds both, and a pane sliding in is never scrolled with it.
 * A strip just drawn is put there at once, as a page opens already scrolled.
 */
function reveal(strip: HTMLElement, tab: HTMLElement, glide = true): void {
  const pill = tab.closest(".tab") ?? tab;
  const shown = strip.getBoundingClientRect();
  const own = pill.getBoundingClientRect();
  const style = getComputedStyle(strip);
  const before = shown.left + (Number.parseFloat(style.scrollPaddingLeft) || 0) - own.left;
  const after = own.right - shown.right + (Number.parseFloat(style.scrollPaddingRight) || 0);
  if (before > 0) scrollStrip(strip, -before, glide);
  else if (after > 0) scrollStrip(strip, after, glide);
}

/**
 * Marks each edge the strip hides tabs beyond, for its fade. Note that it is
 * measured rather than left to a scroll timeline, because a timeline is
 * active over any overflow at all, the sub-pixel one included, and a fade
 * must stand on exactly the edges that hide a tab, at every width.
 */
function markOverflow(strip: HTMLElement): void {
  const hidden = strip.scrollWidth - strip.clientWidth;
  strip.setAttribute("data-overflow-start", String(strip.scrollLeft > OVERFLOW_SLACK));
  strip.setAttribute("data-overflow-end", String(hidden - strip.scrollLeft > OVERFLOW_SLACK));
}

/** Focus moved to a tab by the strip's own keys, which bring it into view with the strip's glide. */
function focusTab(strip: HTMLElement | null, tab: HTMLElement | undefined | null): void {
  tab?.focus({ preventScroll: true });
  if (strip !== null && tab !== undefined && tab !== null) reveal(strip, tab);
}

/** What the strip says aloud of a tab moved: its label and the place it now stands. */
function movedLine(tab: HTMLElement | undefined, to: number, count: number): string {
  return `${tab?.textContent ?? "Tab"} moved to position ${to + 1} of ${count}`;
}

/** Whether a key opens a tab's own menu from the keyboard: the menu key, or ⇧F10. */
function opensMenu(event: React.KeyboardEvent): boolean {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

/** Where a tab's menu hangs when the keyboard asks for it: under the tab, from its start. */
function underTab(tab: HTMLElement): MenuPlacement {
  const bounds = (tab.closest(".tab") ?? tab).getBoundingClientRect();
  return { x: bounds.left, y: bounds.bottom + MENU_DROP, align: MENU_ALIGN.START };
}

/**
 * The strip of tabs. Note that focus follows a tab closed from the keyboard
 * to the tab that took its place a render later, because the tab it was on
 * is gone by then; with none left, it goes on to the button after the
 * strip, or the first in what follows it: the side panel's "+". `onMove`,
 * while given, lets the tabs be moved, and hears each move as the tab's
 * place before and after it; every tab moves, to any place among them all.
 */
export function TabStrip({
  label,
  className,
  onMove,
  children,
}: {
  label: string;
  className?: string;
  onMove?: TabMove | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const strip = useRef<HTMLDivElement | null>(null);
  // Whether one of the strip's tabs has focus, the one the move chords move.
  const [focused, setFocused] = useState(false);
  const [movedSaid, setMovedSaid] = useState("");
  // Where a tab was closed from the keyboard, until focus has moved on from it.
  const closedAt = useRef<number | undefined>(undefined);
  // The chosen tab last brought into view, so a tab newly chosen, opened
  // chosen among them, is brought in once rather than on every render.
  const revealed = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const at = closedAt.current;
    if (at === undefined || strip.current === null) return;
    closedAt.current = undefined;
    const tabs = [...strip.current.querySelectorAll<HTMLElement>(TAB)];
    const beside = strip.current.nextElementSibling;
    const after = beside?.matches("button") ? beside : beside?.querySelector("button");
    const next = tabs[Math.min(at, tabs.length - 1)];
    if (next === undefined && after instanceof HTMLElement) after.focus();
    else focusTab(strip.current, next);
  });
  useLayoutEffect(() => {
    const chosen = strip.current?.querySelector<HTMLElement>(`${TAB}[aria-selected="true"]`);
    if (strip.current === null || chosen === null || chosen === undefined) return;
    if (chosen === revealed.current) return;
    const drawn = revealed.current !== null;
    revealed.current = chosen;
    reveal(strip.current, chosen, drawn);
  });
  // A strip narrowed, its panel dragged or the window resized, keeps the
  // chosen tab in view as an editor keeps its active tab, at once rather
  // than gliding behind the edge being dragged, and fades the edges it now
  // hides tabs beyond.
  useLayoutEffect(() => {
    const node = strip.current;
    if (node === null) return;
    const observer = new ResizeObserver(() => {
      const chosen = node.querySelector<HTMLElement>(`${TAB}[aria-selected="true"]`);
      if (chosen !== null) reveal(node, chosen, false);
      markOverflow(node);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // A tab opened, closed, or renamed moves the edges the strip hides tabs
  // beyond, and need not resize the strip, which may already be at its least.
  useLayoutEffect(() => {
    if (strip.current !== null) markOverflow(strip.current);
  });

  // Note that a move's places count the tabs that move alone, as the drag
  // does, so a tab anchored at the start is no place of theirs.
  const move =
    onMove === undefined
      ? undefined
      : (from: number, to: number) => {
          const tabs = [...(strip.current?.querySelectorAll<HTMLElement>(MOVABLE_TAB) ?? [])];
          setMovedSaid(movedLine(tabs[from], to, tabs.length));
          onMove(from, to);
        };
  const onPointerDown = useTabDrag(move);
  // The focused tab one place along, drawn there before focus is put back
  // on it, since moving it in the document can take focus from it.
  const step = (by: number) => {
    const tabs = [...(strip.current?.querySelectorAll<HTMLElement>(MOVABLE_TAB) ?? [])];
    const tab = tabs.find((each) => each === document.activeElement);
    const at = tab === undefined ? -1 : tabs.indexOf(tab);
    if (tab === undefined || move === undefined || at + by < 0 || at + by >= tabs.length) return;
    flushSync(() => move(at, at + by));
    focusTab(strip.current, tab);
  };
  const stepping = move !== undefined && focused;
  useAppCommand(APP_COMMAND.MOVE_TAB_LEFT, stepping ? () => step(-1) : undefined);
  useAppCommand(APP_COMMAND.MOVE_TAB_RIGHT, stepping ? () => step(1) : undefined);

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>(TAB)];
    const at = event.target instanceof HTMLElement ? tabs.indexOf(event.target) : -1;
    if (at < 0) return;
    if (closesTab(event.key)) {
      // Only a tab that closes hands focus on; one that always stands stays.
      const pill = event.target instanceof HTMLElement ? event.target.closest(".tab") : null;
      if (pill?.getAttribute("data-closable") === "true") closedAt.current = at;
      return;
    }
    const next = tabAfter(event, at, tabs.length);
    if (next === undefined) return;
    event.preventDefault();
    focusTab(strip.current, tabs[next]);
  };

  // A wheel turned up and down runs the strip along, as a browser's tab strip
  // takes it; a trackpad's sideways swipe already scrolls it natively. Note
  // that it scrolls at once rather than gliding, because a glide would be
  // restarted, and cut short, by every step of a turning wheel.
  const wheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    if (node.scrollWidth <= node.clientWidth) return;
    const unit =
      event.deltaMode === WHEEL_DELTA.LINE
        ? WHEEL_LINE
        : event.deltaMode === WHEEL_DELTA.PAGE
          ? node.clientWidth
          : 1;
    scrollStrip(node, event.deltaY * unit, false);
  };

  // The line a move says stands before the strip, so the control after the
  // strip is still the one a closed last tab hands focus to.
  return (
    <>
      {move === undefined ? null : (
        <span className="visually-hidden" role="status">
          {movedSaid}
        </span>
      )}
      <div
        ref={strip}
        role="tablist"
        aria-label={label}
        className={className ? `tab-strip ${className}` : "tab-strip"}
        onKeyDown={keyDown}
        onPointerDown={onPointerDown}
        onWheel={wheel}
        onScroll={(event) => markOverflow(event.currentTarget)}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}
      >
        {children}
      </div>
    </>
  );
}

/**
 * One tab. `onClose` gives it its × and its Delete key; a tab without it is
 * one that always stands. `detail`, while given, follows the label in the
 * muted secondary colour, parted from it by a space and no mark, as a
 * model's effort follows its name (`model-label.tsx`). `endMark`, while
 * given, stands at the tab's end in its ×'s place, with room kept for it,
 * and gives way to the × under the pointer, as an editor's tab trades its
 * unsaved dot for its ×. `editor`, while given, is drawn in the label's
 * place as a field of its own, outside the tab's role, so a reader reaches
 * it. A label cut short is said whole in the tab's hint, before what
 * `tooltip` adds and an unread tab's news; `card`, while given, hangs in the
 * hint's place whether or not the label is cut short, and says the whole
 * name itself. `onMenu` opens the tab's own actions where it says, from a
 * right-click or the keyboard's menu keys. A `quiet` tab draws no fill at
 * rest, chosen or not, and the hover fill under the pointer: a lone tab,
 * always the chosen one, need not be told from the others. An `anchored`
 * tab stands at the strip's start for good, never moved.
 */
export function Tab({
  icon,
  label,
  endMark,
  selected,
  unread = false,
  tooltip,
  card,
  keyshortcuts,
  editor,
  tabRef,
  quiet = false,
  anchored = false,
  onSelect,
  onClose,
  onMenu,
}: {
  icon: React.JSX.Element;
  label: string;
  /** A mark at the tab's end, in its ×'s place until the pointer comes over it: a failed agent's (`state-glyph.tsx`). */
  endMark?: React.JSX.Element | undefined;
  selected: boolean;
  /** Something arrived on the tab while another was chosen: its label in semibold until it is chosen. */
  unread?: boolean;
  /** What the pointer resting on the tab says beyond its label. */
  tooltip?: string | undefined;
  /** What the pointer resting on the tab shows in its hint's place: a card naming it whole and saying what it last did. */
  card?: React.ReactNode;
  keyshortcuts?: string | undefined;
  editor?: React.ReactNode;
  tabRef?: React.Ref<HTMLButtonElement> | undefined;
  quiet?: boolean;
  anchored?: boolean;
  onSelect: () => void;
  onClose?: (() => void) | undefined;
  onMenu?: ((placement: MenuPlacement, opener: HTMLElement) => void) | undefined;
}): React.JSX.Element {
  // Whether the label is cut short: a label renamed, or the plan's one tab
  // giving way to its toolbar.
  const [words, clipped] = useClipped();
  const hint = tabHint({ label, clipped, tooltip, unread });
  const glyph = <span className="tab-icon">{icon}</span>;
  const tab = (
    <button
      ref={tabRef}
      type="button"
      role="tab"
      className="tab-button"
      aria-selected={selected}
      aria-keyshortcuts={keyshortcuts}
      aria-description={unread ? UNREAD_TAB_NOTE : undefined}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onContextMenu={
        onMenu === undefined
          ? undefined
          : (event) => {
              event.preventDefault();
              // A menu key the system turned into a right-click says no point
              // of its own, and hangs the menu under the whole tab.
              const fromKeyboard = event.clientX === 0 && event.clientY === 0;
              const at = fromKeyboard ? underTab(event.currentTarget) : atPointer(event);
              onMenu(at, event.currentTarget);
            }
      }
      onKeyDown={(event) => {
        if (onMenu !== undefined && opensMenu(event)) {
          event.preventDefault();
          onMenu(underTab(event.currentTarget), event.currentTarget);
          return;
        }
        if (onClose === undefined || !closesTab(event.key)) return;
        event.preventDefault();
        onClose();
      }}
    >
      {glyph}
      <span ref={words} className="tab-label" data-overflow={String(clipped)}>
        {label}
      </span>
      {endMark === undefined ? null : <span className="tab-end-mark">{endMark}</span>}
    </button>
  );
  return (
    <div
      className="tab"
      data-selected={String(selected)}
      data-closable={String(onClose !== undefined)}
      data-quiet={String(quiet)}
      data-anchored={String(anchored)}
      data-unread={String(unread)}
      data-marked={String(endMark !== undefined)}
    >
      {editor === undefined ? (
        <Tooltip label={card === undefined ? hint : label} card={card}>
          {tab}
        </Tooltip>
      ) : (
        <span className="tab-button field-well" data-editing="true">
          {glyph}
          {editor}
        </span>
      )}
      {onClose === undefined || editor !== undefined ? null : (
        <button
          type="button"
          className="tab-close"
          aria-label={`Close ${label}`}
          tabIndex={-1}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

/**
 * A tab with its own actions, in the groups a rule divides, on a right-click
 * or the keyboard's menu keys, hung where the pointer is or under the tab;
 * closing the menu hands focus back to the tab, and a press on the tab
 * closes it, as a press on a menu's own button does. Every other part is
 * `Tab`'s.
 */
export function MenuTab({
  groups,
  ...tab
}: Omit<React.ComponentProps<typeof Tab>, "onMenu"> & {
  groups: MenuAction[][];
}): React.JSX.Element {
  const menu = useActionMenu(true);
  return (
    <>
      <Tab
        {...tab}
        onSelect={() => {
          menu.close(false);
          tab.onSelect();
        }}
        onMenu={menu.show}
      />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${tab.label} actions`}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
    </>
  );
}
