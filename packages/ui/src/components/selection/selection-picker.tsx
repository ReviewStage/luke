import { SELECTION_WORDS } from "@repo/features/words";
import { ChevronDownIcon } from "../../face/glyphs.js";
import { BUTTON_SIZE, IconButton } from "../button/button.js";
import { Checkbox } from "../checkbox/checkbox.js";
import { dropBelowStart, Menu, type MenuAction, useMenu } from "../menu/menu.js";
import { focusRovingStop } from "../roving-keys/roving-keys.js";
import { Tooltip } from "../tooltip/hint.js";
import { focusChoosable } from "./list-selection.js";

/**
 * selection-picker.tsx -- the box at the head of a list whose rows are chosen, and the menu beside it of which rows to choose, as Gmail's head draws them.
 *
 * The box says how many of the list's rows are chosen: none, some (a dash),
 * or every one. A press on it chooses none while any is chosen, and every
 * row while none is, so the one press that lets a selection go stands right
 * beside the count the head says. The chevron after it drops a menu of
 * which rows to choose: All and None, then any ways the list offers to
 * choose by what its rows hold, as a mail list's Read and Unread, each
 * putting exactly those rows in the selection in place of what stood.
 *
 * A head that draws the box only while a row is chosen takes it away as
 * the selection goes, so choosing none, None or a way that holds no row,
 * hands the focus to the list it chooses in (`controls`) first, as the
 * selection's toolbar does, rather than let it fall to the page.
 */

/** A way to choose rows by what they hold: its words, how many rows it chooses, and the choosing. */
export interface SelectionPickerChoice {
  readonly label: string;
  /** How many rows it chooses, none of which leaves the list with nothing chosen. */
  readonly count: number;
  readonly onSelect: () => void;
}

/** The box and the chevron of a list holding `total` rows, `count` of them chosen. */
export function SelectionPicker({
  count,
  total,
  onAll,
  onNone,
  by = [],
  controls,
}: {
  /** How many rows are chosen. */
  count: number;
  /** How many rows the list holds. */
  total: number;
  /** Chooses every row. */
  onAll: () => void;
  /** Chooses none, as Esc does. */
  onNone: () => void;
  /** The other ways to choose rows, after All and None, each choosing those rows alone. */
  by?: readonly SelectionPickerChoice[] | undefined;
  /** The id of the list whose rows it chooses, which takes the focus as it chooses none. */
  controls: string;
}): React.JSX.Element {
  const drop = useMenu(true);
  const any = count > 0;
  // Note that the focus goes to the list before the rows are let go, since the box goes with them.
  const handingFocus = (choose: () => void) => () => {
    const list = document.getElementById(controls);
    // Note that a region of the app's own rows keeps no roving Tab stop, so its first row takes the focus instead.
    if (list !== null && !focusRovingStop(list)) focusChoosable(list);
    choose();
  };
  const none = handingFocus(onNone);
  const ways: readonly MenuAction[] = by.map((choice) => ({
    label: choice.label,
    onSelect: choice.count === 0 ? handingFocus(choice.onSelect) : choice.onSelect,
  }));
  const groups: readonly (readonly MenuAction[])[] = [
    [
      { label: SELECTION_WORDS.ALL, onSelect: onAll },
      { label: SELECTION_WORDS.NONE, onSelect: none },
    ],
    ...(ways.length === 0 ? [] : [ways]),
  ];
  return (
    <span className="ui-selection-picker inline-flex flex-none items-center gap-tight-gap">
      {/* Note that a press on a box partly checked asks for checked, which is read here as a press that lets every row go. */}
      <Checkbox
        label={any ? SELECTION_WORDS.SELECT_NONE : SELECTION_WORDS.SELECT_ALL}
        checked={any && count >= total}
        mixed={any && count < total}
        onChange={() => (any ? none() : onAll())}
      />
      <Tooltip label={SELECTION_WORDS.SELECT}>
        <IconButton
          size={BUTTON_SIZE.COMPACT}
          icon={<ChevronDownIcon />}
          label={SELECTION_WORDS.SELECT}
          {...drop.trigger(dropBelowStart)}
        />
      </Tooltip>
      {drop.drawn === undefined ? null : (
        <Menu
          label={SELECTION_WORDS.SELECT}
          menu={drop.drawn}
          groups={groups}
          onClose={drop.close}
          replayUnmasked
        />
      )}
    </span>
  );
}
