import type { AccountSnapshot } from "@luke/credentials/snapshot";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { SIGNED_OUT_WORDS } from "@luke/features/words";
import { EXPERIMENTS, HOST_CAPABILITY, type HostCapability, NO_EXPERIMENTS } from "@luke/settings";
import type {
  MicrophoneControl,
  NotificationsControl,
  UpdateControl,
} from "@luke/settings/settings-controls";
import { SETTINGS_VIEW, type SettingsView } from "@luke/settings/settings-views";
import type { AppSettingsView } from "@luke/settings/wire";
import { TEXT_TONE, TEXT_VARIANT, Text } from "@luke/ui";
import type { ActionResult } from "@luke/wire";
import { AccountSection } from "./account-section.js";
import { AppearanceSection } from "./appearance-page.js";
import { CodingAgentsPage } from "./coding-agents-page.js";
import { ExperimentalPage } from "./experimental-page.js";
import { type IntegrationsFilter, IntegrationsSection } from "./integrations-page.js";
import { LinksSection } from "./links-section.js";
import { MacCommandsSection } from "./mac-commands-section.js";
import { MemorySection } from "./memory-page.js";
import { MicrophoneSection } from "./microphone-section.js";
import { PrivacySection } from "./privacy-section.js";
import { settingsRowsInput, shownWorkspace } from "./settings-rows.js";
import { WindowShortcutSections } from "./shortcuts-page.js";
import { SkillsPage } from "./skills-page.js";
import { UpdatesSection } from "./updates.js";
import { WorkspacePage, type WorkspaceSettingsControl } from "./workspace-page.js";
import { useSettingsWrites } from "./writes.js";

/**
 * The settings tab, as the grouped controls that draw it. A preference write
 * or a shortcut lives on its own bundle so a leaf can change without the
 * panel, the body, or the app's settings object growing a new field.
 */
export interface SettingsPanelProps {
  account: AccountSnapshot;
  onSignOut: () => Promise<void>;
  /**
   * Asks the service to erase the account, resolving to why when it refuses —
   * the row keeps drawing the account it still has, with the answer under it.
   */
  onDeleteAccount: () => Promise<ActionResult>;
  /**
   * Which settings page is showing. Held by the app rather than here because
   * a shortcut or a button elsewhere in the window turns it.
   */
  view: SettingsView;
  onViewChange: (view: SettingsView) => void;
  microphone: MicrophoneControl;
  notifications: NotificationsControl;
  updates: UpdateControl;
  settings?: AppSettingsView;
  /** What the platform offers, which decides the pages and rows of its features that stand. */
  capabilities: readonly HostCapability[];
  /** The workspaces the Workspace page shows, drawn while an account is signed in. */
  workspace?: WorkspaceSettingsControl;
}

/**
 * The page the Settings sidebar has chosen, as the groups that draw it. Every
 * option has one home: a page draws only its own groups, and the sidebar is
 * the one list of pages, so no page repeats another's rows.
 */
export function SettingsPanel({
  account,
  onSignOut,
  onDeleteAccount,
  view,
  microphone,
  notifications,
  updates,
  settings,
  workspace,
  capabilities,
  integrationsFilter,
}: SettingsPanelProps & {
  /** The Integrations page's own search, its query held by Settings so Settings' search can hand one down. */
  integrationsFilter?: IntegrationsFilter | undefined;
}): React.JSX.Element {
  const writes = useSettingsWrites();
  const panelView = settingsRowsInput({ settings, account, capabilities });
  const signedIn = account.status === ACCOUNT_STATUS.SIGNED_IN;
  // The shared settings page frames these, spacing them as sections.
  return (
    <>
      {view === SETTINGS_VIEW.ACCOUNT ? (
        signedIn ? (
          <>
            <AccountSection
              account={account}
              onSignOut={onSignOut}
              onDeleteAccount={onDeleteAccount}
            />
            {panelView ? <LinksSection view={panelView} writes={writes} /> : null}
            {panelView ? <PrivacySection view={panelView} writes={writes} /> : null}
          </>
        ) : (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            Not signed in.
          </Text>
        )
      ) : null}

      {view !== SETTINGS_VIEW.WORKSPACE ? null : !signedIn ? (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {SIGNED_OUT_WORDS}
        </Text>
      ) : workspace ? (
        <WorkspacePage control={workspace} readerId={account.id} />
      ) : null}

      {view === SETTINGS_VIEW.MEMORY ? (
        <MemorySection
          signedIn={signedIn}
          workspace={workspace ? shownWorkspace(workspace) : undefined}
          readerId={signedIn ? account.id : undefined}
          workspacesFailed={workspace?.listFailed ?? false}
          onRetryWorkspaces={workspace?.onRetryList}
        />
      ) : null}

      {view === SETTINGS_VIEW.CODING_AGENTS ? <CodingAgentsPage signedIn={signedIn} /> : null}

      {view === SETTINGS_VIEW.INTEGRATIONS ? (
        <IntegrationsSection signedIn={signedIn} filter={integrationsFilter} />
      ) : null}

      {view !== SETTINGS_VIEW.SKILLS ? null : signedIn ? (
        <SkillsPage control={workspace} readerId={account.id} />
      ) : (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {SIGNED_OUT_WORDS}
        </Text>
      )}

      {view === SETTINGS_VIEW.APPEARANCE && panelView ? (
        <AppearanceSection view={panelView} writes={writes} />
      ) : null}

      {view === SETTINGS_VIEW.THIS_MAC && panelView ? (
        <>
          <MacCommandsSection view={panelView} writes={writes} notifications={notifications} />
          {/* Dictation's microphone, on a platform whose microphone Luke asks for itself. */}
          {capabilities.includes(HOST_CAPABILITY.MICROPHONE) ? (
            <MicrophoneSection view={panelView} writes={writes} microphone={microphone} />
          ) : null}
        </>
      ) : null}

      {view === SETTINGS_VIEW.EXPERIMENTAL ? (
        <ExperimentalPage
          entries={EXPERIMENTS}
          experiments={settings?.experiments ?? NO_EXPERIMENTS}
          signedIn={signedIn}
        />
      ) : null}

      {view === SETTINGS_VIEW.ABOUT ? (
        <UpdatesSection
          control={updates}
          offered={capabilities.includes(HOST_CAPABILITY.UPDATES)}
        />
      ) : null}

      {view === SETTINGS_VIEW.SHORTCUTS ? (
        <WindowShortcutSections
          experiments={settings?.experiments ?? NO_EXPERIMENTS}
          capabilities={capabilities}
        />
      ) : null}
    </>
  );
}
