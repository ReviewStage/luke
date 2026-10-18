import {
  AVATAR_SIZE,
  Avatar,
  BUTTON_TYPE,
  BUTTON_VARIANT,
  Button,
  MARK_PROVIDER,
  ProviderMark,
  SETTINGS_ROW_DENSITY,
  SETTINGS_ROW_INDENT,
  SettingsRow,
  type SettingsRowControl,
  SettingsSection,
  Switch,
  TEXT_ELEMENT,
  TEXT_FIELD_TYPE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextField,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * settings-row.tsx -- a settings row with a switch, led by an account's face,
 * with a button and no description, with a failed write, and with long
 * words, each at a settings page's measure and in a column narrower than the
 * 380px its controls drop below its words under; compact rows in a
 * popover narrower than that, whose controls stay beside their words; and
 * list rows, a reference list's lines in a card, each a command and its chord;
 * and the slots: a Modified word riding a label, a key's field grown under
 * its row with a refusal under that, and accounts indented under their
 * provider's row.
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

/** A provider's mark, at the size a row's leading mark stands. */
function Mark({ provider }: { provider: (typeof MARK_PROVIDER)[keyof typeof MARK_PROVIDER] }) {
  return <ProviderMark provider={provider} className="catalog-settings-mark" />;
}

/** A key's field and its presses, grown under the key's row. */
function KeyForm(): React.JSX.Element {
  const [key, setKey] = useState("");
  return (
    <form className="catalog-settings-key" onSubmit={(event) => event.preventDefault()}>
      <TextField
        type={TEXT_FIELD_TYPE.PASSWORD}
        label="Linear API key"
        placeholder="Paste your Linear API key"
        value={key}
        onChange={setKey}
      />
      <Button variant={BUTTON_VARIANT.OUTLINE}>Cancel</Button>
      <Button type={BUTTON_TYPE.SUBMIT} variant={BUTTON_VARIANT.PRIMARY}>
        Save
      </Button>
    </form>
  );
}

/** The row's slots: an adornment on the label's line, what a row grows below it, and indented rows. */
function SlottedRows(): React.JSX.Element {
  return (
    <SettingsSection>
      <SettingsRow
        label="Show captions"
        adornment={
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE} as={TEXT_ELEMENT.SPAN}>
            Modified
          </Text>
        }
      >
        {(control) => <HeldSwitch label="Show captions" control={control} />}
      </SettingsRow>
      <SettingsRow
        label="Linear"
        leading={<Mark provider={MARK_PROVIDER.LINEAR} />}
        below={<KeyForm />}
        error="Linear did not accept this key. Check it and try again."
      >
        {() => null}
      </SettingsRow>
      <SettingsRow
        label="GitHub"
        description="Add accounts and choose repositories on GitHub."
        leading={<Mark provider={MARK_PROVIDER.GITHUB} />}
      >
        {() => <Button variant={BUTTON_VARIANT.OUTLINE}>Manage on GitHub</Button>}
      </SettingsRow>
      <SettingsRow
        indent={SETTINGS_ROW_INDENT.MARK}
        label="acme"
        description="Connected"
        leading={<Mark provider={MARK_PROVIDER.GITHUB} />}
      >
        {() => null}
      </SettingsRow>
      <SettingsRow
        indent={SETTINGS_ROW_INDENT.MARK}
        label="ada-lovelace"
        description="Suspended on GitHub"
        leading={<Mark provider={MARK_PROVIDER.GITHUB} />}
      >
        {() => null}
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

/** List rows, a reference read down rather than set, as the window's keyboard shortcuts stand. */
function ListRows(): React.JSX.Element {
  const commands = [
    { label: "Command palette", chord: "⌘K" },
    { label: "Find previous", chord: "⇧⌘G" },
    { label: "Permanently delete task", chord: "⌥⌘⌫" },
  ];
  return (
    <SettingsSection title="General">
      {commands.map((command) => (
        <SettingsRow key={command.label} density={SETTINGS_ROW_DENSITY.LIST} label={command.label}>
          {() => (
            <Text variant={TEXT_VARIANT.LABEL} tone={TEXT_TONE.MUTED}>
              {command.chord}
            </Text>
          )}
        </SettingsRow>
      ))}
    </SettingsSection>
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
      <CatalogSection id="settings-row-slots" title="Adornment, below, and indented">
        <div className="catalog-settings">
          <SlottedRows />
        </div>
      </CatalogSection>
      <CatalogSection id="settings-row-slots-narrow" title="The slots narrower than 380px">
        <div className="catalog-settings catalog-settings-narrow">
          <SlottedRows />
        </div>
      </CatalogSection>
      <CatalogSection id="settings-row-compact" title="Compact, in a popover">
        <CompactRows />
      </CatalogSection>
      <CatalogSection id="settings-row-list" title="List, a reference in a card">
        <div className="catalog-settings">
          <ListRows />
        </div>
      </CatalogSection>
    </>
  );
}

export const SETTINGS_ROW_EXAMPLE: Example = {
  id: "settings-row",
  title: "Settings row",
  Render: SettingsRows,
};
