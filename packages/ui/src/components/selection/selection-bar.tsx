import { SELECTION_WORDS, selectedWords } from "@luke/features/words";
import { type FocusEvent, type KeyboardEvent, useId, useLayoutEffect, useRef } from "react";
import { ANNOUNCE, useAnnounce } from "../announcer/announcer.js";
import { Button } from "../button/button.js";
import { Menu, type MenuAction, useMenu } from "../menu/menu.js";
import { focusRovingStop, ROVING_ORIENTATION, useRovingKeys } from "../roving-keys/roving-keys.js";
import { focusChoosable } from "./list-selection.js";

/**
 * selection-bar.tsx -- the bar over a list while some of its rows are chosen: how many ("3 selected"), the acts that take them all at once, and Clear.
 *
 * It stands only while a row is chosen, and draws nothing once none is, so
 * a list's owner draws it beside the list whatever the count. The count
 * leads it and is said politely through the window's `Announcer` as it
 * changes, the first row chosen included, so a reader choosing rows by the
 * keys hears how many they hold. The acts follow in the order handed, each
 * a labelled button that does its act on every chosen row, or drops a menu
 * of choices where the act is one of several (a status, a section); Clear,
 * last, chooses none, as Esc does in the list and in the bar alike.
 *
 * The bar is a toolbar (`useRovingKeys`): Tab stops on it once, ←→ walk
 * its buttons. It names the list it acts on (`controls`), and where the
 * bar held the focus as the last row left the selection, by Clear, Esc,
 * or an act that took the rows away, it hands the focus to that list's
 * Tab stop, or a `SelectionRegion`'s first row, rather than let it fall to
 * the page as its buttons go.
 *
 * It is drawn in the Tailwind theme's utilities: one line on the surface
 * inside a hairline, the count in the label's type with even digits, the
 * acts wrapping after it, and a control's gap between each.
 */

/**
 * One act of the bar: its words, its glyph, and either what it does or the
 * menu of choices it drops, which a chosen row's menu offers as a submenu
 * (`selectionMenu`), so a choice is an action rather than a submenu of its own.
 */
export type SelectionAct = {
  readonly label: string;
  readonly icon?: React.JSX.Element;
} & (
  | { readonly onAct: () => void; readonly menu?: undefined }
  | { readonly menu: readonly (readonly MenuAction[])[]; readonly onAct?: undefined }
);

/** An act that drops a menu of choices under its button. */
function MenuAct({
  act,
  menu,
}: {
  act: SelectionAct;
  menu: readonly (readonly MenuAction[])[];
}): React.JSX.Element {
  const drop = useMenu(true);
  return (
    <>
      <Button roving icon={act.icon} {...drop.trigger()}>
        {act.label}
      </Button>
      {drop.drawn === undefined ? null : (
        <Menu label={act.label} menu={drop.drawn} groups={menu} onClose={drop.close} />
      )}
    </>
  );
}

/** The bar over a list holding `count` chosen rows: the count, `acts`, and Clear; nothing while none is chosen. */
export function SelectionBar({
  count,
  acts,
  onClear,
  controls,
}: {
  /** How many rows are chosen. */
  count: number;
  /** What may be done to every chosen row at once, in the order drawn. */
  acts: readonly SelectionAct[];
  /** Chooses none, as Clear and Esc do. */
  onClear: () => void;
  /** The id of the list whose rows it acts on (`List`'s `id`), which takes the focus once the bar goes. */
  controls: string;
}): React.JSX.Element | null {
  const roving = useRovingKeys<HTMLDivElement>({ orientation: ROVING_ORIENTATION.HORIZONTAL });
  const countId = useId();
  useAnnounce(ANNOUNCE.POLITE, count > 0 ? selectedWords(count) : "");
  // Whether the focus stands in the bar, or stood there as its buttons went.
  const holding = useRef(false);
  useLayoutEffect(() => {
    if (count > 0 || !holding.current) return;
    holding.current = false;
    // Note that only a focus fallen to the page is handed on, never one something else took.
    const fell = document.activeElement === null || document.activeElement === document.body;
    const list = document.getElementById(controls);
    // Note that a region of the app's own rows keeps no roving Tab stop, so its first row takes the focus instead.
    if (fell && list !== null && !focusRovingStop(list)) focusChoosable(list);
  }, [count, controls]);
  if (count <= 0) return null;
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    holding.current = true;
    roving.onFocus(event);
  };
  // Note that a button taken away blurs with nowhere to go, so only a focus moved somewhere lets go.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const to = event.relatedTarget;
    if (to instanceof Node && !event.currentTarget.contains(to)) holding.current = false;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (roving.onKeyDown(event) || event.defaultPrevented) return;
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    onClear();
  };
  return (
    <div
      {...roving}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      role="toolbar"
      aria-labelledby={countId}
      aria-controls={controls}
      className="luke-selection-bar box-border flex min-w-0 items-center gap-control-gap rounded-control border border-border bg-surface py-tight-gap pr-tight-gap pl-list-inset font-ui text-foreground"
    >
      <span
        id={countId}
        className="luke-selection-bar-count flex-none text-label font-label tabular-nums"
      >
        {selectedWords(count)}
      </span>
      <div className="luke-selection-bar-acts flex min-w-0 flex-auto flex-wrap items-center gap-control-gap">
        {acts.map((act) =>
          act.menu === undefined ? (
            <Button key={act.label} roving icon={act.icon} onClick={act.onAct}>
              {act.label}
            </Button>
          ) : (
            <MenuAct key={act.label} act={act} menu={act.menu} />
          ),
        )}
      </div>
      <Button roving label={SELECTION_WORDS.CLEAR_SELECTION} onClick={onClear}>
        {SELECTION_WORDS.CLEAR}
      </Button>
    </div>
  );
}
