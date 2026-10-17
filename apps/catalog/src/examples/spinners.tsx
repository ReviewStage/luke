import {
  BUTTON_VARIANT,
  BusyLabel,
  Button,
  GAP,
  Inline,
  SPINNER_SIZE,
  Spinner,
  SpinnerRegion,
  SpinnerRing,
  Stack,
  TEXT_TONE,
  Text,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * spinners.tsx -- a wait beside words and alone in a region, the ring as a
 * mark, and a control's words giving way to it beside the same words at
 * rest, so the two stand the same width.
 */

function Spinners(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="spinner-sizes" title="Waits">
        <Inline gap={GAP.FIELD}>
          <Inline gap={GAP.ICON}>
            <Spinner label="Loading members" />
            <Text tone={TEXT_TONE.MUTED}>Reading members</Text>
          </Inline>
          <Spinner label="Loading transcript" size={SPINNER_SIZE.REGION} />
          <span className="catalog-ring">
            <SpinnerRing />
          </span>
        </Inline>
      </CatalogSection>
      <CatalogSection id="spinner-region" title="A region still being read">
        <div className="catalog-frame catalog-region">
          <SpinnerRegion label="Loading plans" />
        </div>
      </CatalogSection>
      <CatalogSection id="spinner-busy" title="A control's words giving way">
        <Stack gap={GAP.CONTROL} align="start">
          {[false, true].map((busy) => (
            <Button key={String(busy)} variant={BUTTON_VARIANT.OUTLINE}>
              <BusyLabel busy={busy} label="Checking for updates">
                Check for updates
              </BusyLabel>
            </Button>
          ))}
        </Stack>
      </CatalogSection>
    </>
  );
}

export const SPINNERS_EXAMPLE: Example = { id: "spinners", title: "Spinners", Render: Spinners };
