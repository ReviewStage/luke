import {
  GAP,
  Inline,
  SCROLL_AXIS,
  SCROLL_FADE,
  SCROLL_FADE_INSET,
  SCROLL_GUTTER,
  SCROLL_OVERSCROLL,
  SCROLL_SIZE,
  ScrollArea,
  type ScrollAxis,
  type ScrollFade,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const ROWS = Array.from({ length: 24 }, (_, index) => `Review pull request #${3600 + index}`);

const COLUMNS = ["Backlog", "Todo", "In progress", "In review", "Done", "Canceled", "Duplicate"];

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

function Banded(): React.JSX.Element {
  return (
    <div className="catalog-scroll-room">
      <ScrollArea fade={SCROLL_FADE.BOTH} fadeInset={SCROLL_FADE_INSET.BAND}>
        <div className="catalog-scroll-banded">
          {[0, 8, 16].map((from) => (
            <section key={from}>
              <div className="catalog-scroll-band">
                <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                  {`Call ${from / 8 + 1}`}
                </Text>
              </div>
              <Stack gap={GAP.TIGHT}>
                {ROWS.slice(from, from + 8).map((row) => (
                  <Text key={row} variant={TEXT_VARIANT.BODY}>
                    {row}
                  </Text>
                ))}
              </Stack>
            </section>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

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
      <CatalogSection id="scroll-area-band" title="A band stuck at the top, the fade beneath it">
        <Banded />
      </CatalogSection>
      <CatalogSection id="scroll-area-gutter" title="A stable gutter, short and long">
        <Inline gap={GAP.SECTION}>
          {[3, ROWS.length].map((count) => (
            <div key={count} className="catalog-scroll-room">
              <ScrollArea gutter={SCROLL_GUTTER.STABLE}>
                <Rows count={count} />
              </ScrollArea>
            </div>
          ))}
        </Inline>
      </CatalogSection>
      <CatalogSection id="scroll-area-sideways" title="Sideways, fading both edges">
        <Board axis={SCROLL_AXIS.HORIZONTAL} />
      </CatalogSection>
      <CatalogSection id="scroll-area-both" title="Both ways">
        <Board axis={SCROLL_AXIS.BOTH} />
      </CatalogSection>
      <CatalogSection
        id="scroll-area-overscroll"
        title="A swipe past the end, held or handed on to the page"
      >
        <Inline gap={GAP.SECTION}>
          {Object.values(SCROLL_OVERSCROLL).map((overscroll) => (
            <div key={overscroll} className="catalog-scroll-room">
              <div className="catalog-scroll-bar">
                <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                  {overscroll}
                </Text>
              </div>
              <ScrollArea overscroll={overscroll}>
                <Rows count={ROWS.length} />
              </ScrollArea>
            </div>
          ))}
        </Inline>
      </CatalogSection>
    </>
  );
}

export const SCROLL_AREA_EXAMPLE: Example = {
  id: "scroll-area",
  title: "Scroll area",
  Render: ScrollAreas,
};
