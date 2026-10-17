import {
  AVATAR_SIZE,
  Avatar,
  BUTTON_VARIANT,
  Button,
  SETTINGS_ROW_DENSITY,
  SettingsRow,
  type SettingsRowControl,
  SettingsSection,
  Switch,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * settings-row.tsx -- a settings row with a switch, led by an account's face,
 * with a button and no description, with a failed write, and with long
 * words, each at a settings page's measure and in a column narrower than the
 * 380px its controls drop below its words under; and compact rows in a
 * popover narrower than that, whose controls stay beside their words.
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

function Rows(): React.JSX.Element {
  return (
    <SettingsSection>
      <SettingsRow label="Launch at login" description="Luke opens with the Mac, in the menu bar.">
        {(control) => <HeldSwitch label="Launch at login" control={control} />}
      </SettingsRow>
      <SettingsRow
        label="ada.lovelace@analytical-engine.example"
        description="Signed in with GitHub"
        leading={<Avatar name="Ada Lovelace" size={AVATAR_SIZE.ACCOUNT} decorative />}
      >
        {() => <Button variant={BUTTON_VARIANT.OUTLINE}>Sign out</Button>}
      </SettingsRow>
      <SettingsRow label="Delete account">
        {() => <Button variant={BUTTON_VARIANT.DANGER_OUTLINE}>Delete account</Button>}
      </SettingsRow>
      <SettingsRow
        label="Show captions"
        description="Words the call hears stand under its video."
        error="The setting could not be saved. Try again."
      >
        {(control) => <HeldSwitch label="Show captions" control={control} />}
      </SettingsRow>
      <SettingsRow
        label="Archive a coding agent's run once its pull request merges into the default branch"
        description="Runs whose branch acme/a-repository-whose-name-runs-long-and-longer merged stop showing in Factory."
      >
        {(control) => (
          <Button variant={BUTTON_VARIANT.OUTLINE} aria-describedby={control["aria-describedby"]}>
            Choose repositories
          </Button>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}

/** Compact rows, bare in a popover that insets them, as a pane's view settings stand. */
function CompactRows(): React.JSX.Element {
  return (
    <div className="catalog-popover catalog-settings-narrow">
      <SettingsRow density={SETTINGS_ROW_DENSITY.COMPACT} label="Wrapping">
        {(control) => <HeldSwitch label="Wrapping" control={control} />}
      </SettingsRow>
      <SettingsRow
        density={SETTINGS_ROW_DENSITY.COMPACT}
        label="Minimize inline comments"
        description="Comments fold to a mark beside their line."
      >
        {(control) => <HeldSwitch label="Minimize inline comments" control={control} />}
      </SettingsRow>
      <SettingsRow
        density={SETTINGS_ROW_DENSITY.COMPACT}
        label="Line numbers"
        error="The setting could not be saved. Try again."
      >
        {(control) => <HeldSwitch label="Line numbers" control={control} />}
      </SettingsRow>
    </div>
  );
}

function SettingsRows(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="settings-row-wide" title="At a settings page's measure">
        <div className="catalog-settings">
          <Rows />
        </div>
      </CatalogSection>
      <CatalogSection id="settings-row-narrow" title="Narrower than 380px">
        <div className="catalog-settings catalog-settings-narrow">
          <Rows />
        </div>
      </CatalogSection>
      <CatalogSection id="settings-row-compact" title="Compact, in a popover">
        <CompactRows />
      </CatalogSection>
    </>
  );
}

export const SETTINGS_ROW_EXAMPLE: Example = {
  id: "settings-row",
  title: "Settings row",
  Render: SettingsRows,
};
