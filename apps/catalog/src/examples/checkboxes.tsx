import { Checkbox, GAP, Stack } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * checkboxes.tsx -- a box unchecked, checked, mixed, and unavailable, one
 * with long words in a narrow column, and boxes named by a label of their
 * own, drawn without words, as a task list's markers.
 */

function Held({ start, children }: { start: boolean; children: string }): React.JSX.Element {
  const [checked, setChecked] = useState(start);
  return (
    <Checkbox checked={checked} onChange={setChecked}>
      {children}
    </Checkbox>
  );
}

function Wordless({ label }: { label: string }): React.JSX.Element {
  const [checked, setChecked] = useState(false);
  return <Checkbox label={label} checked={checked} onChange={setChecked} />;
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
      <CatalogSection id="checkbox-wordless" title="Without words, a task list's markers">
        <Stack gap={GAP.CONTROL} align="start">
          <Wordless label="Send the invite" />
          <Checkbox label="Pick a date" checked disabled onChange={() => undefined} />
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
