import { SELECTION_WORDS, selectedWords } from "@repo/features/words";
import { GLYPH } from "../../icons/icons.js";
import { IconButton } from "../button/button.js";
import { Menu, type MenuAction, useMenu } from "../menu/menu.js";
import { Tooltip } from "../tooltip/hint.js";
import type { SelectionAct } from "./selection-bar.js";
import { useSelectionKeys } from "./selection-keys.js";

export type SelectionGlyphAct = SelectionAct & { readonly icon: React.JSX.Element };

function MenuGlyph({
  act,
  menu,
}: {
  act: SelectionGlyphAct;
  menu: readonly (readonly MenuAction[])[];
}): React.JSX.Element {
  const drop = useMenu(true);
  return (
    <>
      <Tooltip label={act.label}>
        <IconButton roving icon={act.icon} label={act.label} {...drop.trigger()} />
      </Tooltip>
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

export function SelectionToolbar({
  count,
  acts,
  onClear,
  controls,
}: {
  count: number;
  acts: readonly SelectionGlyphAct[];
  onClear: () => void;
  controls: string;
}): React.JSX.Element | null {
  const keys = useSelectionKeys({ count, controls, onClear });
  if (count <= 0) return null;
  return (
    <div
      {...keys}
      role="toolbar"
      aria-label={selectedWords(count)}
      className="ui-selection-toolbar flex flex-none items-center gap-control-gap"
    >
      {acts.map((act) =>
        act.menu === undefined ? (
          <Tooltip key={act.label} label={act.label}>
            <IconButton roving icon={act.icon} label={act.label} onClick={act.onAct} />
          </Tooltip>
        ) : (
          <MenuGlyph key={act.label} act={act} menu={act.menu} />
        ),
      )}
      <Tooltip label={SELECTION_WORDS.CLEAR_SELECTION}>
        <IconButton
          roving
          icon={<GLYPH.CLOSE />}
          label={SELECTION_WORDS.CLEAR_SELECTION}
          onClick={onClear}
        />
      </Tooltip>
    </div>
  );
}
