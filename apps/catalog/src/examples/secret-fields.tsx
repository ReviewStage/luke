import { GAP, SecretField, Stack } from "@repo/ui";
import type { ShownError } from "@repo/ui/reported-failure";
import { useState } from "react";
import { CATALOG_FAILURE } from "../catalog-failure";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

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
  error?: ShownError;
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
          <Sample label="Personal access token" start="ghp_catalog_example_token" />
          <Sample label="Personal access token" saved />
          <Sample
            label="Anthropic API key"
            error={{
              words: "Anthropic refused the key. Check it was copied whole, then try again.",
              failure: CATALOG_FAILURE,
            }}
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
