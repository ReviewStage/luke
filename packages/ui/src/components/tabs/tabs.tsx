import type {
  ComponentType,
  FocusEventHandler,
  MouseEventHandler,
  PointerEventHandler,
  ReactElement,
  ReactNode,
  Ref,
  RefObject,
} from "react";
import {
  Children,
  isValidElement,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { cssCustomProperties } from "../../css.js";
import { CloseIcon } from "../../face/glyphs.js";
import { PRESS_PULSE, pulseOnPress, pulsePress } from "../../press-pulse.js";
import { useClipped } from "../../use-clipped.js";
import { BUTTON_SIZE, IconButton } from "../button/button.js";
import {
  type ContextMenuProps,
  MENU_ALIGN,
  MENU_DROP,
  type MenuPlacement,
  opensMenu,
} from "../menu/menu.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { type TabMove, useTabDrag } from "./use-tab-drag.js";

/**
 * tabs.tsx -- a strip of tabs, the way an editor draws its tabs, and the cards a recent-tabs switcher steps through.
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
 * along it (`use-tab-drag.ts`), or the focused one stepped a place either
 * way by the owner's own chords through `controls`, with focus kept on it.
 * Either way the strip says where the tab now stands to whoever reads it
 * aloud. A tab anchored at the strip's start stands there for good, as a
 * browser's pinned tab does: it is not moved, and no tab is moved before it.
 *
 * A tab something arrived on while another was chosen reads in semibold
 * until it is chosen, and says "New result" in its hint and to a reader. A
 * tab with actions of its own offers them on a right-click (`contextMenu`,
 * `useMenu`'s), or from the keyboard on the menu key or ⇧F10 (`onMenu`),
 * hung under the tab.
 *
 * Every tab asks for an equal share of the strip, up to 200px, and gives
 * way by the same share as the strip narrows; a label cut short wears
 * `data-overflow`, which fades out at its end, and is said whole in the
 * tab's hint, or in the card a tab with more to say hangs in its hint's
 * place. Past holding every tab, the strip scrolls along with no bar drawn,
 * a wheel turned up and down running it sideways, with the chosen tab pinned
 * at whichever edge it would pass and a fade where tabs go on. All of that
 * is the stylesheet's (tabs.css): the strip measures nothing, and asks only
 * for its tabs' count, as `--luke-tab-count`, so it may ask for room for
 * every tab at its widest. A narrow tab other than the chosen one stands as
 * its glyph alone, or keeps a short label while the strip scrolls, as its
 * owner's `fold` says. A tab chosen, or reached by
 * the keyboard, is scrolled into its own place, the strip's scroll alone and
 * never the window's.
 *
 * A TabCard is one screen among a switcher's recent ones, in a row of them
 * (`TabCards`): a still of it, or its glyph large until it has one, its name,
 * and where it stands. The keys stay where they were while a switcher is
 * held, so a card takes no stop; the pointer resting on it chooses it, and a
 * press picks it, on the press itself where the switcher's chord makes the
 * release a right-click (`pickOnPress`). The still is a picture of the
 * window, so the session recording leaves it out by its class.
 *
 * Its words are text, which the session recording masks with the rest.
 */

const TAB = '[role="tab"]';

/** A tab that moves: every one but those anchored at the strip's start. */
const MOVABLE_TAB = `.luke-tab:not([data-anchored="true"]) ${TAB}`;

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

/** The ground a strip stands on, which its fades and its pinned tab paint over the tabs passing beneath. */
export const TABS_GROUND = {
  /** A side panel's well. */
  WELL: "well",
  /** A column's own ground. */
  GROUND: "ground",
} as const;

export type TabsGround = (typeof TABS_GROUND)[keyof typeof TABS_GROUND];

/** How a tab other than the chosen one gives way once the strip is narrow. */
export const TABS_FOLD = {
  /** Narrower than 72px it stands as its glyph alone, its hint naming it, as Safari collapses its tab titles into icons. */
  GLYPH: "glyph",
  /** It keeps a short label, at least 96px, and the strip scrolls along instead, as a phone's browser scrolls its tabs: a finger has no hint to name a glyph. On a screen with no hover its × gives its place to the label, its Close standing in its menu. */
  LABEL: "label",
} as const;

export type TabsFold = (typeof TABS_FOLD)[keyof typeof TABS_FOLD];

export type { TabMove };

/** Where a tab stands among the tabs that move, and the move that takes it elsewhere. */
export interface TabPlace {
  readonly at: number;
  readonly count: number;
  readonly onMove: TabMove;
}

/** What a strip's owner reaches it by: the focused tab stepped along, and where a tab stands. */
export interface TabsControls {
  /** Moves the focused tab `by` places along, keeping focus on it; nothing where no tab that moves has focus, or past an end. */
  readonly step: (by: number) => void;
  /** Where `tab`, a tab of the strip, stands among the tabs that move; none for one anchored, or a strip whose tabs stay put. */
  readonly placeOf: (tab: HTMLElement) => TabPlace | undefined;
}

/** What an app's hint hands the tab it wraps: when to show and go, and the chord it names. */
interface TabHintProps {
  "aria-describedby"?: string | undefined;
  "aria-keyshortcuts"?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onClick?: MouseEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
}

/**
 * The app's hint a tab hangs: its words, or a card in their place, over the
 * tab it wraps. It must stay one component across renders, so the tab it
 * wraps stays one tab.
 */
export type TabHint = ComponentType<{
  label: string | undefined;
  card?: ReactNode;
  children: ReactElement<TabHintProps>;
}>;

/** The words a tab's hint joins: its label where it is cut short, what the tab adds, and its news. */
function tabHint(input: {
  label: string;
  /** Whether the label may not be read whole: cut short, or a tab other than the chosen one, which a narrow strip may draw as its glyph alone. */
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
 * other key. Note that a key held with a modifier moves nothing, because an
 * owner's chords move the tab itself rather than focus.
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
 * because the chosen tab is pinned at the strip's edges (tabs.css) and
 * reads where it is stuck rather than where it stands; the strip's scroll
 * behaviour, whether it glides, is the stylesheet's, and a pane sliding in
 * is never scrolled with it. A strip just drawn is put there at once, as a
 * page opens already scrolled.
 */
function reveal(strip: HTMLElement, tab: HTMLElement, glide = true): void {
  const pill = tab.closest<HTMLElement>(".luke-tab") ?? tab;
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
 * from what a tab draws elsewhere, its menu or an action in a toolbar's
 * slot, reaches the strip's handlers too, because React bubbles it through
 * the portal to the tab that drew it, and none of it is a tab to scroll or
 * move.
 */
function within(strip: HTMLElement, target: EventTarget): boolean {
  return target instanceof Node && strip.contains(target);
}

/** What the strip says aloud of a tab moved: its label and the place it now stands. */
function movedLine(tab: HTMLElement | undefined, to: number, count: number): string {
  return `${tab?.textContent ?? "Tab"} moved to position ${to + 1} of ${count}`;
}

/** Where a tab's menu hangs when the keyboard asks for it, or a right-click that names no point: under the tab, from its start. */
export function tabMenuPlacement(tab: HTMLElement): MenuPlacement {
  const bounds = (tab.closest(".luke-tab") ?? tab).getBoundingClientRect();
  return { x: bounds.left, y: bounds.bottom + MENU_DROP, align: MENU_ALIGN.START };
}

/** The strip's tabs that move, in order. */
function movableTabs(strip: HTMLElement | null): HTMLElement[] {
  return [...(strip?.querySelectorAll<HTMLElement>(MOVABLE_TAB) ?? [])];
}

/**
 * The strip of tabs. Note that focus follows a tab closed from the keyboard
 * to the tab that took its place a render later, because the tab it was on
 * is gone by then; with none left, it goes on to the button after the
 * strip, or the first in what follows it. `onMove`, while given, lets the
 * tabs be moved, and hears each move as the tab's place before and after
 * it, counted among the tabs that move. `onFocusChange` hears whether one
 * of its tabs has the focus, the one `controls`' step moves.
 */
export function Tabs({
  label,
  ground = TABS_GROUND.WELL,
  fold = TABS_FOLD.GLYPH,
  onMove,
  onFocusChange,
  controls,
  children,
}: {
  label: string;
  ground?: TabsGround | undefined;
  fold?: TabsFold | undefined;
  onMove?: TabMove | undefined;
  onFocusChange?: ((focused: boolean) => void) | undefined;
  controls?: Ref<TabsControls> | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const strip = useRef<HTMLDivElement | null>(null);
  // How many tabs the strip draws, which it asks room for at their widest (tabs.css).
  const count = Children.toArray(children).filter(isValidElement).length;
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
          const tabs = movableTabs(strip.current);
          setMovedSaid(movedLine(tabs[from], to, tabs.length));
          onMove(from, to);
        };
  const onPointerDown = useTabDrag(move);
  useImperativeHandle(controls, () => ({
    // The focused tab one place along, drawn there before focus is put back
    // on it, since moving it in the document can take focus from it.
    step: (by: number) => {
      const tabs = movableTabs(strip.current);
      const tab = tabs.find((each) => each === document.activeElement);
      const at = tab === undefined ? -1 : tabs.indexOf(tab);
      if (tab === undefined || move === undefined || at + by < 0 || at + by >= tabs.length) return;
      flushSync(() => move(at, at + by));
      focusTab(strip.current, tab);
    },
    placeOf: (tab: HTMLElement): TabPlace | undefined => {
      if (move === undefined) return undefined;
      const tabs = movableTabs(strip.current);
      const at = tabs.indexOf(tab);
      return at < 0 ? undefined : { at, count: tabs.length, onMove: move };
    },
  }));

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>(TAB)];
    const at = event.target instanceof HTMLElement ? tabs.indexOf(event.target) : -1;
    if (at < 0) return;
    if (closesTab(event.key)) {
      // Only a tab that closes hands focus on; one that always stands stays.
      const pill = event.target instanceof HTMLElement ? event.target.closest(".luke-tab") : null;
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
        className="luke-tabs"
        data-ground={ground}
        data-fold={fold}
        style={cssCustomProperties({ "--luke-tab-count": count })}
        onKeyDown={keyDown}
        onPointerDown={onPointerDown}
        onWheel={wheel}
        onFocus={(event) => {
          if (within(event.currentTarget, event.target)) onFocusChange?.(true);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) onFocusChange?.(false);
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
 * model's effort follows its name. `endMark`, while given, stands at the
 * tab's end in its ×'s place, with room kept for it, and gives way to the ×
 * under the pointer, as an editor's tab trades its unsaved dot for its ×.
 * `editor`, while given, is drawn in the label's place as a field of its
 * own, outside the tab's role, so a reader reaches it. A label cut short is
 * said whole in the tab's `hint`, before what `tooltip` adds and an unread
 * tab's news; `card`, while given, hangs in the hint's place whether or not
 * the label is cut short, and says the whole name itself. `contextMenu`
 * (`useMenu`'s) opens the tab's own actions from a right-click or a long
 * press, and `onMenu` opens them where it says from the keyboard's menu
 * keys. A `quiet` tab draws no fill at rest, chosen or not, and the hover
 * fill under the pointer: a lone tab, always the chosen one, need not be
 * told from the others. An `anchored` tab stands at the strip's start for
 * good, never moved.
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
  hint: Hint,
  keyshortcuts,
  editor,
  tabRef,
  quiet = false,
  anchored = false,
  preview = false,
  onSelect,
  onKeep,
  onClose,
  contextMenu,
  onMenu,
}: {
  icon: React.JSX.Element;
  label: string;
  /** Words after the label, dimmed: a count, as an Inbox tab's. */
  detail?: string | undefined;
  /** A mark at the tab's end, in its ×'s place until the pointer comes over it: a failed run's. */
  endMark?: React.JSX.Element | undefined;
  selected: boolean;
  /** Something arrived on the tab while another was chosen: its label in semibold until it is chosen. */
  unread?: boolean;
  /** What the pointer resting on the tab says beyond its label. */
  tooltip?: string | undefined;
  /** What the pointer resting on the tab shows in its hint's place: a card naming it whole and saying what it last did. */
  card?: ReactNode;
  /** The app's hint the tab hangs its words or its card from; none drawn where absent. */
  hint?: TabHint | undefined;
  keyshortcuts?: string | undefined;
  editor?: ReactNode;
  tabRef?: RefObject<HTMLButtonElement | null> | undefined;
  quiet?: boolean;
  anchored?: boolean;
  /** Stands as its strip's preview, which the next one opened takes the place of: its label in italics, as VS Code draws one. */
  preview?: boolean;
  onSelect: () => void;
  /** Keeps a preview as a tab of its own, as a double-click on it asks. */
  onKeep?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  contextMenu?: ContextMenuProps | undefined;
  onMenu?: ((placement: MenuPlacement, opener: HTMLElement) => void) | undefined;
}): React.JSX.Element {
  // Whether the label is cut short: a label renamed, or a lone tab giving
  // way to the toolbar beside it.
  const [words, clipped] = useClipped(detail === undefined ? label : `${label} ${detail}`);
  // Note that a tab other than the chosen one is named in its hint whether or
  // not its label shows, because a narrow strip may draw it as its glyph
  // alone, which the label's own measure cannot see.
  const said = tabHint({ label, clipped: clipped || !selected, tooltip, unread });
  const own = useRef<HTMLButtonElement | null>(null);
  const button = tabRef ?? own;
  const glyph = <span className="luke-tab-icon">{icon}</span>;
  const tab = (
    <button
      ref={button}
      type="button"
      role="tab"
      className="luke-tab-button"
      aria-selected={selected}
      aria-keyshortcuts={keyshortcuts}
      aria-description={unread ? UNREAD_TAB_NOTE : undefined}
      tabIndex={selected ? 0 : -1}
      onClick={(event) => {
        // Note that the tab around the button is the pill a press is seen on.
        pulsePress(event.currentTarget.closest<HTMLElement>(".luke-tab") ?? event.currentTarget);
        onSelect();
      }}
      onDoubleClick={preview ? onKeep : undefined}
      {...contextMenu}
      onKeyDown={(event) => {
        if (onMenu !== undefined && opensMenu(event)) {
          event.preventDefault();
          onMenu(tabMenuPlacement(event.currentTarget), event.currentTarget);
          return;
        }
        if (onClose === undefined || !closesTab(event.key)) return;
        event.preventDefault();
        onClose();
      }}
    >
      {glyph}
      <span ref={words} className="luke-tab-label" data-overflow={String(clipped)}>
        {label}
        {detail === undefined ? null : (
          <>
            {" "}
            <span className="luke-tab-detail">{detail}</span>
          </>
        )}
      </span>
      {endMark === undefined ? null : <span className="luke-tab-end-mark">{endMark}</span>}
    </button>
  );
  const hung =
    Hint === undefined ? (
      tab
    ) : (
      <Hint label={card === undefined ? said : label} card={card}>
        {tab}
      </Hint>
    );
  return (
    <div
      className="luke-tab"
      data-selected={String(selected)}
      data-closable={String(onClose !== undefined)}
      data-quiet={String(quiet)}
      data-anchored={String(anchored)}
      data-preview={String(preview)}
      data-unread={String(unread)}
      data-marked={String(endMark !== undefined)}
    >
      {editor === undefined ? (
        hung
      ) : (
        <span className="luke-tab-button" data-editing="true">
          {glyph}
          <span className="luke-tab-rename">{editor}</span>
        </span>
      )}
      {onClose === undefined || editor !== undefined ? null : (
        <span className="luke-tab-close">
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

/** A switcher's row of cards, one listbox the switcher's own keys steer. */
export function TabCards({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="luke-tab-cards" role="listbox" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * One card: its still or its glyph, its name, and where it stands. `here`
 * dims the card of the screen already on show. `onPoint` hears the pointer
 * come onto it, and `onPick` a press on it: on the press itself where
 * `pickOnPress`, for a switcher held on ⌃, which a Mac makes a release a
 * right-click of, taking no Tab stop; or on the click otherwise, with a Tab
 * stop of its own, and Return or Space while it has the focus.
 */
export function TabCard({
  icon,
  label,
  detail,
  detailIcon,
  endMark,
  still,
  here = false,
  chosen,
  pickOnPress = false,
  onPoint,
  onPick,
}: {
  icon: ReactNode;
  label: string;
  /** Where it stands, under its name: a task and its strip; the line stands empty where absent, so every card is one height. */
  detail?: string | undefined;
  /** The glyph before the detail's words. */
  detailIcon?: ReactNode;
  /** A mark after the detail's words, or alone where there are none. */
  endMark?: ReactNode;
  /** A picture of the screen, by its address; its glyph, large, until it has one. */
  still?: string | undefined;
  here?: boolean | undefined;
  chosen: boolean;
  pickOnPress?: boolean | undefined;
  onPoint: () => void;
  onPick: () => void;
}): React.JSX.Element {
  return (
    <div
      role="option"
      aria-selected={chosen}
      // Note that a card picked on the press takes no stop of its own, because
      // the keys stay where they were while a switcher is held; one picked on
      // the click is a Tab stop, so the keys reach it.
      tabIndex={pickOnPress ? -1 : 0}
      className="luke-tab-card"
      data-here={here}
      onPointerEnter={onPoint}
      onPointerDown={
        pickOnPress
          ? (event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              pulsePress(event.currentTarget, PRESS_PULSE.QUIET);
              onPick();
            }
          : undefined
      }
      onClick={pickOnPress ? undefined : pulseOnPress(onPick, PRESS_PULSE.QUIET)}
      // Note that a card handed the focus is picked by Return or Space, as a press on it picks it.
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onPick();
      }}
      onContextMenu={pickOnPress ? (event) => event.preventDefault() : undefined}
    >
      <div className="luke-tab-card-preview ph-no-capture">
        {still === undefined ? (
          <span className="luke-tab-card-glyph">{icon}</span>
        ) : (
          <img className="luke-tab-card-still" src={still} alt="" draggable={false} />
        )}
      </div>
      <div className="luke-tab-card-name">
        {icon}
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL}>
          {label}
        </Text>
      </div>
      <div className="luke-tab-card-detail">
        {detail === undefined ? null : (
          <>
            {detailIcon}
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
              {detail}
            </Text>
          </>
        )}
        {endMark}
      </div>
    </div>
  );
}
