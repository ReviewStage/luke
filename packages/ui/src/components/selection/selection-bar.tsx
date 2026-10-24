import { SELECTION_WORDS, selectedWords } from "@luke/features/words";
import {
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import { Button } from "../button/button.js";
import { Menu, type MenuEntry, useMenu } from "../menu/menu.js";
import { focusRovingStop, ROVING_ORIENTATION, useRovingKeys } from "../roving-keys/roving-keys.js";

/**
 * selection-bar.tsx -- the bar over a list while some of its rows are chosen: how many ("3 selected"), the acts that take them all at once, and Clear.
 *
 * It stands only while a row is chosen, and draws nothing once none is, so
 * a list's owner draws it beside the list whatever the count. The count
 * leads it and is said as it changes, so a reader choosing rows by the
 * keys hears how many they hold. The acts follow in the order handed, each
 * a labelled button that does its act on every chosen row, or drops a menu
 * of choices where the act is one of several (a status, a section); Clear,
 * last, chooses none, as Esc does in the list and in the bar alike.
 *
 * The bar is a toolbar (`useRovingKeys`): Tab stops on it once, ←→ walk
 * its buttons. It names the list it acts on (`controls`), and where the
 * bar held the focus as the last row left the selection, by Clear, Esc,
 * or an act that took the rows away, it hands the focus to that list's
 * Tab stop rather than let it fall to the page as its buttons go.
 */

/** One act of the bar: its words, its glyph, and either what it does or the menu of choices it drops. */
export type SelectionAct = {
  readonly label: string;
  readonly icon?: ReactNode;
} & (
  | { readonly onAct: () => void; readonly menu?: undefined }
  | { readonly menu: readonly (readonly MenuEntry[])[]; readonly onAct?: undefined }
);

/** An act that drops a menu of choices under its button. */
function MenuAct({
  act,
  menu,
}: {
  act: SelectionAct;
  menu: readonly (readonly MenuEntry[])[];
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
  // Whether the focus stands in the bar, or stood there as its buttons went.
  const holding = useRef(false);
  useLayoutEffect(() => {
    if (count > 0 || !holding.current) return;
    holding.current = false;
    // Note that only a focus fallen to the page is handed on, never one something else took.
    const fell = document.activeElement === null || document.activeElement === document.body;
    const list = document.getElementById(controls);
    if (fell && list !== null) focusRovingStop(list);
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
      className="luke-selection-bar"
    >
      <span id={countId} role="status" className="luke-selection-bar-count">
        {selectedWords(count)}
      </span>
      <div className="luke-selection-bar-acts">
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
