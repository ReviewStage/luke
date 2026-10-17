import {
  BUTTON_TYPE,
  BUTTON_VARIANT,
  Button,
  FormField,
  FormSection,
  TextArea,
  TextField,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * form-section.tsx -- a headed form of a field and a text area with Cancel
 * and Save at its end; the same form after a save the service refused, a
 * field's error and the form's both standing; and a form with long words in
 * a column too narrow for its actions to share one line.
 */

function WorkspaceForm({
  title,
  description,
  nameError,
  error,
}: {
  title: string;
  description?: string;
  nameError?: string;
  error?: string;
}): React.JSX.Element {
  const [name, setName] = useState("Acme");
  const [about, setAbout] = useState("");
  return (
    <FormSection
      title={title}
      description={description}
      error={error}
      onSubmit={() => {}}
      actions={
        <>
          <Button variant={BUTTON_VARIANT.QUIET}>Cancel</Button>
          <Button variant={BUTTON_VARIANT.PRIMARY} type={BUTTON_TYPE.SUBMIT}>
            Save workspace
          </Button>
        </>
      }
    >
      <FormField label="Workspace name" error={nameError}>
        {(control) => <TextField field={control} value={name} onChange={setName} />}
      </FormField>
      <FormField label="About" description="Everyone in the workspace sees it.">
        {(control) => <TextArea field={control} value={about} onChange={setAbout} rows={3} />}
      </FormField>
    </FormSection>
  );
}

function FormSections(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="form-section-at-rest" title="At rest">
        <div className="catalog-column">
          <WorkspaceForm
            title="Workspace"
            description="How the workspace is shown to its members."
          />
        </div>
      </CatalogSection>
      <CatalogSection id="form-section-refused" title="A refused save">
        <div className="catalog-column">
          <WorkspaceForm
            title="Workspace"
            nameError="A workspace by that name already exists."
            error="The workspace could not be saved. Try again in a moment."
          />
        </div>
      </CatalogSection>
      <CatalogSection id="form-section-narrow" title="Narrow column, long words">
        <div className="catalog-narrow">
          <WorkspaceForm
            title="The workspace an automation's runs report their pull requests to"
            description="Pick one whose GitHub installation reaches acme/a-repository-whose-name-runs-long."
            error="The installation no longer reaches acme/a-repository-whose-name-runs-long."
          />
        </div>
      </CatalogSection>
    </>
  );
}

export const FORM_SECTION_EXAMPLE: Example = {
  id: "form-section",
  title: "Form section",
  Render: FormSections,
};
