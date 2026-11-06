import { useContext } from "react";
import { cn } from "../../cn.js";
import { Checkbox as ShadcnCheckbox } from "../../shadcn/checkbox.js";
import { ListSelectionContext } from "./list-selection.js";

export const SELECT_BOX_PLACE = {
  GUTTER: "gutter",
  CARD_HEAD: "card-head",
  UNREAD_GUTTER: "unread-gutter",
} as const;

export type SelectBoxPlace = (typeof SELECT_BOX_PLACE)[keyof typeof SELECT_BOX_PLACE];

const SHOWN_ATTRIBUTE = "data-shown";

const BOX =
  "ui-select-box absolute z-1 opacity-0 transition-opacity duration-(--ui-duration-hover) ease-motion-exit hover:opacity-100 peer-hover/card-press:opacity-100 peer-focus-visible/card-press:opacity-100 data-[shown=true]:opacity-100";

const PLACED: Record<SelectBoxPlace, string> = {
  [SELECT_BOX_PLACE.GUTTER]: "top-1/2 left-row-inset -translate-y-1/2",
  [SELECT_BOX_PLACE.CARD_HEAD]:
    "top-[calc(var(--spacing-row-inset)+(var(--spacing-ui-20)-var(--spacing-select-box))/2)] left-[calc(var(--spacing-list-inset)-var(--ui-space-4)+var(--spacing-select-box-inset))]",
  [SELECT_BOX_PLACE.UNREAD_GUTTER]:
    "top-1/2 left-[calc(var(--ui-list-row-inset-inline)+(var(--spacing-status-dot)-var(--spacing-select-box))/2)] -translate-y-1/2 group-hover/list-row:opacity-100 group-data-[meta=title]/list-row:top-[calc(var(--ui-list-row-inset-block)+(var(--ui-list-row-head-leading)-var(--spacing-select-box))/2)] group-data-[meta=title]/list-row:translate-y-0",
};

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
      onMouseDown={(event) => event.preventDefault()}
      onCheckedChange={() => selecting.toggle(selectKey)}
    />
  );
}
