import { WRITING_BLOCK, WRITING_INSERT } from "@luke/settings/shortcuts";
import {
  BLOCK_MENU_GROUP,
  BlockMenu,
  type BlockMenuGroup,
  type BlockMenuRow,
  BoardIcon,
  GAP,
  ImageIcon,
  Inline,
  UserIcon,
  writingRow,
} from "@luke/ui";
import { useId, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * block-menu.tsx -- the list a `/` opens: every block in its groups, each
 * saying the Markdown that makes it or its chord, the highlight following
 * the pointer; the list narrowed by the words typed after the `/`; and one
 * narrowed to nothing.
 */

/** The rows a document offers beyond the vocabulary's, as the plan's own. */
const DIAGRAM: BlockMenuRow = {
  id: "diagram",
  label: "Diagram",
  icon: <BoardIcon />,
  markdown: "```mermaid",
};
const PICTURE: BlockMenuRow = { id: "picture", label: "Picture", icon: <ImageIcon /> };
const MENTION: BlockMenuRow = {
  id: "mention",
  label: "Mention",
  icon: <UserIcon />,
  markdown: "@",
};

const EVERY_BLOCK: readonly BlockMenuGroup[] = [
  {
    label: BLOCK_MENU_GROUP.BASIC,
    rows: [
      writingRow(WRITING_BLOCK.TEXT),
      writingRow(WRITING_BLOCK.HEADING_1),
      writingRow(WRITING_BLOCK.HEADING_2),
      writingRow(WRITING_BLOCK.HEADING_3),
    ],
  },
  {
    label: BLOCK_MENU_GROUP.LISTS,
    rows: [
      writingRow(WRITING_BLOCK.BULLETED_LIST),
      writingRow(WRITING_BLOCK.NUMBERED_LIST),
      writingRow(WRITING_BLOCK.TODO_LIST),
    ],
  },
  {
    label: BLOCK_MENU_GROUP.BLOCKS,
    rows: [writingRow(WRITING_BLOCK.QUOTE), writingRow(WRITING_BLOCK.CODE_BLOCK)],
  },
  {
    label: BLOCK_MENU_GROUP.INSERT,
    rows: [DIAGRAM, writingRow(WRITING_INSERT.DIVIDER), PICTURE, MENTION],
  },
];

/** `/h` typed: the headings alone. */
const NARROWED: readonly BlockMenuGroup[] = [
  {
    label: BLOCK_MENU_GROUP.BASIC,
    rows: [
      writingRow(WRITING_BLOCK.HEADING_1),
      writingRow(WRITING_BLOCK.HEADING_2),
      writingRow(WRITING_BLOCK.HEADING_3),
    ],
  },
];

/** The menu over `groups`, its highlight following the pointer and a press. */
function Sample({ groups }: { groups: readonly BlockMenuGroup[] }): React.JSX.Element {
  const id = useId();
  const [active, setActive] = useState(0);
  const rows = groups.flatMap((group) => group.rows);
  return (
    <BlockMenu
      id={id}
      groups={groups}
      active={active}
      onActiveChange={setActive}
      onChoose={(row) => setActive(rows.indexOf(row))}
    />
  );
}

function BlockMenuExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="block-menu-every" title="Every block">
        <Sample groups={EVERY_BLOCK} />
      </CatalogSection>
      <CatalogSection id="block-menu-narrowed" title="Narrowed, and narrowed to nothing">
        <Inline gap={GAP.CONTROL}>
          <Sample groups={NARROWED} />
          <Sample groups={[]} />
        </Inline>
      </CatalogSection>
    </>
  );
}

export const BLOCK_MENU_EXAMPLE: Example = {
  id: "block-menu",
  title: "Block menu",
  Render: BlockMenuExample,
};
