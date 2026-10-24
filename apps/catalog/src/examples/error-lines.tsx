import { ErrorLine, FormField, GAP, SettingsRow, Stack, TextField } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * error-lines.tsx -- the one line a refusal is said in: alone, under a form
 * field, and under a Settings row, each the same line in the same ink.
 */

/** The refusal every sample says. */
const REFUSED = "The GitHub installation no longer reaches acme/old-name.";

/** A form field whose value was refused. */
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
          <ErrorLine>{REFUSED}</ErrorLine>
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
