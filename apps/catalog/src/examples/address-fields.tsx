import { AddressField, GAP, Stack } from "@repo/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function Held({ start, disabled }: { start: string; disabled?: boolean }): React.JSX.Element {
  const [value, setValue] = useState(start);
  return (
    <AddressField value={value} onChange={setValue} onOpen={() => undefined} disabled={disabled} />
  );
}

function AddressFields(): React.JSX.Element {
  return (
    <CatalogSection id="address-field" title="Empty, filled, and unavailable">
      <Stack gap={GAP.CONTROL}>
        <Held start="" />
        <Held start="localhost:3000/settings" />
        <Held start="localhost:3000" disabled />
      </Stack>
    </CatalogSection>
  );
}

export const ADDRESS_FIELDS_EXAMPLE: Example = {
  id: "address-fields",
  title: "Address fields",
  Render: AddressFields,
};
