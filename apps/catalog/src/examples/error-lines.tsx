import { ErrorLine, FormField, GAP, SettingsRow, Stack, TextField } from "@repo/ui";
import { useState } from "react";
import { CATALOG_FAILURE } from "../catalog-failure";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const REFUSED = {
  words: "The GitHub installation no longer reaches acme/old-name.",
  failure: CATALOG_FAILURE,
};

function RefusedField(): React.JSX.Element {
  const [repository, setRepository] = useState("acme/old-name");
  return (
    <FormField label="Repository" error={REFUSED}>
      {(control) => <TextField field={control} value={repository} onChange={setRepository} />}
    </FormField>
  );
}

function ErrorLines(): React.JSX.Element {
  return (
    <CatalogSection id="error-line-places" title="Alone, in a field, and in a Settings row">
      <div className="catalog-column">
        <Stack gap={GAP.FIELD}>
          <ErrorLine error={REFUSED} />
          <RefusedField />
          <SettingsRow
            label="GitHub"
            description="Reads your repositories and opens pull requests."
            error={REFUSED}
          />
        </Stack>
      </div>
    </CatalogSection>
  );
}

export const ERROR_LINES_EXAMPLE: Example = {
  id: "error-lines",
  title: "Error line",
  Render: ErrorLines,
};
