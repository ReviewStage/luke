import { SELECTION_WORDS, selectedWords } from "@repo/features/words";
import { useId } from "react";
import { Button } from "../button/button.js";
import { Menu, type MenuAction, useMenu } from "../menu/menu.js";
import { useSelectionKeys } from "./selection-keys.js";

/**
 * selection-bar.tsx -- the bar over a list while some of its rows are chosen: how many ("3 selected"), the acts that take them all at once, and Clear.
 *
 * It stands only while a row is chosen, and draws nothing once none is, so
 * a list's owner draws it beside the list whatever the count. The count
 * leads it and is said politely through the window's `Announcer` as it
 * changes, the first row chosen included, so a reader choosing rows by the
 * keys hears how many they hold. The acts follow in the order handed, each
 * a labeled button that does its act on every chosen row, or drops a menu
 * of choices where the act is one of several (a status, a section); Clear,
 * last, chooses none, as Esc does in the list and in the bar alike.
 *
 * The bar is a toolbar whose keys, focus, and announcement are every
 * selection toolbar's (`selection-keys.ts`).
 *
 * It is drawn in the Tailwind theme's utilities: one line inside a hairline
 * on the ground a menu floats on (`bg-popover`), the count in the label's type
 * with even digits, the acts wrapping after it, and a control's gap between
 * each. Note that the ground is a menu's rather than a card's, because a list
 * floats its bar over its rows, and the desktop's dark card ground is nearly
 * clear, so the rows' words would show through the bar's.
 */

/**
 * One act of the bar: its words, its glyph, and either what it does or the
 * menu of choices it drops, which a chosen row's menu offers as a submenu
 * (`selectionMenu`), so a choice is an action rather than a submenu of its own.
 */
export type SelectionAct = {
  readonly label: string;
  readonly icon?: React.JSX.Element;
  /** The act cannot be taken back, as Permanently delete: a chosen row's menu draws it red, last and alone. */
  readonly danger?: boolean | undefined;
  /** Whether the words of the menu it drops are the app's own, which a screen recording shows as they read (`Menu`'s `replayUnmasked`). */
  readonly replayUnmasked?: boolean | undefined;
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
        <Menu
          label={act.label}
          menu={drop.drawn}
          groups={menu}
          onClose={drop.close}
          replayUnmasked={act.replayUnmasked}
        />
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
  const countId = useId();
  const keys = useSelectionKeys({ count, controls, onClear });
  if (count <= 0) return null;
  return (
    <div
      {...keys}
      role="toolbar"
      aria-labelledby={countId}
      className="ui-selection-bar box-border flex min-w-0 items-center gap-control-gap rounded-control border border-border bg-popover py-tight-gap pr-tight-gap pl-list-inset font-ui text-foreground"
    >
      <span
        id={countId}
        className="ui-selection-bar-count flex-none text-label font-label tabular-nums"
      >
        {selectedWords(count)}
      </span>
      <div className="ui-selection-bar-acts flex min-w-0 flex-auto flex-wrap items-center gap-control-gap">
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
