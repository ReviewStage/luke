import type { AccountSnapshot } from "@luke/credentials/snapshot";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { AppearanceSection } from "@luke/panel/settings/appearance-page";
import { ExperimentalPage } from "@luke/panel/settings/experimental-page";
import { MacCommandsSection } from "@luke/panel/settings/mac-commands-section";
import { NotificationsSection } from "@luke/panel/settings/notifications-section";
import { WindowShortcutSections } from "@luke/panel/settings/shortcuts-page";
import { UpdatesSection } from "@luke/panel/settings/updates";
import { ShortcutSection } from "@luke/panel/settings/voice-keys";
import { VoiceSection } from "@luke/panel/settings/voice-page";
import { useSettingsWrites } from "@luke/panel/settings/writes";
import type { SettingsSearchInput } from "@luke/panel/settings-search";
import { EXPERIMENTS, HOST_CAPABILITY, type HostCapability, NO_EXPERIMENTS } from "@luke/settings";
import { SETTINGS_VIEW, type SettingsView } from "@luke/settings/settings-views";
import type { AppSettingsView } from "@luke/settings/wire";
import { TEXT_TONE, TEXT_VARIANT, Text } from "@luke/ui";
import { microphoneAccessRow, voiceAttentionNote } from "@luke/voice/microphone-access";
import type {
  MicrophoneControl,
  NotificationsControl,
  ShortcutControl,
  UpdateControl,
} from "@luke/voice/settings-controls";
import type { ActionResult } from "@luke/wire";
import { AccountSection } from "./account-section";
import { CodingAgentsPage } from "./coding-agents-page";
import { type IntegrationsFilter, IntegrationsSection } from "./integrations-page";
import { shownWorkspace, WorkspacePage, type WorkspaceSettingsControl } from "./workspace-page";

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
   * a shortcut, a voice request, or a button elsewhere in the window turns it.
   */
  view: SettingsView;
  onViewChange: (view: SettingsView) => void;
  microphone: MicrophoneControl;
  notifications: NotificationsControl;
  updates: UpdateControl;
  settings?: AppSettingsView;
  shortcuts: ShortcutControl;
  /** What the platform offers, which decides the pages and rows of its features that stand. */
  capabilities: readonly HostCapability[];
  /** The workspaces the Workspace page shows, drawn while an account is signed in. */
  workspace?: WorkspaceSettingsControl;
}

/**
 * What the pages currently offer, read afresh each render: every row's own
 * condition is judged from this one record, by the rows the pages draw and by
 * the search corpus alike, so a result never leads to a page without its row.
 * Absent until the settings have arrived.
 */
export function settingsRowsInput({
  settings,
  microphone,
  account,
  capabilities,
  workspace,
}: {
  settings?: AppSettingsView | undefined;
  microphone: MicrophoneControl;
  account: AccountSnapshot;
  capabilities: readonly HostCapability[];
  workspace?: Pick<WorkspaceSettingsControl, "workspaces" | "workspaceId"> | undefined;
}): SettingsSearchInput | undefined {
  if (!settings) return undefined;
  const accountDrawn = account.status === ACCOUNT_STATUS.SIGNED_IN;
  return {
    settings,
    voiceControlsDrawn: microphoneAccessRow({
      voiceAvailable: microphone.voiceAvailable,
      status: microphone.status,
    }).ready,
    accountDrawn,
    capabilities,
    workspace: accountDrawn && workspace ? shownWorkspace(workspace) : undefined,
  };
}

/**
 * Why the Voice page's row in a list of pages wears its mark, or nothing while
 * voice is fully set up. Judged from the panel's props rather than on the Voice
 * page because the mark has to stand while that page is not drawn: it is the
 * list saying a page one press away still needs a hand. A voice that cannot
 * run yet is signing in's to fix, not this page's, so the row marks only a
 * microphone still ungranted for a voice that can run. The Settings sidebar
 * reads it, and the Voice page wears the same mark on the row it means.
 */
export function voicePageAttention(microphone: MicrophoneControl): string | undefined {
  return microphone.voiceAvailable
    ? voiceAttentionNote({ voiceAvailable: true, status: microphone.status })
    : undefined;
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
  shortcuts,
  workspace,
  capabilities,
  integrationsFilter,
}: SettingsPanelProps & {
  /** The Integrations page's own search, its query held by Settings so Settings' search can hand one down. */
  integrationsFilter?: IntegrationsFilter | undefined;
}): React.JSX.Element {
  const writes = useSettingsWrites();
  const panelView = settingsRowsInput({ settings, microphone, account, capabilities });
  const signedIn = account.status === ACCOUNT_STATUS.SIGNED_IN;
  // The shared settings page frames these, spacing them as sections.
  return (
    <>
      {view === SETTINGS_VIEW.ACCOUNT ? (
        signedIn ? (
          <AccountSection
            account={account}
            onSignOut={onSignOut}
            onDeleteAccount={onDeleteAccount}
          />
        ) : (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
            Not signed in.
          </Text>
        )
      ) : null}

      {view !== SETTINGS_VIEW.WORKSPACE ? null : !signedIn ? (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
          Sign in to see your workspaces.
        </Text>
      ) : workspace ? (
        <WorkspacePage control={workspace} readerId={account.id} />
      ) : null}

      {view === SETTINGS_VIEW.CODING_AGENTS ? <CodingAgentsPage signedIn={signedIn} /> : null}

      {view === SETTINGS_VIEW.INTEGRATIONS ? (
        <IntegrationsSection signedIn={signedIn} filter={integrationsFilter} />
      ) : null}

      {view === SETTINGS_VIEW.VOICE ? (
        <>
          {panelView ? (
            <VoiceSection
              view={panelView}
              writes={writes}
              microphone={microphone}
              microphoneOffered={capabilities.includes(HOST_CAPABILITY.MICROPHONE)}
            />
          ) : null}
          <ShortcutSection
            shortcuts={shortcuts}
            {...(panelView ? { view: panelView } : undefined)}
            voiceAvailable={microphone.voiceAvailable}
          />
        </>
      ) : null}

      {view === SETTINGS_VIEW.APPEARANCE && panelView ? (
        <AppearanceSection view={panelView} writes={writes} />
      ) : null}

      {view === SETTINGS_VIEW.NOTIFICATIONS && panelView ? (
        <NotificationsSection view={panelView} writes={writes} control={notifications} />
      ) : null}

      {view === SETTINGS_VIEW.THIS_MAC && panelView ? (
        <MacCommandsSection view={panelView} writes={writes} />
      ) : null}

      {view === SETTINGS_VIEW.EXPERIMENTAL ? (
        <ExperimentalPage
          entries={EXPERIMENTS}
          experiments={settings?.experiments ?? NO_EXPERIMENTS}
          signedIn={signedIn}
          view={panelView}
          writes={writes}
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
