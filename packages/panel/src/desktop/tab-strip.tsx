import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BUTTON_SIZE,
  CloseIcon,
  type ContextMenuProps,
  cssCustomProperties,
  IconButton,
  MENU_ALIGN,
  MENU_DROP,
  type MenuPlacement,
  opensMenu,
  useMenu,
} from "@luke/ui";
import { useClipped } from "@luke/ui/use-clipped";
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useAppCommand } from "../app-commands.js";
import { Tooltip } from "../tooltip.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { ROW_RUN, type RowPlace, withRowMoves } from "./row-moves.js";
import { type TabMove, useTabDrag } from "./use-tab-drag.js";

/**
 * tab-strip.tsx -- the window's one tab strip, drawn alike across the task's column and the side panel, the way an editor draws its tabs.
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
 * tab anchored at the strip's start, as the task's tab is in its column,
 * stands there for good, as a browser's pinned tab does: it is not moved,
 * and no tab is moved before it.
 *
 * A tab something arrived on while another was chosen reads in semibold
 * until it is chosen, the sidebar's convention for a task saved unseen,
 * rather than wearing a dot, and says "New result" in its hint and to a
 * reader.
 *
 * A tab with actions of its own offers them on a
 * right-click, or from the keyboard on the menu key or ⇧F10, hanging where
 * the pointer is or under the tab (`MenuTab`), and closing that menu hands
 * focus back to the tab.
 *
 * Every tab asks for an equal share of the strip, up to 200px, and gives
 * way by the same share as the strip narrows, as Safari's and Chrome's do; a
 * label cut short wears `data-overflow`, which desktop.css fades out at its
 * end, and is said whole in the tab's hint, or in the card a tab with more to
 * say hangs in its hint's place. Narrower than 72px, a tab other than the
 * chosen one stands as its glyph alone, so the others turn to glyphs
 * together, as Safari collapses its tab titles into icons; the chosen tab
 * keeps its glyph, its label, and its × at every width. Past holding every
 * glyph, the strip scrolls along with no bar drawn, a wheel turned up and
 * down running it sideways, with the chosen tab pinned at whichever edge it
 * would pass and a fade where tabs go on. All of that is the stylesheet's
 * (desktop.css): the strip measures nothing, and asks only for its tabs'
 * count, as `--tab-count`, so it may ask for room for every tab at its
 * widest. A tab chosen, or reached by the keyboard, is scrolled into its own
 * place, the strip's scroll alone and never the window's.
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

/** What an unread tab says in its hint and to a reader beyond its label. */
const UNREAD_TAB_NOTE = "New result";

/** The words a tab's hint joins: its label where it is cut short, what the tab adds, and its news. */
function tabHint(input: {
  label: string;
  /** Whether the label may not be read whole: cut short, or a tab other than the chosen one, which a narrow strip draws as its glyph alone. */
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
 * Scrolls the strip, and nothing around it, the least that shows `tab`'s
 * pill in its own place. Note that the place is read off the tab before it,
 * because the chosen tab is pinned at the strip's edges (desktop.css) and
 * reads where it is stuck rather than where it stands; the strip's scroll
 * behaviour, whether it glides, is the stylesheet's, and a pane sliding in
 * is never scrolled with it. A strip just drawn is put there at once, as a
 * page opens already scrolled.
 */
function reveal(strip: HTMLElement, tab: HTMLElement, glide = true): void {
  const pill = tab.closest<HTMLElement>(".tab") ?? tab;
  const before = pill.previousElementSibling;
  const style = getComputedStyle(strip);
  const start =
    before instanceof HTMLElement
      ? before.offsetLeft + before.offsetWidth + (Number.parseFloat(style.columnGap) || 0)
      : Number.parseFloat(style.paddingLeft) || 0;
  const end = start + pill.offsetWidth;
  if (start < strip.scrollLeft) scrollStrip(strip, start - strip.scrollLeft, glide);
  else if (end > strip.scrollLeft + strip.clientWidth) {
    scrollStrip(strip, end - strip.scrollLeft - strip.clientWidth, glide);
  }
}

/** Focus moved to a tab by the strip's own keys, which bring it into view with the strip's glide. */
function focusTab(strip: HTMLElement | null, tab: HTMLElement | undefined | null): void {
  tab?.focus({ preventScroll: true });
  if (strip !== null && tab !== undefined && tab !== null) reveal(strip, tab);
}

/**
 * Whether an event's target stands in the strip itself. Note that an event
 * from what a tab draws elsewhere, its menu or its ⋯ in the toolbar's slot,
 * reaches the strip's handlers too, because React bubbles it through the
 * portal to the tab that drew it, and none of it is a tab to scroll or move.
 */
function within(strip: HTMLElement, target: EventTarget): boolean {
  return target instanceof Node && strip.contains(target);
}

/** What the strip says aloud of a tab moved: its label and the place it now stands. */
function movedLine(tab: HTMLElement | undefined, to: number, count: number): string {
  return `${tab?.textContent ?? "Tab"} moved to position ${to + 1} of ${count}`;
}

/**
 * Where a tab of the strip around it stands among the tabs that move, read
 * from the strip as the tab's menu opens, which moves it one place either
 * way under a finger (`row-moves.tsx`); none in a strip whose tabs stay
 * put, or for the tab anchored at its start.
 */
const TabPlaceContext = createContext<((tab: HTMLElement) => RowPlace | undefined) | undefined>(
  undefined,
);

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
  // How many tabs the strip draws, which it asks room for at their widest (desktop.css).
  const count = Children.toArray(children).filter(isValidElement).length;
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
    const following = strip.current.nextElementSibling;
    const after = following?.matches("button") ? following : following?.querySelector("button");
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
  const placeOf =
    move === undefined
      ? undefined
      : (tab: HTMLElement): RowPlace | undefined => {
          const tabs = [...(strip.current?.querySelectorAll<HTMLElement>(MOVABLE_TAB) ?? [])];
          const at = tabs.indexOf(tab);
          return at < 0 ? undefined : { at, count: tabs.length, onMove: move };
        };
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
    if (!within(node, event.target)) return;
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
        <span className="luke-visually-hidden" role="status">
          {movedSaid}
        </span>
      )}
      <div
        ref={strip}
        role="tablist"
        aria-label={label}
        className={className ? `tab-strip ${className}` : "tab-strip"}
        style={cssCustomProperties({ "--tab-count": count })}
        onKeyDown={keyDown}
        onPointerDown={onPointerDown}
        onWheel={wheel}
        onFocus={(event) => {
          if (within(event.currentTarget, event.target)) setFocused(true);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}
      >
        <TabPlaceContext.Provider value={placeOf}>{children}</TabPlaceContext.Provider>
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
 * name itself. `contextMenu` (`useMenu`'s) opens the tab's own actions
 * from a right-click or a long press, and `onMenu` opens them where it
 * says from the keyboard's menu keys. A `quiet` tab draws no fill at
 * rest, chosen or not, and the hover fill under the pointer: a lone tab,
 * always the chosen one, need not be told from the others. An `anchored`
 * tab stands at the strip's start for good, never moved.
 */
export function Tab({
  icon,
  label,
  detail,
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
  contextMenu,
  onMenu,
}: {
  icon: React.JSX.Element;
  label: string;
  /** Words after the label, dimmed: a count, as the Inbox tab's. */
  detail?: string | undefined;
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
  tabRef?: React.RefObject<HTMLButtonElement | null> | undefined;
  quiet?: boolean;
  anchored?: boolean;
  onSelect: () => void;
  onClose?: (() => void) | undefined;
  contextMenu?: ContextMenuProps | undefined;
  onMenu?: ((placement: MenuPlacement, opener: HTMLElement) => void) | undefined;
}): React.JSX.Element {
  // Whether the label is cut short: a label renamed, or the task's one tab
  // giving way to its toolbar.
  const [words, clipped] = useClipped(detail === undefined ? label : `${label} ${detail}`);
  // Note that a tab other than the chosen one is named in its hint whether or
  // not its label shows, because a narrow strip draws it as its glyph alone
  // (desktop.css), which the label's own measure cannot see.
  const hint = tabHint({ label, clipped: clipped || !selected, tooltip, unread });
  const own = useRef<HTMLButtonElement | null>(null);
  const button = tabRef ?? own;
  const glyph = <span className="tab-icon">{icon}</span>;
  const tab = (
    <button
      ref={button}
      type="button"
      role="tab"
      className="tab-button"
      aria-selected={selected}
      aria-keyshortcuts={keyshortcuts}
      aria-description={unread ? UNREAD_TAB_NOTE : undefined}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      {...contextMenu}
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
        {detail === undefined ? null : (
          <>
            {" "}
            <span className="tab-detail">{detail}</span>
          </>
        )}
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
        <span className="tab-button" data-editing="true">
          {glyph}
          <span className="tab-rename">{editor}</span>
        </span>
      )}
      {onClose === undefined || editor !== undefined ? null : (
        <span className="tab-close">
          <IconButton
            icon={<CloseIcon />}
            label={`Close ${label}`}
            size={BUTTON_SIZE.COMPACT}
            tabbable={false}
            onClick={onClose}
          />
        </span>
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
}: Omit<React.ComponentProps<typeof Tab>, "contextMenu" | "onMenu"> & {
  groups: MenuAction[][];
}): React.JSX.Element {
  const menu = useMenu(true);
  const placeOf = useContext(TabPlaceContext);
  return (
    <>
      <Tab
        {...tab}
        onSelect={() => {
          menu.close(false);
          tab.onSelect();
        }}
        // A menu key the system turned into a right-click says no point of its own, and hangs the menu under the whole tab.
        contextMenu={menu.contextMenu(undefined, underTab)}
        onMenu={menu.show}
      />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${tab.label} actions`}
          menu={menu.drawn}
          groups={withRowMoves(groups, placeOf?.(menu.drawn.opener), ROW_RUN.ALONG)}
          onClose={menu.close}
        />
      )}
    </>
  );
}
