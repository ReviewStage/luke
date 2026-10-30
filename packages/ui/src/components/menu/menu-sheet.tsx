import { useCallback, useId, useRef } from "react";
import { BackButton, NO_BACK_KEY } from "../back-button/back-button.js";
import { DIALOG_SIZE, Dialog } from "../dialog/dialog.js";
import { OneLine } from "../one-line/one-line.js";

/**
 * menu-sheet.tsx -- the sheet a menu rises as in a phone's layout: a dialog on the window's foot, its grip, and its head, swiped down to go.
 *
 * `Menu`'s sheet (`menu.tsx`'s `MenuSheet`) and `SearchableMenu`'s draw
 * their rows in this one frame: a dialog (`DIALOG_SIZE.SHEET`) risen from
 * the window's foot over the dimmed window, the page under it unmoved, and
 * in it a head that stays put over what scrolls under it. The head holds a
 * grip a finger swipes the sheet down by, the sheet's name and a muted line
 * under it, a mark before them where what the menu acts on has one, a way
 * back in the mark's place where a submenu stands in the sheet's place, and
 * under them, where the menu has one, its search field. What stands under
 * the head is the menu's own, at a finger's height (`menu.css`). Escape, a
 * press on the dimmed window, or a swipe down asks it away (`onAway`); its
 * owner holds it drawn through its exit, waiting on the dialog's card
 * (`hold`), whose fade is what plays as the sheet goes.
 */

/** The attribute the document's root wears the room it stands in, and the room a phone's layout is (the panel's `stage-room.ts`). */
const ROOM_ATTRIBUTE = "data-luke-room";
const NARROW_ROOM = "narrow";

/**
 * How a finger swiping a sheet down puts it away: let go past this share of
 * its height, or flicked faster than this, in CSS pixels a millisecond.
 */
const SHEET_SWIPE = {
  SHARE: 0.25,
  FLICK: 0.5,
} as const;

/** What in a sheet's head keeps a finger's press as its own rather than starting a swipe: a button, and the search field. */
const HEAD_CONTROL = "button, label, input";

/** A finger holding a sheet's head: which, where it last stood and when, how far down it has drawn the sheet, and how fast. */
interface SheetDrag {
  readonly pointerId: number;
  readonly from: number;
  at: number;
  down: number;
  speed: number;
}

/** A way back out of a submenu standing in the sheet's place: the page it goes back to, which names it to a reader, and its press. */
export interface SheetBack {
  readonly label: string;
  readonly onBack: () => void;
}

/**
 * A sheet swiped down by its head, following the finger and put away as
 * it is let go past `SHEET_SWIPE`, or sprung back short of it. Only a
 * finger swipes, and never from a control in the head, a button or the
 * search field, which keeps its own press. The sheet follows on its own
 * `translate`, its transition off while held (`data-dragging`), so no
 * render runs per move.
 */
function useSheetSwipe(onAway: () => void) {
  const sheet = useRef<HTMLDivElement | null>(null);
  const drag = useRef<SheetDrag | null>(null);
  const follow = (down: number, held: boolean) => {
    const element = sheet.current;
    if (element === null) return;
    element.style.translate = down === 0 ? "" : `0 ${down}px`;
    element.toggleAttribute("data-dragging", held);
  };
  const letGo = (event: React.PointerEvent<HTMLElement>, away: boolean) => {
    const held = drag.current;
    if (held === null || held.pointerId !== event.pointerId) return;
    drag.current = null;
    const height = sheet.current?.getBoundingClientRect().height ?? 0;
    const far = held.down > height * SHEET_SWIPE.SHARE || held.speed > SHEET_SWIPE.FLICK;
    // Note that a sheet put away sinks on from where the finger left it.
    follow(away && far ? held.down : 0, false);
    if (away && far) onAway();
  };
  const head = {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") return;
      if (event.target instanceof Element && event.target.closest(HEAD_CONTROL) !== null) return;
      drag.current = {
        pointerId: event.pointerId,
        from: event.clientY,
        at: event.timeStamp,
        down: 0,
        speed: 0,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const held = drag.current;
      if (held === null || held.pointerId !== event.pointerId) return;
      const down = Math.max(0, event.clientY - held.from);
      const elapsed = event.timeStamp - held.at;
      if (elapsed > 0) held.speed = (down - held.down) / elapsed;
      held.down = down;
      held.at = event.timeStamp;
      follow(down, true);
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => letGo(event, true),
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => letGo(event, false),
  };
  return { sheet, head };
}

/** Whether the window stands in a phone's layout now, where a menu rises as a sheet. */
export function inNarrowRoom(): boolean {
  return document.documentElement.getAttribute(ROOM_ATTRIBUTE) === NARROW_ROOM;
}

/** The sheet: its dialog, its head, and what the menu draws under the head. */
export function MenuSheetFrame({
  id,
  open,
  opener,
  initialFocus,
  hold,
  name,
  detail,
  mark,
  back,
  field,
  onAway,
  onKeyDown,
  children,
}: {
  /** The sheet's id, which its trigger's `aria-controls` names, where the menu's own list does not carry it. */
  id?: string | undefined;
  /** Whether it stands; falling, it sinks out before it goes. */
  open: boolean;
  /** What opened it, which takes focus back once it is gone; whatever held focus as it opened where none is said. */
  opener?: HTMLElement | undefined;
  /** What takes focus as it opens: a row of the menu's, or its list. */
  initialFocus: React.RefObject<HTMLElement | null>;
  /** Hands the dialog's card to the hold its owner draws the sheet through its exit with. */
  hold?: ((card: HTMLElement | null) => void) | undefined;
  /** What the head names: what the menu acts on, the menu itself, or the submenu standing in its place. */
  name: string;
  /** The muted line under the name: what the menu acts on is, or the menu a submenu was opened from. */
  detail?: string | undefined;
  /** What the menu acts on's mark, decoration before its name. */
  mark?: React.ReactNode;
  /** The way back out of a submenu standing in the sheet's place, drawn in the mark's. */
  back?: SheetBack | undefined;
  /** What stands under the name in the head, where the scrolling cannot take it: the menu's search field. */
  field?: React.ReactNode;
  /** Escape, a press on the dimmed window, or a swipe down. */
  onAway: () => void;
  /** The menu's own keys heard anywhere in the sheet, after Tab and Escape (`Dialog`'s). */
  onKeyDown?: ((event: React.KeyboardEvent<HTMLDivElement>) => void) | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const nameId = useId();
  const { sheet, head } = useSheetSwipe(onAway);
  // Note that the dialog's card is what the menu's exit is waited on, since its fade is what plays as the sheet goes.
  const framed = useCallback(
    (node: HTMLDivElement | null) => {
      sheet.current = node;
      hold?.(node?.closest<HTMLElement>(".luke-dialog") ?? null);
    },
    [sheet, hold],
  );
  return (
    <Dialog
      open={open}
      size={DIALOG_SIZE.SHEET}
      labelledBy={nameId}
      invoker={opener}
      initialFocus={initialFocus}
      onDismiss={onAway}
      onKeyDown={onKeyDown}
    >
      <div ref={framed} id={id} className="luke-menu-sheet">
        <div className="luke-menu-sheet-head" {...head}>
          <span className="luke-menu-sheet-grip" aria-hidden="true" />
          <div className="luke-menu-sheet-title">
            {back === undefined ? null : (
              <span className="luke-menu-sheet-back">
                <BackButton
                  label={back.label}
                  place={back.label}
                  command={NO_BACK_KEY}
                  onBack={back.onBack}
                />
              </span>
            )}
            {back === undefined && mark !== undefined ? (
              <span className="luke-menu-sheet-mark" aria-hidden="true">
                {mark}
              </span>
            ) : null}
            <span className="luke-menu-sheet-words">
              <span id={nameId} className="luke-menu-sheet-name">
                <OneLine>{name}</OneLine>
              </span>
              {detail === undefined ? null : (
                <span className="luke-menu-sheet-detail">
                  <OneLine>{detail}</OneLine>
                </span>
              )}
            </span>
          </div>
          {field === undefined || field === null ? null : (
            <div className="luke-menu-sheet-field">{field}</div>
          )}
        </div>
        {children}
      </div>
    </Dialog>
  );
}
