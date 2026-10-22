import { FormField, GAP, Stack, TextField } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * form-field.tsx -- a field with a label alone, with a description, with an
 * error, with long words in a narrow column, and one counting its words
 * against its limit once they near it. The control is a bare input standing
 * in for the text controls that come after it, but for the counted one,
 * whose count follows a real field's typing.
 */

/** How many characters the counted example takes at most. */
const NAME_LIMIT = 24;

/** A name a few characters short of its limit, so its count already stands. */
function CountedField(): React.JSX.Element {
  const [name, setName] = useState("Acme design systems");
  return (
    <FormField
      label="Workspace name"
      description="Everyone in the workspace sees it."
      count={{ length: name.length, limit: NAME_LIMIT }}
    >
      {(control) => (
        <TextField field={control} value={name} onChange={setName} maxLength={NAME_LIMIT} />
      )}
    </FormField>
  );
}

function SampleInput(control: React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return <input {...control} className="catalog-input" type="text" defaultValue="Acme" />;
}

function FormFields(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="field-states" title="States">
        <div className="catalog-column">
          <Stack gap={GAP.FIELD}>
            <FormField label="Workspace name">
              {(control) => <SampleInput {...control} />}
            </FormField>
            <FormField label="Workspace name" description="Everyone in the workspace sees it.">
              {(control) => <SampleInput {...control} />}
            </FormField>
            <FormField
              label="Workspace name"
              description="Everyone in the workspace sees it."
              error="A workspace by that name already exists."
            >
              {(control) => <SampleInput {...control} />}
            </FormField>
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="field-counted" title="Counted near its limit">
        <div className="catalog-column">
          <CountedField />
        </div>
      </CatalogSection>
      <CatalogSection id="field-narrow" title="Narrow column, long words">
        <div className="catalog-narrow">
          <FormField
            label="The repository an automation's runs check out before they start"
            description="Pick one the workspace's GitHub installation can reach, or the runs start with no checkout at all."
            error="The installation no longer reaches acme/a-repository-whose-name-runs-long."
          >
            {(control) => <SampleInput {...control} />}
          </FormField>
        </div>
      </CatalogSection>
    </>
  );
}

export const FORM_FIELD_EXAMPLE: Example = {
  id: "form-field",
  title: "Form field",
  Render: FormFields,
};
