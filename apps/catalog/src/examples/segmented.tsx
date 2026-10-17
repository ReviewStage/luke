import { GAP, Segmented, Stack } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * segmented.tsx -- a segmented control with one chosen, with none chosen,
 * unavailable, and in a row too narrow for its segments.
 */

const EFFORTS = ["Low", "Medium", "High", "Highest"] as const;
type Effort = (typeof EFFORTS)[number];
const OPTIONS = EFFORTS.map((value) => ({ value, label: value }));

function Held({
  start,
  disabled = false,
}: {
  start: Effort | undefined;
  disabled?: boolean;
}): React.JSX.Element {
  const [effort, setEffort] = useState(start);
  return (
    <Segmented<Effort>
      legend="Effort"
      options={OPTIONS}
      value={effort}
      disabled={disabled}
      clearable
      onChange={setEffort}
    />
  );
}

function SegmentedExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="segmented-states" title="States">
        <Stack gap={GAP.CONTROL} align="start">
          <Held start="Medium" />
          <Held start={undefined} />
          <Held start="High" disabled />
        </Stack>
      </CatalogSection>
      <CatalogSection id="segmented-narrow" title="Narrow column">
        <div className="catalog-narrow">
          <Held start="Highest" />
        </div>
      </CatalogSection>
    </>
  );
}

export const SEGMENTED_EXAMPLE: Example = {
  id: "segmented",
  title: "Segmented control",
  Render: SegmentedExample,
};
