import {
  BLOCK_LIST_ELEMENT,
  BlockList,
  BlockListItem,
  Button,
  GAP,
  Inline,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * block-lists.tsx -- blocks one under another in one box, a hairline
 * between each: pending review comments, each under its file and lines with
 * its presses; and a list holding one block.
 */

const ignore = () => undefined;

const COMMENTS = [
  { where: "src/invite.ts · line 13", words: "Should this expire with the session?" },
  {
    where: "src/invite.ts · lines 20–24",
    words:
      "A long note that runs on past one line, to show a block taking the room it needs and wrapping inside it.",
  },
] as const;

/** One pending comment: where it is, its words, and its presses. */
function Comment({ where, words }: { where: string; words: string }): React.JSX.Element {
  return (
    <BlockListItem>
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {where}
      </Text>
      <Text>{words}</Text>
      <Inline gap={GAP.CONTROL}>
        <Button onClick={ignore}>Edit</Button>
        <Button onClick={ignore}>Delete</Button>
      </Inline>
    </BlockListItem>
  );
}

function BlockLists(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="block-list-comments" title="Pending comments">
        <div className="catalog-column">
          <BlockList as={BLOCK_LIST_ELEMENT.OL} label="Pending">
            {COMMENTS.map((comment) => (
              <Comment key={comment.where} {...comment} />
            ))}
          </BlockList>
        </div>
      </CatalogSection>
      <CatalogSection id="block-list-one" title="One block">
        <div className="catalog-column">
          <BlockList label="One">
            <Comment {...COMMENTS[0]} />
          </BlockList>
        </div>
      </CatalogSection>
    </>
  );
}

export const BLOCK_LISTS_EXAMPLE: Example = {
  id: "block-lists",
  title: "Block lists",
  Render: BlockLists,
};
