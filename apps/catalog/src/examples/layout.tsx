import {
  ALIGN,
  FILL_FLOW,
  Fill,
  GAP,
  Inline,
  JUSTIFY,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * layout.tsx -- Stack and Inline at every gap role, along and across their
 * room, an Inline of long labels in a narrow column, wrapping and held, and
 * a Fill taking the room a pane's head leaves, down the pane and across it,
 * clipping what stands past its edge.
 */

const LABELS = ["Repository", "Model", "A label long enough to need its own line", "Effort"];

/** A sample block, its words standing for whatever an arrangement holds. */
function Swatch({ children }: { children: string }): React.JSX.Element {
  return <span className="catalog-swatch">{children}</span>;
}

function Layout(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="layout-gaps" title="Gap roles">
        <Stack gap={GAP.FIELD}>
          {Object.values(GAP).map((gap) => (
            <Stack key={gap} gap={GAP.TIGHT}>
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {gap}
              </Text>
              <Inline gap={gap}>
                <Swatch>One</Swatch>
                <Swatch>Two</Swatch>
                <Swatch>Three</Swatch>
              </Inline>
            </Stack>
          ))}
        </Stack>
      </CatalogSection>
      <CatalogSection id="layout-justify" title="Along the row">
        <Stack gap={GAP.CONTROL}>
          {Object.values(JUSTIFY).map((justify) => (
            <div key={justify} className="catalog-frame">
              <Inline justify={justify}>
                <Swatch>{justify}</Swatch>
                <Swatch>Second</Swatch>
              </Inline>
            </div>
          ))}
        </Stack>
      </CatalogSection>
      <CatalogSection id="layout-align" title="Across the column">
        <Inline gap={GAP.CONTROL} align={ALIGN.START}>
          {[ALIGN.START, ALIGN.CENTER, ALIGN.END, ALIGN.STRETCH].map((align) => (
            <div key={align} className="catalog-frame catalog-frame-wide">
              <Stack align={align} gap={GAP.TIGHT}>
                <Swatch>{align}</Swatch>
                <Swatch>Wider second</Swatch>
              </Stack>
            </div>
          ))}
        </Inline>
      </CatalogSection>
      <CatalogSection id="layout-narrow" title="Narrow column, long labels">
        <Stack gap={GAP.CONTROL}>
          <div className="catalog-narrow">
            <Inline>
              {LABELS.map((label) => (
                <Swatch key={label}>{label}</Swatch>
              ))}
            </Inline>
          </div>
          <div className="catalog-narrow">
            <Inline wrap={false}>
              {LABELS.map((label) => (
                <Swatch key={label}>{label}</Swatch>
              ))}
            </Inline>
          </div>
        </Stack>
      </CatalogSection>
      <CatalogSection id="layout-fill" title="Fill">
        <Inline gap={GAP.CONTROL} align={ALIGN.START}>
          <div className="catalog-fill-pane">
            <Swatch>Head</Swatch>
            <Fill>
              <Swatch>Column body</Swatch>
            </Fill>
          </div>
          <div className="catalog-fill-pane">
            <Swatch>Head</Swatch>
            <Fill flow={FILL_FLOW.ROW} clip>
              <Swatch>A row body whose words run past its edge and are cut there</Swatch>
            </Fill>
          </div>
        </Inline>
      </CatalogSection>
    </>
  );
}

export const LAYOUT_EXAMPLE: Example = {
  id: "layout",
  title: "Stack, Inline, and Fill",
  Render: Layout,
};
