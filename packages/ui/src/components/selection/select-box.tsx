import { useContext } from "react";
import { cn } from "../../cn.js";
import { Checkbox as ShadcnCheckbox } from "../../shadcn/checkbox.js";
import { ListSelectionContext } from "./list-selection.js";

/**
 * select-box.tsx -- the box at the start of a row that can be chosen, which the pointer finds there: Linear's and Gmail's way into a selection.
 *
 * A row that can be chosen (`CardPress`'s `selectKey`) is chosen by ⌘- and
 * ⇧-clicks and by X, which nothing on screen says. Its box says it: it
 * comes in while the row is under the pointer or holds the keyboard's
 * focus, stays while the row is chosen or any row of its list is, so a list
 * being chosen from shows every box, and a press on it puts the row in or
 * takes it out without opening it, as X does. A plain press on the row
 * still opens it.
 *
 * The box is the pointer's alone: the keyboard chooses by X, and the row's
 * press already says it is selected, so the box takes no Tab stop and is
 * hidden from a reader, who would otherwise meet each row twice.
 *
 * It stands where the row says (`SELECT_BOX_PLACE`), laid over the row's
 * box rather than in its flow, so it moves nothing as it comes and goes: in
 * the gutter a list row keeps at its start (`--spacing-select-gutter`), or at
 * the start of a card's first line, where the card hides what it draws there
 * while the box shows.
 */

/** Where a row's box stands. */
export const SELECT_BOX_PLACE = {
  /** In the gutter a list row keeps at its start, centred on the row (`ps-select-gutter`). */
  GUTTER: "gutter",
  /** At the start of a card's first line, a control's height tall, inside the card's row and list insets, as a board's card draws its key there. */
  CARD_HEAD: "card-head",
} as const;

export type SelectBoxPlace = (typeof SELECT_BOX_PLACE)[keyof typeof SELECT_BOX_PLACE];

/** The attribute a box wears while it stands at rest, its row chosen or its list being chosen from. */
const SHOWN_ATTRIBUTE = "data-shown";

/**
 * The box over its row, hidden until the row's press is hovered or focused
 * from the keyboard (the press is its peer, standing just before it), the
 * box itself is hovered, or it stands at rest. Note that it stands over the
 * press's reach, a layer up, so a press on it is its own.
 */
const BOX =
  "luke-select-box absolute z-1 opacity-0 transition-opacity duration-(--luke-duration-hover) ease-motion-exit hover:opacity-100 peer-hover/card-press:opacity-100 peer-focus-visible/card-press:opacity-100 data-[shown=true]:opacity-100";

/** Where each place stands the box in its row. */
const PLACED: Record<SelectBoxPlace, string> = {
  [SELECT_BOX_PLACE.GUTTER]: "top-1/2 left-row-inset -translate-y-1/2",
  [SELECT_BOX_PLACE.CARD_HEAD]:
    "top-[calc(var(--spacing-row-inset)+(var(--spacing-luke-20)-var(--spacing-select-box))/2)] left-list-inset",
};

/** What finds a row's box, as a card hiding what stands under it does. */
export const SELECT_BOX_SELECTOR = ".luke-select-box";

/** The box of the row keyed `selectKey`, in the selection it stands in; nothing outside one. */
export function SelectBox({
  selectKey,
  place,
}: {
  selectKey: string;
  place: SelectBoxPlace;
}): React.JSX.Element | null {
  const selecting = useContext(ListSelectionContext);
  if (selecting === undefined) return null;
  const chosen = selecting.selected.has(selectKey);
  return (
    <ShadcnCheckbox
      className={cn(BOX, PLACED[place])}
      checked={chosen}
      tabIndex={-1}
      aria-hidden="true"
      {...{ [SHOWN_ATTRIBUTE]: String(selecting.selected.size > 0) }}
      // Note that a press on it keeps the focus where it stood, so the box never holds a focus a reader is not told of.
      onMouseDown={(event) => event.preventDefault()}
      onCheckedChange={() => selecting.toggle(selectKey)}
    />
  );
}
