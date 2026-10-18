import {
  GAP,
  Inline,
  SCROLL_AXIS,
  SCROLL_FADE,
  SCROLL_SIZE,
  ScrollArea,
  type ScrollAxis,
  type ScrollFade,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * scroll-area.tsx -- a pane's body under a pinned bar at each fade, up and
 * down; a short list as tall as it holds and a long one shrinking to the
 * room; a row of columns that scrolls sideways; and a table that scrolls
 * both ways. Each room is a fixed size so the area has something to scroll.
 */

const ROWS = Array.from({ length: 24 }, (_, index) => `Review pull request #${3600 + index}`);

const COLUMNS = ["Backlog", "Todo", "In progress", "In review", "Done", "Cancelled", "Duplicate"];

/** The area's rows, each on a line of its own, inside the caller's padded element. */
function Rows({ count }: { count: number }): React.JSX.Element {
  return (
    <div className="catalog-scroll-body">
      <Stack gap={GAP.TIGHT}>
        {ROWS.slice(0, count).map((row) => (
          <Text key={row} variant={TEXT_VARIANT.BODY}>
            {row}
          </Text>
        ))}
      </Stack>
    </div>
  );
}

/** A pane with a pinned bar over an area that fills the rest, fading as `fade` says. */
function Pane({ fade }: { fade: ScrollFade }): React.JSX.Element {
  return (
    <div className="catalog-scroll-room">
      <div className="catalog-scroll-bar">
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {fade}
        </Text>
      </div>
      <ScrollArea fade={fade}>
        <Rows count={ROWS.length} />
      </ScrollArea>
    </div>
  );
}

/** A row of columns, or a grid of cells, wider than its room, scrolling on `axis`. */
function Board({ axis }: { axis: ScrollAxis }): React.JSX.Element {
  return (
    <div className="catalog-scroll-room catalog-scroll-room-wide">
      <ScrollArea axis={axis} fade={axis === SCROLL_AXIS.HORIZONTAL ? SCROLL_FADE.BOTH : undefined}>
        <div className="catalog-scroll-board">
          {COLUMNS.map((column) => (
            <div key={column} className="catalog-scroll-column">
              <Text variant={TEXT_VARIANT.LABEL}>{column}</Text>
              {axis === SCROLL_AXIS.BOTH ? <Rows count={ROWS.length} /> : <Rows count={3} />}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function ScrollAreas(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="scroll-area-fades" title="Up and down, filling a pane, at each fade">
        <Inline gap={GAP.SECTION}>
          {Object.values(SCROLL_FADE).map((fade) => (
            <Pane key={fade} fade={fade} />
          ))}
        </Inline>
      </CatalogSection>
      <CatalogSection id="scroll-area-content" title="As tall as it holds, shrinking to the room">
        <Inline gap={GAP.SECTION}>
          <div className="catalog-scroll-room">
            <ScrollArea size={SCROLL_SIZE.CONTENT} fade={SCROLL_FADE.BOTH}>
              <Rows count={3} />
            </ScrollArea>
          </div>
          <div className="catalog-scroll-room">
            <ScrollArea size={SCROLL_SIZE.CONTENT} fade={SCROLL_FADE.BOTH}>
              <Rows count={ROWS.length} />
            </ScrollArea>
          </div>
        </Inline>
      </CatalogSection>
      <CatalogSection id="scroll-area-sideways" title="Sideways, fading both edges">
        <Board axis={SCROLL_AXIS.HORIZONTAL} />
      </CatalogSection>
      <CatalogSection id="scroll-area-both" title="Both ways">
        <Board axis={SCROLL_AXIS.BOTH} />
      </CatalogSection>
    </>
  );
}

export const SCROLL_AREA_EXAMPLE: Example = {
  id: "scroll-area",
  title: "Scroll area",
  Render: ScrollAreas,
};
