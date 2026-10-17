import { Checkbox, GAP, Stack } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * checkboxes.tsx -- a box unchecked, checked, mixed, and unavailable, and
 * one with long words in a narrow column.
 */

function Held({ start, children }: { start: boolean; children: string }): React.JSX.Element {
  const [checked, setChecked] = useState(start);
  return (
    <Checkbox checked={checked} onChange={setChecked}>
      {children}
    </Checkbox>
  );
}

function Checkboxes(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="checkbox-states" title="States">
        <Stack gap={GAP.CONTROL} align="start">
          <Held start={false}>Include my name and email</Held>
          <Held start>Archive runs that succeed</Held>
          <Checkbox checked={false} mixed onChange={() => undefined}>
            Every server, some chosen
          </Checkbox>
          <Checkbox checked disabled onChange={() => undefined}>
            Unavailable while sending
          </Checkbox>
        </Stack>
      </CatalogSection>
      <CatalogSection id="checkbox-narrow" title="Narrow column, long words">
        <div className="catalog-narrow">
          <Held start>
            Send the transcript of this call, its plan, and the screenshots attached to it with the
            report
          </Held>
        </div>
      </CatalogSection>
    </>
  );
}

export const CHECKBOXES_EXAMPLE: Example = {
  id: "checkboxes",
  title: "Checkboxes",
  Render: Checkboxes,
};
