import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  BackButton,
  BUTTON_VARIANT,
  Button,
  EmptyState,
  PlugIcon,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  Switch,
  TOOLBAR_LOOK,
  type ToolbarLook,
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function HeldSwitch({ label, describedBy }: { label: string; describedBy: string | undefined }) {
  const [on, setOn] = useState(true);
  return <Switch checked={on} label={label} describedBy={describedBy} onChange={setOn} />;
}

function SwitchRow({ label, description }: { label: string; description?: string }) {
  return (
    <SettingsRow label={label} description={description}>
      {(control) => <HeldSwitch label={label} describedBy={control["aria-describedby"]} />}
    </SettingsRow>
  );
}

function Page({ title, look }: { title: string; look?: ToolbarLook }): React.JSX.Element {
  return (
    <SettingsPage
      title={title}
      look={look}
      lead={
        look === TOOLBAR_LOOK.PHONE ? (
          <BackButton label="Settings" place="settings" onBack={() => undefined} />
        ) : undefined
      }
      actions={<Button variant={BUTTON_VARIANT.QUIET}>Reset</Button>}
    >
      <SettingsSection title="General">
        <SwitchRow
          label="Launch at login"
          description={`${PRODUCT_NAME} opens with the Mac, in the menu bar.`}
        />
        <SwitchRow
          label="Show captions"
          description="Words the call hears stand under its video."
        />
      </SettingsSection>
      <SettingsSection title="Agents">
        <SwitchRow
          label="Archive a run once its pull request merges"
          description="Runs whose branch merged stop showing in the sidebar."
        />
        <SettingsRow label="Repositories">
          {() => <Button variant={BUTTON_VARIANT.OUTLINE}>Choose repositories</Button>}
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Notifications">
        <SwitchRow label="Play a sound when a run finishes" />
        <SwitchRow label="Notify me when a run needs an answer" />
      </SettingsSection>
      <SettingsSection title="Account">
        <SettingsRow label="Sign out" description="dev@example.com">
          {() => <Button variant={BUTTON_VARIANT.OUTLINE}>Sign out</Button>}
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  );
}

function SettingsPages(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="settings-page-wide" title="A page that scrolls">
        <div className="catalog-settings-frame">
          <Page title="General" />
        </div>
      </CatalogSection>
      <CatalogSection id="settings-page-narrow" title="Narrower than 480px, a long title">
        <div className="catalog-settings-frame catalog-settings-frame-narrow">
          <Page title="Agents and their pull requests" />
        </div>
      </CatalogSection>
      <CatalogSection id="settings-page-phone" title="On a phone, its actions ending the bar">
        <div className="catalog-settings-frame catalog-settings-frame-narrow">
          <Page title="General" look={TOOLBAR_LOOK.PHONE} />
        </div>
      </CatalogSection>
      <CatalogSection id="settings-page-empty" title="An empty state filling the page">
        <div className="catalog-settings-frame">
          <SettingsPage title="Experimental">
            <EmptyState icon={<PlugIcon />}>Nothing to try out right now.</EmptyState>
          </SettingsPage>
        </div>
      </CatalogSection>
    </>
  );
}

export const SETTINGS_PAGE_EXAMPLE: Example = {
  id: "settings-page",
  title: "Settings page",
  Render: SettingsPages,
};
