import { FormField, GAP, Stack } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * form-field.tsx -- a field with a label alone, with a description, with an
 * error, and with long words in a narrow column. The control is a bare
 * input standing in for the text controls that come after it.
 */

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
