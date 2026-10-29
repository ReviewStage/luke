import {
  CHIP_LOOK,
  CHIP_WIDTH,
  Chip,
  ChipName,
  CommentsIcon,
  CornerBadge,
  CornerCount,
  CornerDot,
  FoldingButton,
  GAP,
  GearIcon,
  IconButton,
  Inline,
  STATUS_TONE,
  StatusGlyph,
} from "@luke/ui";
import { FlaskConicalIcon, GLYPH } from "@luke/ui/icons";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * corner-counts.tsx -- a press's glyph wearing a count at its corner, a
 * review's pending comments, beside one with nothing waiting, and a count of
 * two figures; a press wearing a dot at its corner, a view filtered,
 * beside one that is not; a chip wearing the experiment's flask on a disc
 * at its corner; and a device's glyph wearing a status dot in a few of the
 * tones its standing takes.
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
      <Inline gap={GAP.CONTROL}>
        <CornerBadge mark={<FlaskConicalIcon />}>
          <Chip look={CHIP_LOOK.FIELD} width={CHIP_WIDTH.AUTO} chevron aria-label="Runs on: Cloud">
            <GLYPH.CLOUD />
            <ChipName>Cloud</ChipName>
          </Chip>
        </CornerBadge>
      </Inline>
      <Inline gap={GAP.CONTROL}>
        <StatusGlyph tone={STATUS_TONE.COMPLETE} label="Online">
          <GLYPH.DESKTOP />
        </StatusGlyph>
        <StatusGlyph label="Offline">
          <GLYPH.DESKTOP />
        </StatusGlyph>
        <StatusGlyph tone={STATUS_TONE.ATTENTION} label="Can't check status">
          <GLYPH.HOST />
        </StatusGlyph>
      </Inline>
    </CatalogSection>
  );
}

export const CORNER_COUNTS_EXAMPLE: Example = {
  id: "corner-counts",
  title: "Corner counts",
  Render: CornerCounts,
};
