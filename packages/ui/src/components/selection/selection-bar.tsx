import { SELECTION_WORDS, selectedWords } from "@luke/features/words";
import { type KeyboardEvent, type ReactNode, useId } from "react";
import { Button } from "../button/button.js";
import { Menu, type MenuEntry, useMenu } from "../menu/menu.js";
import { ROVING_ORIENTATION, useRovingKeys } from "../roving-keys/roving-keys.js";

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
 * its buttons.
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
}: {
  /** How many rows are chosen. */
  count: number;
  /** What may be done to every chosen row at once, in the order drawn. */
  acts: readonly SelectionAct[];
  /** Chooses none, as Clear and Esc do. */
  onClear: () => void;
}): React.JSX.Element | null {
  const roving = useRovingKeys<HTMLDivElement>({ orientation: ROVING_ORIENTATION.HORIZONTAL });
  const countId = useId();
  if (count <= 0) return null;
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
      role="toolbar"
      aria-labelledby={countId}
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
