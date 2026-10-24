import { GAP, SecretField, Stack } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * secret-fields.tsx -- a secret pasted for the first time, masked until its
 * press shows it; one already kept, which says Saved and never shows it; one
 * the service refused; and one that may be left empty.
 */

/** A secret field holding what the catalog types into it. */
function Sample({
  label,
  saved = false,
  optional = false,
  error,
  start = "",
}: {
  label: string;
  saved?: boolean;
  optional?: boolean;
  error?: string;
  start?: string;
}): React.JSX.Element {
  const [value, setValue] = useState(start);
  return (
    <SecretField
      label={label}
      saved={saved}
      optional={optional}
      error={error}
      placeholder="ghp_…"
      value={value}
      onChange={setValue}
    />
  );
}

function SecretFields(): React.JSX.Element {
  return (
    <CatalogSection id="secret-field-states" title="States">
      <div className="catalog-column">
        <Stack gap={GAP.FIELD}>
          <Sample label="Personal access token" start="ghp_16C7e42F292c6912E7710c838347Ae178B4a" />
          <Sample label="Personal access token" saved />
          <Sample
            label="Anthropic API key"
            error="Anthropic refused the key. Check it was copied whole, then try again."
            start="sk-ant-not-a-real-key"
          />
          <Sample label="Webhook signing secret" optional />
        </Stack>
      </div>
    </CatalogSection>
  );
}

export const SECRET_FIELDS_EXAMPLE: Example = {
  id: "secret-fields",
  title: "Secret field",
  Render: SecretFields,
};
