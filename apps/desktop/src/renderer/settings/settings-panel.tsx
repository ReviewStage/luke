import type { AccountSnapshot } from "@luke/credentials/snapshot";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { EXPERIMENTS, NO_EXPERIMENTS } from "@luke/settings";
import { SETTINGS_VIEW, type SettingsView } from "@luke/settings/settings-views";
import type { AppSettingsView } from "@luke/settings/wire";
import { microphoneAccessRow, voiceAttentionNote } from "@luke/voice/microphone-access";
import type {
  MicrophoneControl,
  NotificationsControl,
  ShortcutControl,
  UpdateControl,
} from "@luke/voice/settings-controls";
import type { ActionResult } from "@luke/wire";
import type { SettingsSearchInput } from "../settings-search";
import { AccountSection } from "./account-section";
import { AppearanceSection } from "./appearance-page";
import { CodingAgentsPage } from "./coding-agents-page";
import { ExperimentalPage } from "./experimental-page";
import { type IntegrationsFilter, IntegrationsSection } from "./integrations-page";
import { MacCommandsSection } from "./mac-commands-section";
import { NotificationsSection } from "./notifications-section";
import { drawnInSettingsPage } from "./pages";
import { WindowShortcutSections } from "./shortcuts-page";
import { UpdatesSection } from "./updates";
import { ShortcutSection } from "./voice-keys";
import { VoiceSection } from "./voice-page";
import { shownWorkspace, WorkspacePage, type WorkspaceSettingsControl } from "./workspace-page";
import { useSettingsWrites } from "./writes";

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
  workspace,
}: {
  settings?: AppSettingsView | undefined;
  microphone: MicrophoneControl;
  account: AccountSnapshot;
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
  integrationsFilter,
}: SettingsPanelProps & {
  /** The Integrations page's own search, its query held by Settings so Settings' search can hand one down. */
  integrationsFilter?: IntegrationsFilter | undefined;
}): React.JSX.Element {
  const writes = useSettingsWrites();
  const panelView = settingsRowsInput({ settings, microphone, account });
  const signedIn = account.status === ACCOUNT_STATUS.SIGNED_IN;
  const page = (
    <>
      {view === SETTINGS_VIEW.ACCOUNT ? (
        signedIn ? (
          <AccountSection
            account={account}
            onSignOut={onSignOut}
            onDeleteAccount={onDeleteAccount}
          />
        ) : (
          <p className="settings-note">Not signed in.</p>
        )
      ) : null}

      {view !== SETTINGS_VIEW.WORKSPACE ? null : !signedIn ? (
        <p className="settings-note">Sign in to see your workspaces.</p>
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
            <VoiceSection view={panelView} writes={writes} microphone={microphone} />
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

      {view === SETTINGS_VIEW.ABOUT ? <UpdatesSection control={updates} /> : null}

      {view === SETTINGS_VIEW.SHORTCUTS ? (
        <WindowShortcutSections experiments={settings?.experiments ?? NO_EXPERIMENTS} />
      ) : null}
    </>
  );
  // A page the shared settings page frames hands it its sections alone, which it spaces itself.
  return drawnInSettingsPage(view) ? page : <div className="settings">{page}</div>;
}
