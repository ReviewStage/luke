import {
  BUTTON_VARIANT,
  Button,
  ErrorState,
  SETTINGS_SECTION_FRAME,
  SettingsLine,
  SettingsRow,
  type SettingsRowControl,
  SettingsSection,
  Switch,
  TextArea,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * settings-section.tsx -- a headed section of rows, one with no heading,
 * one holding a single row, one with a long heading and long rows in a
 * column narrower than the 380px a row's controls drop below its words
 * under, one with no card around a text area that draws its own frame, and
 * lines in the rows' place: a note before rows, a note alone, and a read
 * that failed with its Retry.
 */

/** A switch holding its own state, named `label` and described and failed by its row. */
function HeldSwitch({ label, control }: { label: string; control: SettingsRowControl }) {
  const [on, setOn] = useState(true);
  return (
    <Switch
      checked={on}
      label={label}
      describedBy={control["aria-describedby"]}
      aria-invalid={control["aria-invalid"]}
      onChange={setOn}
    />
  );
}

function SwitchRow({ label, description }: { label: string; description?: string }) {
  return (
    <SettingsRow label={label} description={description}>
      {(control) => <HeldSwitch label={label} control={control} />}
    </SettingsRow>
  );
}

/** A text area holding its own words. */
function HeldTextArea() {
  const [text, setText] = useState("");
  return (
    <TextArea
      label="Prompt"
      rows={4}
      placeholder="Find the flakiest test in CI this week and fix it."
      value={text}
      onChange={setText}
    />
  );
}

function SettingsSections(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="settings-section-headed" title="Headed">
        <div className="catalog-settings">
          <SettingsSection title="General">
            <SwitchRow
              label="Launch at login"
              description="Luke opens with the Mac, in the menu bar."
            />
            <SwitchRow
              label="Show captions"
              description="Words the call hears stand under its video."
            />
            <SettingsRow label="Sign out">
              {() => <Button variant={BUTTON_VARIANT.OUTLINE}>Sign out</Button>}
            </SettingsRow>
          </SettingsSection>
        </div>
      </CatalogSection>
      <CatalogSection id="settings-section-bare" title="No heading, one row">
        <div className="catalog-settings">
          <SettingsSection>
            <SwitchRow label="Play a sound when a run finishes" />
          </SettingsSection>
        </div>
      </CatalogSection>
      <CatalogSection id="settings-section-narrow" title="Narrower than 380px, long words">
        <div className="catalog-settings catalog-settings-narrow">
          <SettingsSection title="Coding agents that open pull requests against acme/a-repository-whose-name-runs-long">
            <SettingsRow
              label="Archive a coding agent's run once its pull request merges into the default branch"
              description="Runs whose branch merged stop showing in Factory."
            >
              {() => <Button variant={BUTTON_VARIANT.OUTLINE}>Choose repositories</Button>}
            </SettingsRow>
            <SwitchRow label="Notify me" />
          </SettingsSection>
        </div>
      </CatalogSection>
      <CatalogSection id="settings-section-frameless" title="No card, one text area">
        <div className="catalog-settings">
          <SettingsSection title="Prompt" frame={SETTINGS_SECTION_FRAME.NONE}>
            <HeldTextArea />
          </SettingsSection>
        </div>
      </CatalogSection>
      <CatalogSection id="settings-section-lines" title="Lines in the rows' place">
        <div className="catalog-settings">
          <SettingsSection title="Repositories">
            <SettingsLine>
              Run checks the agent's pushed branch out on this Mac and opens a terminal on it.
              Commands are kept on this Mac only.
            </SettingsLine>
            <SwitchRow label="acme/ledger" />
          </SettingsSection>
          <SettingsSection title="Invitations">
            <SettingsLine>Nobody is invited yet.</SettingsLine>
          </SettingsSection>
          <SettingsSection title="Members">
            <SettingsLine>
              <ErrorState onRetry={() => undefined}>The members could not be read.</ErrorState>
            </SettingsLine>
          </SettingsSection>
        </div>
      </CatalogSection>
    </>
  );
}

export const SETTINGS_SECTION_EXAMPLE: Example = {
  id: "settings-section",
  title: "Settings section",
  Render: SettingsSections,
};
