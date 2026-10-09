import { CloseIcon } from "@sidecar/panel";
import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
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
 * Squeezed past holding its tabs whole, the strip stands compact: the
 * unchosen tabs stand as their glyphs alone, each naming itself in its hint,
 * and the chosen tab keeps its glyph, label, and ×, its label truncated.
 *
 * Its words are text, which the session recording masks with the rest.
 */

const TAB = '[role="tab"]';

/** Whether the strip stands compact, every tab but the chosen one its glyph alone. */
const Compact = createContext(false);

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

/**
 * Whether the strip's tabs overflow it drawn whole, marked on the strip for
 * the stylesheet. Note that the mark is taken down to measure and set again in
 * the same task, so the full layout it is read from is never painted.
 */
function fitTabs(strip: HTMLElement): boolean {
  strip.dataset.compact = "false";
  const compact = strip.scrollWidth > strip.clientWidth;
  strip.dataset.compact = String(compact);
  return compact;
}

/** What the strip says aloud of a tab moved: its label and the place it now stands. */
function movedLine(tab: HTMLElement | undefined, to: number, count: number): string {
  return `${tab?.textContent ?? "Tab"} moved to position ${to + 1} of ${count}`;
}

/**
 * The strip of tabs. Note that focus follows a tab closed from the keyboard
 * to the tab that took its place a render later, because the tab it was on
 * is gone by then; with none left, it goes on to the control after the
 * strip, the side panel's "+". `onMove`, while given, lets the tabs be
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
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const at = closedAt.current;
    if (at === undefined || strip.current === null) return;
    closedAt.current = undefined;
    const tabs = [...strip.current.querySelectorAll<HTMLElement>(TAB)];
    const after = strip.current.nextElementSibling;
    const next =
      tabs[Math.min(at, tabs.length - 1)] ?? (after instanceof HTMLElement ? after : null);
    next?.focus();
  });
  // Fitted again on every render, for a tab opened, closed, chosen, or
  // renamed, and whenever the row it stands in is resized.
  useLayoutEffect(() => {
    if (strip.current !== null) setCompact(fitTabs(strip.current));
  });
  useLayoutEffect(() => {
    const node = strip.current;
    const row = node?.parentElement;
    if (node === null || row === null || row === undefined) return;
    const observer = new ResizeObserver(() => setCompact(fitTabs(node)));
    observer.observe(row);
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
    tab.focus();
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
    tabs[next]?.focus();
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
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}
      >
        <Compact.Provider value={compact}>{children}</Compact.Provider>
      </div>
    </>
  );
}

/**
 * One tab. `onClose` gives it its × and its Delete key; a tab without it is
 * one that always stands. `editor`, while given, is drawn in the label's place
 * as a field of its own, outside the tab's role, so a reader reaches it.
 * Unchosen in a compact strip, the tab's hint is its label.
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
  const compact = useContext(Compact);
  const hint = compact && !selected ? label : tooltip;
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
      <span className="tab-label">{label}</span>
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
