import { SELECTION_WORDS, selectedWords } from "@repo/features/words";
import { useId } from "react";
import { Button } from "../button/button.js";
import { Menu, type MenuAction, useMenu } from "../menu/menu.js";
import { useSelectionKeys } from "./selection-keys.js";

export type SelectionAct = {
  readonly label: string;
  readonly icon?: React.JSX.Element;
  readonly danger?: boolean | undefined;
  readonly replayUnmasked?: boolean | undefined;
} & (
  | { readonly onAct: () => void; readonly menu?: undefined }
  | { readonly menu: readonly (readonly MenuAction[])[]; readonly onAct?: undefined }
);

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

export function SelectionBar({
  count,
  acts,
  onClear,
  controls,
}: {
  count: number;
  acts: readonly SelectionAct[];
  onClear: () => void;
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
