import {
  WRITING_BLOCK,
  WRITING_MARK,
  type WritingBlock,
  type WritingMark,
} from "@repo/settings/shortcuts";
import {
  BUTTON_VARIANT,
  Button,
  dropBelowStart,
  FormatToolbar,
  GAP,
  Stack,
  TurnIntoMenu,
  useMenu,
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const ignore = () => undefined;

function useMarks(initial: readonly WritingMark[]) {
  const [marks, setMarks] = useState<readonly WritingMark[]>(initial);
  const toggle = (mark: WritingMark) =>
    setMarks((was) => (was.includes(mark) ? was.filter((each) => each !== mark) : [...was, mark]));
  return [marks, toggle] as const;
}

function DescriptionToolbar(): React.JSX.Element {
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

function ComposerToolbar(): React.JSX.Element {
  const [marks, toggle] = useMarks([WRITING_MARK.CODE]);
  return <FormatToolbar marks={marks} onMark={toggle} />;
}

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
      <CatalogSection id="format-toolbar-description" title="Over the description's words">
        <Stack gap={GAP.FIELD}>
          <DescriptionToolbar />
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
