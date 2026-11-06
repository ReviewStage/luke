import {
  ALIGN,
  BUTTON_VARIANT,
  BusyLabel,
  Button,
  GAP,
  Inline,
  Shimmer,
  Stack,
  TEXT_TONE,
  Text,
  WorkingMark,
} from "@repo/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function LoadingIndicators(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="working-mark" title="Working mark">
        <Stack gap={GAP.CONTROL} align={ALIGN.START}>
          <Inline gap={GAP.FIELD}>
            <WorkingMark />
          </Inline>
          <Inline gap={GAP.FIELD}>
            <WorkingMark />
            <Text tone={TEXT_TONE.MUTED}>Sweeping flaky tests</Text>
          </Inline>
        </Stack>
      </CatalogSection>
      <CatalogSection id="shimmer" title="Shimmer">
        <Shimmer>Working…</Shimmer>
      </CatalogSection>
      <CatalogSection id="delayed-busy" title="A busy control that waits a moment to show its ring">
        <Stack gap={GAP.CONTROL} align={ALIGN.START}>
          <Button variant={BUTTON_VARIANT.OUTLINE}>
            <BusyLabel busy delay label="Saving">
              Save
            </BusyLabel>
          </Button>
        </Stack>
      </CatalogSection>
    </>
  );
}

export const LOADING_INDICATORS_EXAMPLE: Example = {
  id: "loading-indicators",
  title: "Loading indicators",
  Render: LoadingIndicators,
};
