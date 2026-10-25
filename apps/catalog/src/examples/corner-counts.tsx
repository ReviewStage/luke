import {
  CommentsIcon,
  CornerCount,
  CornerDot,
  FoldingButton,
  GAP,
  GearIcon,
  IconButton,
  Inline,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * corner-counts.tsx -- a press's glyph wearing a count at its corner, a
 * review's pending comments, beside one with nothing waiting, and a count of
 * two figures; and a press wearing a dot at its corner, a view filtered,
 * beside one that is not.
 */

function CornerCounts(): React.JSX.Element {
  return (
    <CatalogSection id="corner-count" title="A count at a glyph's corner">
      <Inline gap={GAP.CONTROL}>
        <FoldingButton
          label="Review"
          name="Review, 3 pending comments"
          icon={
            <CornerCount count={3}>
              <CommentsIcon />
            </CornerCount>
          }
        />
        <FoldingButton
          label="Review"
          icon={
            <CornerCount count={0}>
              <CommentsIcon />
            </CornerCount>
          }
        />
        <FoldingButton
          label="Review"
          name="Review, 12 pending comments"
          icon={
            <CornerCount count={12}>
              <CommentsIcon />
            </CornerCount>
          }
        />
      </Inline>
      <Inline gap={GAP.CONTROL}>
        <CornerDot shown>
          <IconButton icon={<GearIcon />} label="View options" aria-description="Filtered" />
        </CornerDot>
        <CornerDot shown={false}>
          <IconButton icon={<GearIcon />} label="View options" />
        </CornerDot>
      </Inline>
    </CatalogSection>
  );
}

export const CORNER_COUNTS_EXAMPLE: Example = {
  id: "corner-counts",
  title: "Corner counts",
  Render: CornerCounts,
};
