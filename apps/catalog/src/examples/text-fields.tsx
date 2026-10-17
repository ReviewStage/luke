import {
  FormField,
  GAP,
  SettingsRow,
  Stack,
  TEXT_FIELD_AUTO_COMPLETE,
  TEXT_FIELD_FONT,
  TEXT_FIELD_TYPE,
  TextArea,
  TextField,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * text-fields.tsx -- a TextField empty with a placeholder, filled, invalid,
 * unavailable, as a secret, as code in the mono face, and as a time of day; a TextArea, standing and growing with its
 * words; a TextField in a settings row, invalid while the row says its error;
 * and both in a narrow column.
 */

/** A field the example holds the value of, as a caller would. */
function Held({
  start,
  children,
}: {
  start: string;
  children: (value: string, onChange: (value: string) => void) => React.ReactNode;
}): React.JSX.Element {
  const [value, setValue] = useState(start);
  return <>{children(value, setValue)}</>;
}

function TextFields(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="text-states" title="One line">
        <div className="catalog-column">
          <Stack gap={GAP.FIELD}>
            <Held start="">
              {(value, onChange) => (
                <FormField label="Workspace name">
                  {(field) => (
                    <TextField field={field} value={value} onChange={onChange} placeholder="Acme" />
                  )}
                </FormField>
              )}
            </Held>
            <Held start="Acme">
              {(value, onChange) => (
                <FormField label="Workspace name" error="A workspace by that name already exists.">
                  {(field) => <TextField field={field} value={value} onChange={onChange} />}
                </FormField>
              )}
            </Held>
            <FormField label="Workspace name" description="Only an owner may rename it.">
              {(field) => (
                <TextField field={field} value="Acme" onChange={() => undefined} disabled />
              )}
            </FormField>
            <Held start="sk-synthetic-key">
              {(value, onChange) => (
                <FormField label="API key">
                  {(field) => (
                    <TextField
                      field={field}
                      type={TEXT_FIELD_TYPE.PASSWORD}
                      autoComplete={TEXT_FIELD_AUTO_COMPLETE.OFF}
                      value={value}
                      onChange={onChange}
                    />
                  )}
                </FormField>
              )}
            </Held>
            <Held start="0 9 * * 1-5">
              {(value, onChange) => (
                <FormField label="Cron">
                  {(field) => (
                    <TextField
                      field={field}
                      font={TEXT_FIELD_FONT.MONO}
                      spellCheck={false}
                      value={value}
                      onChange={onChange}
                    />
                  )}
                </FormField>
              )}
            </Held>
            <Held start="09:00">
              {(value, onChange) => (
                <FormField label="Time">
                  {(field) => (
                    <TextField
                      field={field}
                      type={TEXT_FIELD_TYPE.TIME}
                      value={value}
                      onChange={onChange}
                    />
                  )}
                </FormField>
              )}
            </Held>
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="text-area" title="Many lines">
        <div className="catalog-column">
          <Held start={"Plan the release.\nWrite the changelog."}>
            {(value, onChange) => (
              <FormField label="Prompt" description="What the automation asks its agent each run.">
                {(field) => <TextArea field={field} value={value} onChange={onChange} rows={3} />}
              </FormField>
            )}
          </Held>
        </div>
      </CatalogSection>
      <CatalogSection id="text-area-grow" title="Many lines, growing">
        <div className="catalog-column">
          <Held start="">
            {(value, onChange) => (
              <TextArea
                label="Feedback"
                placeholder="What happened, and what did you expect?"
                value={value}
                onChange={onChange}
                rows={5}
                grow
              />
            )}
          </Held>
        </div>
      </CatalogSection>
      <CatalogSection id="text-settings-row" title="In a settings row, invalid">
        <div className="catalog-column">
          <Held start="every night">
            {(value, onChange) => (
              <SettingsRow label="Cron" error="That isn't a schedule Luke can read.">
                {(control) => (
                  <TextField
                    label="Cron"
                    describedBy={control["aria-describedby"]}
                    invalid={control["aria-invalid"]}
                    font={TEXT_FIELD_FONT.MONO}
                    spellCheck={false}
                    value={value}
                    onChange={onChange}
                  />
                )}
              </SettingsRow>
            )}
          </Held>
        </div>
      </CatalogSection>
      <CatalogSection id="text-narrow" title="Narrow column, long value">
        <div className="catalog-narrow">
          <Held start="acme/a-repository-whose-name-runs-past-its-column">
            {(value, onChange) => (
              <TextField label="Repository" value={value} onChange={onChange} />
            )}
          </Held>
        </div>
      </CatalogSection>
    </>
  );
}

export const TEXT_FIELDS_EXAMPLE: Example = {
  id: "text-fields",
  title: "Text fields",
  Render: TextFields,
};
