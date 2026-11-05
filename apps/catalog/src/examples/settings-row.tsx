import { PRODUCT_NAME } from "@repo/features/product-name";
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import {
  AVATAR_SIZE,
  Avatar,
  BUTTON_TYPE,
  BUTTON_VARIANT,
  Button,
  IconButton,
  Inline,
  JUSTIFY,
  MARK_PROVIDER,
  MoreButton,
  PlusIcon,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  SETTINGS_ROW_DENSITY,
  SETTINGS_ROW_INDENT,
  SETTINGS_ROW_STATE,
  SettingsAttentionMark,
  SettingsChangedMark,
  SettingsFacts,
  SettingsFoldFoot,
  SettingsFoldLine,
  SettingsFoldRow,
  SettingsRow,
  SettingsRowActSlot,
  type SettingsRowControl,
  SettingsRowMark,
  SettingsRowStateLine,
  SettingsRowsFold,
  SettingsRowValue,
  SettingsSavedMark,
  SettingsSection,
  Shortcut,
  Switch,
  TEXT_BUTTON_TONE,
  TEXT_ELEMENT,
  TEXT_FIELD_TYPE,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextButton,
  TextField,
} from "@repo/ui";
import { ExternalLinkIcon, GLYPH } from "@repo/ui/icons";
import { useState } from "react";
import { CATALOG_FAILURE } from "../catalog-failure";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * settings-row.tsx -- a settings row with a switch, led by an account's face,
 * with a button and no description, with a failed write, and with long
 * words, each at a settings page's measure and in a column narrower than the
 * 380px its name fades under; a row whose two presses would squeeze its
 * words in a column a little wider than that, which drops them below its
 * words, beside a row whose one press still fits; compact rows in a
 * popover narrower than 380px, whose controls stay beside their words; and
 * list rows, a reference list's lines in a card, each a command and its chord;
 * and the slots: a Modified word riding a label, a key's field grown under
 * its row with a refusal under that, and accounts indented under their
 * provider's row; and accounts that fold their repositories open under
 * their words, one open from the start with a long name among them, one
 * folded with Show all at its foot, one with a ⋯ before its chevron, at a page's measure and
 * narrower than 380px; and integrations that fold the rows they own under
 * their own row, closed until pressed, beside one that owns none.
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
      <SettingsRow
        label="Launch at login"
        description={`${PRODUCT_NAME} opens with the Mac, in the menu bar.`}
      >
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
        error={{ words: "The setting could not be saved. Try again.", failure: CATALOG_FAILURE }}
      >
        {(control) => <HeldSwitch label="Show captions" control={control} />}
      </SettingsRow>
      <SettingsRow
        label="Archive an agent's run once its pull request merges into the default branch"
        description="Runs whose branch acme/a-repository-whose-name-runs-long-and-longer merged stop showing in the sidebar."
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
  return <ProviderMark provider={provider} size={PROVIDER_MARK_SIZE.ROW} />;
}

/** A key's field and its presses, grown under the key's row. */
function KeyForm(): React.JSX.Element {
  const [key, setKey] = useState("");
  return (
    <form className="catalog-settings-key" noValidate onSubmit={(event) => event.preventDefault()}>
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
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
            Modified
          </Text>
        }
      >
        {(control) => <HeldSwitch label="Show captions" control={control} />}
      </SettingsRow>
      <SettingsRow
        label="Linear"
        leading={<Mark provider={MARK_PROVIDER.LINEAR} />}
        below={() => <KeyForm />}
        error={{
          words: "Linear did not accept this key. Check it and try again.",
          failure: CATALOG_FAILURE,
        }}
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

/** A row whose two presses leave its words too little room beside them, as Workspace connections' GitHub stands, and a row whose one press leaves enough. */
function PressRows(): React.JSX.Element {
  return (
    <SettingsSection>
      <SettingsRow
        label="GitHub"
        description="Add accounts and choose repositories on GitHub."
        leading={<Mark provider={MARK_PROVIDER.GITHUB} />}
      >
        {() => (
          <>
            <Button variant={BUTTON_VARIANT.OUTLINE} icon={<PlusIcon />}>
              Add repository
            </Button>
            <Button variant={BUTTON_VARIANT.OUTLINE} icon={<ExternalLinkIcon aria-hidden="true" />}>
              Manage on GitHub
            </Button>
          </>
        )}
      </SettingsRow>
      <SettingsRow
        label="Sentry"
        description="Not installed. Install to start automations from Sentry alerts."
        leading={<Mark provider={MARK_PROVIDER.SENTRY} />}
      >
        {() => <Button variant={BUTTON_VARIANT.OUTLINE}>Install for workspace</Button>}
      </SettingsRow>
    </SettingsSection>
  );
}

/** What a row's line says about its subject, a mark led by its own box, and a value ending in a column. */
function StateRows(): React.JSX.Element {
  return (
    <SettingsSection>
      <SettingsRow
        label="GitHub"
        leading={
          <SettingsRowMark>
            <Mark provider={MARK_PROVIDER.GITHUB} />
          </SettingsRowMark>
        }
        description={
          <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
            Connected
          </SettingsRowStateLine>
        }
      >
        {() => <Button variant={BUTTON_VARIANT.OUTLINE}>Manage</Button>}
      </SettingsRow>
      <SettingsRow
        label="Linear"
        leading={
          <SettingsRowMark>
            <Mark provider={MARK_PROVIDER.LINEAR} />
          </SettingsRowMark>
        }
        description={
          <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION} wrap>
            The key expired · Reconnect
          </SettingsRowStateLine>
        }
      >
        {() => null}
      </SettingsRow>
      <SettingsRow
        label="Voice"
        adornment={
          <>
            <SettingsChangedMark />
            <SettingsAttentionMark note="Needs an API key" />
          </>
        }
      >
        {() => null}
      </SettingsRow>
      <SettingsRow label="Ada Lovelace" description="ada@example.com">
        {() => (
          <>
            <SettingsRowValue>Admin</SettingsRowValue>
            <SettingsRowActSlot />
          </>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}

/** A saved credential's facts beside its presses, wrapping where the line is narrow. */
function FactsLine(): React.JSX.Element {
  return (
    <Inline justify={JUSTIFY.BETWEEN}>
      <SettingsFacts>
        <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>Connected</SettingsRowStateLine>
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} font={TEXT_FONT.MONO}>
          sk-…a1b2
        </Text>
      </SettingsFacts>
      <Button variant={BUTTON_VARIANT.OUTLINE}>
        Connected
        <SettingsSavedMark />
      </Button>
    </Inline>
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
        error={{ words: "The setting could not be saved. Try again.", failure: CATALOG_FAILURE }}
      >
        {(control) => <HeldSwitch label="Line numbers" control={control} />}
      </SettingsRow>
    </div>
  );
}

/** List rows, a reference read down rather than set, as the window's keyboard shortcuts stand. */
function ListRows(): React.JSX.Element {
  const commands = [
    APP_SHORTCUTS[APP_COMMAND.COMMAND_PALETTE],
    APP_SHORTCUTS[APP_COMMAND.FIND_PREVIOUS],
    APP_SHORTCUTS[APP_COMMAND.DELETE],
  ];
  return (
    <SettingsSection title="General">
      {commands.map((command) => (
        <SettingsRow key={command.label} density={SETTINGS_ROW_DENSITY.LIST} label={command.label}>
          {() => <Shortcut chord={command.chord} value spoken />}
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}

/** Accounts under their provider's row that fold their repositories open under their words. */
function FoldRows(): React.JSX.Element {
  return (
    <SettingsSection>
      <SettingsRow label="GitHub" leading={<Mark provider={MARK_PROVIDER.GITHUB} />}>
        {() => <Button variant={BUTTON_VARIANT.OUTLINE}>Manage on GitHub</Button>}
      </SettingsRow>
      <SettingsFoldRow
        indent={SETTINGS_ROW_INDENT.MARK}
        label="ada-lovelace"
        description="3 repositories"
        leading={<Mark provider={MARK_PROVIDER.GITHUB} />}
        foldLabel="ada-lovelace's repositories"
        defaultOpen
      >
        <SettingsFoldLine>dotfiles</SettingsFoldLine>
        <SettingsFoldLine>ada-lovelace.github.io</SettingsFoldLine>
        <SettingsFoldLine>
          notes-on-the-analytical-engine-and-the-sketch-of-its-operation
        </SettingsFoldLine>
      </SettingsFoldRow>
      <SettingsFoldRow
        indent={SETTINGS_ROW_INDENT.MARK}
        label="analytical-engine"
        description="All 24 repositories"
        leading={<Mark provider={MARK_PROVIDER.GITHUB} />}
        foldLabel="analytical-engine's repositories"
      >
        <SettingsFoldLine>mill</SettingsFoldLine>
        <SettingsFoldLine>store</SettingsFoldLine>
        <SettingsFoldFoot>
          <TextButton tone={TEXT_BUTTON_TONE.ACCENT} onClick={() => undefined}>
            Show all 24
          </TextButton>
        </SettingsFoldFoot>
      </SettingsFoldRow>
      <SettingsFoldRow
        indent={SETTINGS_ROW_INDENT.MARK}
        label="byron"
        description="2 repositories"
        leading={<Mark provider={MARK_PROVIDER.GITHUB} />}
        foldLabel="byron's repositories"
        defaultOpen
        actions={() => <MoreButton thing="byron" />}
      >
        <SettingsFoldLine>poems</SettingsFoldLine>
        <SettingsFoldLine>letters</SettingsFoldLine>
      </SettingsFoldRow>
    </SettingsSection>
  );
}

/** Integrations that fold their own rows under their row, closed until pressed, and one with no rows to fold. */
function RowsFoldRows(): React.JSX.Element {
  return (
    <SettingsSection title="Workspace connections">
      <SettingsRowsFold
        label="GitHub accounts"
        head={(chevron) => (
          <SettingsRow
            label="GitHub"
            description={
              <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
                Connected
              </SettingsRowStateLine>
            }
            leading={<Mark provider={MARK_PROVIDER.GITHUB} />}
          >
            {() => (
              <>
                <Button
                  variant={BUTTON_VARIANT.OUTLINE}
                  icon={<ExternalLinkIcon aria-hidden="true" />}
                >
                  Manage on GitHub
                </Button>
                {chevron}
              </>
            )}
          </SettingsRow>
        )}
        rows={
          <SettingsFoldRow
            indent={SETTINGS_ROW_INDENT.MARK}
            label="analytical-engine"
            description="All 3 repositories"
            leading={<Mark provider={MARK_PROVIDER.GITHUB} />}
            foldLabel="analytical-engine's repositories"
          >
            <SettingsFoldLine>mill</SettingsFoldLine>
            <SettingsFoldLine>store</SettingsFoldLine>
            <SettingsFoldLine>cards</SettingsFoldLine>
          </SettingsFoldRow>
        }
      />
      <SettingsRowsFold
        label="Slack settings"
        head={(chevron) => (
          <SettingsRow
            label="Slack"
            description={
              <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
                Connected
              </SettingsRowStateLine>
            }
            leading={<Mark provider={MARK_PROVIDER.SLACK} />}
          >
            {() => (
              <>
                <Button variant={BUTTON_VARIANT.OUTLINE} icon={<PlusIcon />}>
                  Add channel
                </Button>
                <IconButton icon={<GLYPH.DISCONNECT />} label="Disconnect" />
                {chevron}
              </>
            )}
          </SettingsRow>
        )}
        rows={
          <>
            <SettingsRow indent={SETTINGS_ROW_INDENT.MARK} label="Default repository">
              {() => <SettingsRowValue>analytical-engine/mill</SettingsRowValue>}
            </SettingsRow>
            <SettingsRow indent={SETTINGS_ROW_INDENT.MARK} label="# engineering">
              {() => <SettingsRowValue>Default</SettingsRowValue>}
            </SettingsRow>
            <SettingsRow label="Slack notifications">
              {(control) => <HeldSwitch label="Slack notifications" control={control} />}
            </SettingsRow>
          </>
        }
      />
      <SettingsRowsFold
        label="Sentry settings"
        head={(chevron) => (
          <SettingsRow
            label="Sentry"
            description={
              <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
                Connected
              </SettingsRowStateLine>
            }
            leading={<Mark provider={MARK_PROVIDER.SENTRY} />}
          >
            {() => (
              <>
                <IconButton icon={<GLYPH.DISCONNECT />} label="Disconnect" />
                {chevron}
              </>
            )}
          </SettingsRow>
        )}
      />
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
      <CatalogSection id="settings-row-presses" title="Two presses, past 380px but too wide to fit">
        <div className="catalog-settings catalog-settings-between">
          <PressRows />
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
      <CatalogSection id="settings-row-fold" title="Folding what a row owns">
        <div className="catalog-settings">
          <FoldRows />
        </div>
      </CatalogSection>
      <CatalogSection id="settings-row-fold-narrow" title="Folding narrower than 380px">
        <div className="catalog-settings catalog-settings-narrow">
          <FoldRows />
        </div>
      </CatalogSection>
      <CatalogSection id="settings-row-rows-fold" title="Folding the rows a row owns">
        <div className="catalog-settings">
          <RowsFoldRows />
        </div>
      </CatalogSection>
      <CatalogSection id="settings-row-state" title="State, mark, and value">
        <div className="catalog-settings">
          <StateRows />
        </div>
      </CatalogSection>
      <CatalogSection id="settings-row-facts" title="Facts beside presses">
        <FactsLine />
        <div className="catalog-narrow">
          <FactsLine />
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
