import { FormField, GAP, LengthCounter, Stack, TextField } from "@repo/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function LimitedField(): React.JSX.Element {
  const [value, setValue] = useState("A name that is nearly too");
  return (
    <FormField label="Name" count={{ length: value.length, limit: 24 }}>
      {(field) => <TextField field={field} value={value} onChange={setValue} />}
    </FormField>
  );
}

function LengthCounters(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="length-counter-states" title="Short of the limit, near it, and at it">
        <Stack gap={GAP.CONTROL}>
          <LengthCounter length={10} limit={64} />
          <LengthCounter length={52} limit={64} />
          <LengthCounter length={64} limit={64} />
        </Stack>
      </CatalogSection>
      <CatalogSection id="length-counter-field" title="Beside the field it counts">
        <LimitedField />
      </CatalogSection>
    </>
  );
}

export const LENGTH_COUNTERS_EXAMPLE: Example = {
  id: "length-counters",
  title: "Length counters",
  Render: LengthCounters,
};
