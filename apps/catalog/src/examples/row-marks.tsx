import { AlertIcon, PencilIcon, ROW_MARK, RowMark, Tooltip, UnreadMark } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * row-marks.tsx -- the marks a row or a tab wears beside its words: a
 * failure in the danger colour, with its hint, a waiting draft in the
 * muted ink, and the unread dot in the gutter before a row's words, which
 * stands empty once read.
 */

function RowMarks(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="row-mark-failed" title="Failed">
        <div className="catalog-frame">
          <Tooltip label="Failed">
            <RowMark kind={ROW_MARK.FAILED} label="Failed" glyph={<AlertIcon />} />
          </Tooltip>
        </div>
      </CatalogSection>
      <CatalogSection id="row-mark-draft" title="Draft">
        <div className="catalog-frame">
          <RowMark kind={ROW_MARK.DRAFT} label="Draft" glyph={<PencilIcon />} />
        </div>
      </CatalogSection>
      <CatalogSection id="row-mark-unread" title="Unread, and read">
        <div className="catalog-frame flex gap-luke-12">
          <UnreadMark unread />
          <UnreadMark unread={false} />
        </div>
      </CatalogSection>
    </>
  );
}

export const ROW_MARKS_EXAMPLE: Example = {
  id: "row-marks",
  title: "Row marks",
  Render: RowMarks,
};
