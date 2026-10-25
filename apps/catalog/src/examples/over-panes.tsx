/**
 * over-panes.tsx -- a pane floated over a narrow tab by its toggle, sliding in from its edge and back out past it: a sheet at the tab's right, as a File tab's tree floats, a column at its left, as the Chapters rail does, and the tab's whole width, as the tree fills a phone; Escape or a press anywhere outside it puts it away.
 */

import {
  BUTTON_VARIANT,
  Button,
  GAP,
  Inline,
  OVER_PANE_EDGE,
  OVER_PANE_WIDTH,
  OverPane,
  type OverPaneEdge,
  type OverPaneWidth,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/** A press the catalog has nowhere to take. */
function stay(): void {}

/** A narrow tab whose toggle floats a pane of `rows` over it, at `edge` and `width`. */
function Room({
  label,
  edge,
  width,
  rows,
}: {
  label: string;
  edge: OverPaneEdge;
  width: OverPaneWidth;
  rows: readonly string[];
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  // Note that the toggle stands above the tab rather than in it, as a tab's
  // bar does, so the pane it floats never covers it.
  return (
    <Stack gap={GAP.TIGHT}>
      <Inline>
        <Button
          ref={toggle}
          variant={BUTTON_VARIANT.OUTLINE}
          onClick={() => setOpen((was) => !was)}
        >
          {open ? `Hide ${label}` : `Show ${label}`}
        </Button>
      </Inline>
      <div className="catalog-popover-room">
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          The tab's own work stands here, under the pane.
        </Text>
        <OverPane
          open={open}
          onClose={() => setOpen(false)}
          label={label}
          edge={edge}
          width={width}
          toggle={toggle}
        >
          <Stack gap={GAP.TIGHT}>
            {rows.map((row) => (
              <Button key={row} variant={BUTTON_VARIANT.ROW} onClick={stay}>
                {row}
              </Button>
            ))}
          </Stack>
        </OverPane>
      </div>
    </Stack>
  );
}

function OverPanes(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="over-pane-sheet" title="A sheet at the right">
        <Room
          label="Files"
          edge={OVER_PANE_EDGE.RIGHT}
          width={OVER_PANE_WIDTH.SHEET}
          rows={["src/app.tsx", "src/components/over-pane/over-pane.tsx", "README.md"]}
        />
      </CatalogSection>
      <CatalogSection id="over-pane-column" title="A column at the left">
        <Room
          label="Chapters"
          edge={OVER_PANE_EDGE.LEFT}
          width={OVER_PANE_WIDTH.COLUMN}
          rows={["The sign-in loop", "Where the token is kept", "The fix"]}
        />
      </CatalogSection>
      <CatalogSection id="over-pane-full" title="The whole tab, on a phone">
        <Room
          label="Files"
          edge={OVER_PANE_EDGE.RIGHT}
          width={OVER_PANE_WIDTH.FULL}
          rows={["src/app.tsx", "src/components/over-pane/over-pane.tsx", "README.md"]}
        />
      </CatalogSection>
    </>
  );
}

export const OVER_PANES_EXAMPLE: Example = {
  id: "over-panes",
  title: "Over panes",
  Render: OverPanes,
};
