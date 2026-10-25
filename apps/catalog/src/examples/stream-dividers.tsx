import { STREAM_DIVIDER, StreamDivider } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * stream-dividers.tsx -- the lines across a stream of messages: a day's
 * divider, the day muted between two hairlines, and the New line before
 * the first message the reader has not seen.
 */

function StreamDividers(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="stream-divider-day" title="A day">
        <div className="catalog-frame">
          <StreamDivider kind={STREAM_DIVIDER.DAY}>Yesterday</StreamDivider>
        </div>
      </CatalogSection>
      <CatalogSection id="stream-divider-new" title="New">
        <div className="catalog-frame">
          <StreamDivider kind={STREAM_DIVIDER.NEW}>New</StreamDivider>
        </div>
      </CatalogSection>
    </>
  );
}

export const STREAM_DIVIDERS_EXAMPLE: Example = {
  id: "stream-dividers",
  title: "Stream dividers",
  Render: StreamDividers,
};
