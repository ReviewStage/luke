import { CloseIcon } from "@sidecar/panel";
import { useLayoutEffect, useRef } from "react";
import { Tooltip } from "../tooltip";

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
 * Its words are text, which the session recording masks with the rest.
 */

const TAB = '[role="tab"]';

/** The tab a navigation key moves to from the focused one, or nothing for any other key. */
function tabAfter(key: string, at: number, count: number): number | undefined {
  switch (key) {
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
 * The strip of tabs. Note that focus follows a tab closed from the keyboard
 * to the tab that took its place a render later, because the tab it was on
 * is gone by then; with none left, it goes on to the control after the
 * strip, the side panel's "+".
 */
export function TabStrip({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const strip = useRef<HTMLDivElement | null>(null);
  // Where a tab was closed from the keyboard, until focus has moved on from it.
  const closedAt = useRef<number | undefined>(undefined);
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

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>(TAB)];
    const at = event.target instanceof HTMLElement ? tabs.indexOf(event.target) : -1;
    if (at < 0) return;
    if (closesTab(event.key)) {
      closedAt.current = at;
      return;
    }
    const next = tabAfter(event.key, at, tabs.length);
    if (next === undefined) return;
    event.preventDefault();
    tabs[next]?.focus();
  };

  return (
    <div
      ref={strip}
      role="tablist"
      aria-label={label}
      className={className ? `tab-strip ${className}` : "tab-strip"}
      onKeyDown={keyDown}
    >
      {children}
    </div>
  );
}

/**
 * One tab. `onClose` gives it its × and its Delete key; a tab without it is
 * one that always stands. `editor`, while given, is drawn in the label's place
 * as a field of its own, outside the tab's role, so a reader reaches it.
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
  const glyph = <span className="tab-icon">{icon}</span>;
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
      {unread ? <span className="tab-note" aria-hidden="true" /> : null}
    </button>
  );
  return (
    <div
      className="tab"
      data-selected={String(selected)}
      data-closable={String(onClose !== undefined)}
    >
      {editor === undefined ? (
        tooltip === undefined ? (
          tab
        ) : (
          <Tooltip label={tooltip}>{tab}</Tooltip>
        )
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
