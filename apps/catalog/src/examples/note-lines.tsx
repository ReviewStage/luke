import {
  ArrowRightIcon,
  INLINE_REF_LOOK,
  InlineRef,
  NOTE_LINE_LOOK,
  NoteLine,
  UserIcon,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * note-lines.tsx -- the centred line a combobox says where its rows would
 * stand, the same line as a status, and the quiet list line at the start of
 * a room, and the line that stands at a sidebar's rows' inset; a
 * transcript's quiet line, selectable, and its trail led by a glyph and
 * naming the agents that continued it, wrapping in a narrow column.
 */

/** Nothing happens on a press: the catalog opens nowhere. */
function press(): void {}

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
      <CatalogSection id="note-line-rows" title="At the rows' inset">
        <div className="catalog-frame">
          <NoteLine look={NOTE_LINE_LOOK.ROWS}>No tasks yet.</NoteLine>
        </div>
      </CatalogSection>
      <CatalogSection id="note-line-selectable" title="Inset, selectable, a transcript's">
        <div className="catalog-transcript">
          <NoteLine look={NOTE_LINE_LOOK.INSET} selectable>
            Worked for 1m 18s · Today, 3:42 PM
          </NoteLine>
        </div>
      </CatalogSection>
      <CatalogSection id="note-line-trail" title="Trail, led by a glyph">
        <div className="catalog-narrow">
          <NoteLine look={NOTE_LINE_LOOK.TRAIL} glyph={<ArrowRightIcon />}>
            <span>Continued in</span>
            <InlineRef
              look={INLINE_REF_LOOK.WASH}
              glyph={<UserIcon />}
              label="Wire the invite email"
              onPress={press}
            />
            <InlineRef
              look={INLINE_REF_LOOK.WASH}
              glyph={<UserIcon />}
              label="Expire old invitations"
              onPress={press}
            />
          </NoteLine>
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
