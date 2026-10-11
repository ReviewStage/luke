import { CloseIcon } from "@sidecar/panel";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { Tooltip } from "../tooltip";
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
 * way the strip says where the tab now stands to whoever reads it aloud.
 *
 * Every tab stands whole, its glyph and its label, a long label cut short
 * with an ellipsis and said whole in its hint. Past holding them all, the
 * strip scrolls along, as Chrome's and VS Code's do: a mouse's wheel runs it
 * sideways, and the tab chosen, or the one the keyboard reaches, is brought
 * into the room it shows, and kept there as the strip is narrowed.
 *
 * Its words are text, which the session recording masks with the rest.
 */

const TAB = '[role="tab"]';

/** What a wheel's delta counts, as its `deltaMode` says: pixels, lines, or pages. */
const WHEEL_DELTA = {
  PIXEL: 0,
  LINE: 1,
  PAGE: 2,
} as const;

/** The CSS pixels a wheel's line stands for, the tabs' own line of text. */
const WHEEL_LINE = 16;

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

/** Focus moved to a tab by the strip's own keys, which bring it into view with the strip's glide. */
function focusTab(strip: HTMLElement | null, tab: HTMLElement | undefined | null): void {
  tab?.focus({ preventScroll: true });
  if (strip !== null && tab !== undefined && tab !== null) reveal(strip, tab);
}

/** What the strip says aloud of a tab moved: its label and the place it now stands. */
function movedLine(tab: HTMLElement | undefined, to: number, count: number): string {
  return `${tab?.textContent ?? "Tab"} moved to position ${to + 1} of ${count}`;
}

/**
 * The strip of tabs. Note that focus follows a tab closed from the keyboard
 * to the tab that took its place a render later, because the tab it was on
 * is gone by then; with none left, it goes on to the button after the
 * strip, or the first in what follows it: the side panel's "+". `onMove`, while given, lets the tabs be
 * moved, and hears each move as the tab's place before and after it.
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
  // than gliding behind the edge being dragged.
  useLayoutEffect(() => {
    const node = strip.current;
    if (node === null) return;
    const observer = new ResizeObserver(() => {
      const chosen = node.querySelector<HTMLElement>(`${TAB}[aria-selected="true"]`);
      if (chosen !== null) reveal(node, chosen, false);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const move =
    onMove === undefined
      ? undefined
      : (from: number, to: number) => {
          const tabs = [...(strip.current?.querySelectorAll<HTMLElement>(TAB) ?? [])];
          setMovedSaid(movedLine(tabs[from], to, tabs.length));
          onMove(from, to);
        };
  const onPointerDown = useTabDrag(move);
  // The focused tab one place along, drawn there before focus is put back
  // on it, since moving it in the document can take focus from it.
  const step = (by: number) => {
    const tabs = [...(strip.current?.querySelectorAll<HTMLElement>(TAB) ?? [])];
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
      closedAt.current = at;
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
 * one that always stands. `editor`, while given, is drawn in the label's place
 * as a field of its own, outside the tab's role, so a reader reaches it.
 * A label cut short is said whole in the tab's hint, before what `tooltip` adds.
 */
export function Tab({
  icon,
  label,
  selected,
  unread = false,
  tooltip,
  keyshortcuts,
  editor,
  tabRef,
  onSelect,
  onClose,
}: {
  icon: React.JSX.Element;
  label: string;
  selected: boolean;
  /** Something arrived on the tab while another was chosen: a dot until it is chosen. */
  unread?: boolean;
  /** What the pointer resting on the tab says beyond its label. */
  tooltip?: string | undefined;
  keyshortcuts?: string | undefined;
  editor?: React.ReactNode;
  tabRef?: React.Ref<HTMLButtonElement>;
  onSelect: () => void;
  onClose?: (() => void) | undefined;
}): React.JSX.Element {
  // Whether the label is cut short, measured whenever its box resizes: a
  // label renamed, or the plan's one tab giving way to its toolbar.
  const [clipped, setClipped] = useState(false);
  const words = useCallback((node: HTMLSpanElement | null) => {
    if (node === null) return;
    const observer = new ResizeObserver(() => setClipped(node.scrollWidth > node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const hint = !clipped ? tooltip : tooltip === undefined ? label : `${label} · ${tooltip}`;
  const glyph = (
    <span className="tab-icon">
      {icon}
      {unread ? <span className="tab-note" aria-hidden="true" /> : null}
    </span>
  );
  const tab = (
    <button
      ref={tabRef}
      type="button"
      role="tab"
      className="tab-button"
      aria-selected={selected}
      aria-keyshortcuts={keyshortcuts}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (onClose === undefined || !closesTab(event.key)) return;
        event.preventDefault();
        onClose();
      }}
    >
      {glyph}
      <span ref={words} className="tab-label">
        {label}
      </span>
    </button>
  );
  return (
    <div
      className="tab"
      data-selected={String(selected)}
      data-closable={String(onClose !== undefined)}
    >
      {editor === undefined ? (
        <Tooltip label={hint}>{tab}</Tooltip>
      ) : (
        <span className="tab-button" data-editing="true">
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
