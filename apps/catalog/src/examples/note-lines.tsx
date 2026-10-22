import { NOTE_LINE_LOOK, NoteLine } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * note-lines.tsx -- the centred line a combobox says where its rows would
 * stand, the same line as a status, and the quiet list line at the start of
 * a room.
 */

function NoteLines(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="note-line-centred" title="Centred">
        <div className="catalog-frame">
          <NoteLine>Nothing matches.</NoteLine>
        </div>
      </CatalogSection>
      <CatalogSection id="note-line-status" title="Centred, announced">
        <div className="catalog-frame">
          <NoteLine status>Reading the task’s agents…</NoteLine>
        </div>
      </CatalogSection>
      <CatalogSection id="note-line-list" title="List">
        <div className="catalog-frame">
          <NoteLine look={NOTE_LINE_LOOK.LIST}>No shells.</NoteLine>
        </div>
      </CatalogSection>
      <CatalogSection id="note-line-inset" title="Inset by its container">
        <div className="catalog-frame">
          <NoteLine look={NOTE_LINE_LOOK.INSET}>Drag tasks here</NoteLine>
        </div>
      </CatalogSection>
    </>
  );
}

export const NOTE_LINES_EXAMPLE: Example = {
  id: "note-lines",
  title: "Note lines",
  Render: NoteLines,
};
