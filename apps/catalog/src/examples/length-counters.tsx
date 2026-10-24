import { FormField, GAP, LengthCounter, Stack, TextField } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * length-counters.tsx -- a field's counter standing hidden while its words
 * are well short of the limit, and drawn at four fifths of it and at the
 * limit; and one a field drives, ticking as its words change.
 */

/** A field with a limit of 24, its counter on the label's line, as a caller draws it. */
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
