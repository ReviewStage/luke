import {
  WRITING_BLOCK,
  WRITING_MARK,
  type WritingBlock,
  type WritingMark,
} from "@luke/settings/shortcuts";
import {
  BUTTON_VARIANT,
  Button,
  dropBelowStart,
  FormatToolbar,
  GAP,
  Stack,
  TurnIntoMenu,
  useMenu,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * format-toolbar.tsx -- the toolbar over selected words: the plan's, with
 * Turn into naming the block and Comment, whose marks toggle as they are
 * pressed; one over words spanning several kinds of block; a composer's,
 * marks alone; and the Turn into menu it drops, the current block checked.
 */

const ignore = () => undefined;

/** The marks pressed so far, each press laying a mark on or taking it off. */
function useMarks(initial: readonly WritingMark[]) {
  const [marks, setMarks] = useState<readonly WritingMark[]>(initial);
  const toggle = (mark: WritingMark) =>
    setMarks((was) => (was.includes(mark) ? was.filter((each) => each !== mark) : [...was, mark]));
  return [marks, toggle] as const;
}

/** The plan's toolbar over words in a heading, bold and linked. */
function PlanToolbar(): React.JSX.Element {
  const [marks, toggle] = useMarks([WRITING_MARK.BOLD, WRITING_MARK.LINK]);
  const [block, setBlock] = useState<WritingBlock>(WRITING_BLOCK.HEADING_2);
  return (
    <FormatToolbar
      marks={marks}
      onMark={toggle}
      turnInto={{ current: block, onTurn: setBlock }}
      onComment={ignore}
    />
  );
}

/** The plan's toolbar over words spanning a paragraph and a list. */
function SpanningToolbar(): React.JSX.Element {
  const [marks, toggle] = useMarks([WRITING_MARK.ITALIC]);
  return (
    <FormatToolbar
      marks={marks}
      onMark={toggle}
      turnInto={{ current: undefined, onTurn: ignore }}
      onComment={ignore}
    />
  );
}

/** A composer's toolbar, which writes marks alone. */
function ComposerToolbar(): React.JSX.Element {
  const [marks, toggle] = useMarks([WRITING_MARK.CODE]);
  return <FormatToolbar marks={marks} onMark={toggle} />;
}

/** The Turn into menu dropped from a button, over a line that is a to-do list. */
function TurnInto(): React.JSX.Element {
  const menu = useMenu(true);
  const [block, setBlock] = useState<WritingBlock>(WRITING_BLOCK.TODO_LIST);
  return (
    <>
      <Button variant={BUTTON_VARIANT.OUTLINE} {...menu.trigger(dropBelowStart)}>
        Turn into
      </Button>
      {menu.drawn === undefined ? null : (
        <TurnIntoMenu menu={menu.drawn} current={block} onTurn={setBlock} onClose={menu.close} />
      )}
    </>
  );
}

function FormatToolbarExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="format-toolbar-plan" title="Over the plan's words">
        <Stack gap={GAP.FIELD}>
          <PlanToolbar />
          <SpanningToolbar />
        </Stack>
      </CatalogSection>
      <CatalogSection id="format-toolbar-composer" title="Over a composer's words">
        <ComposerToolbar />
      </CatalogSection>
      <CatalogSection id="format-toolbar-turn-into" title="Turn into">
        <TurnInto />
      </CatalogSection>
    </>
  );
}

export const FORMAT_TOOLBAR_EXAMPLE: Example = {
  id: "format-toolbar",
  title: "Format toolbar",
  Render: FormatToolbarExample,
};
