import type { AccountSnapshot } from "@sidecar/credentials/snapshot";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import type { AppSettingsView } from "@sidecar/settings/wire";
import type { ActionResult } from "@sidecar/wire";
import { microphoneAccessRow, voiceAttentionNote } from "../microphone-access";
import type { SettingsSearchInput } from "../settings-search";
import { SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { AccountSection } from "./account-section";
import { AppearanceSection } from "./appearance-page";
import { CodingAgentsPage } from "./coding-agents-page";
import type {
  MicrophoneControl,
  NotificationsControl,
  ShortcutControl,
  UpdateControl,
} from "./controls";
import { GitHubSection, type GitHubSettingsControl } from "./github-section";
import { IntegrationsSection } from "./integrations-page";
import { MacCommandsSection } from "./mac-commands-section";
import { NotificationsSection } from "./notifications-section";
import { ShortcutSection, WindowShortcutSections } from "./shortcuts-page";
import { UpdatesSection } from "./updates";
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
   * Which settings page is showing: the front page, or one of the pages a
   * front-page row opens. Held by the app rather than here because Escape
   * unwinds it.
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
  /** Whether the account has GitHub connected, and the pages that connect and disconnect it, drawn while an account is signed in. */
  github?: GitHubSettingsControl;
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
 * list saying a page one press away still needs a hand. The keyless half moved
 * to the Account and usage heading with the ways in, so the row marks only a
 * microphone still ungranted for a voice that can run. The panel's front page
 * and the desktop's list of pages both read it, so the two never disagree.
 */
export function voicePageAttention(microphone: MicrophoneControl): string | undefined {
  return microphone.voiceAvailable
    ? voiceAttentionNote({ voiceAvailable: true, status: microphone.status })
    : undefined;
}

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
  github,
}: SettingsPanelProps): React.JSX.Element {
  const writes = useSettingsWrites();
  const panelView = settingsRowsInput({ settings, microphone, account });
  return (
    <div className="settings">
      {view !== SETTINGS_VIEW.WORKSPACE ? null : account.status !== ACCOUNT_STATUS.SIGNED_IN ? (
        <p className="settings-note">Sign in to see your workspaces.</p>
      ) : workspace ? (
        <WorkspacePage control={workspace} />
      ) : null}

      {view === SETTINGS_VIEW.VOICE && panelView ? (
        <VoiceSection view={panelView} writes={writes} microphone={microphone} />
      ) : null}

      {view === SETTINGS_VIEW.APPEARANCE && panelView ? (
        <AppearanceSection view={panelView} writes={writes} />
      ) : null}

      {view === SETTINGS_VIEW.CODING_AGENTS ? (
        <>
          <CodingAgentsPage signedIn={account.status === ACCOUNT_STATUS.SIGNED_IN} />
          {panelView ? (
            <NotificationsSection view={panelView} writes={writes} control={notifications} />
          ) : null}
        </>
      ) : null}

      {view === SETTINGS_VIEW.INTEGRATIONS ? (
        <IntegrationsSection signedIn={account.status === ACCOUNT_STATUS.SIGNED_IN} />
      ) : null}

      {view === SETTINGS_VIEW.SHORTCUTS ? (
        <>
          <ShortcutSection
            shortcuts={shortcuts}
            writes={writes}
            {...(panelView ? { view: panelView } : undefined)}
            voiceAvailable={microphone.voiceAvailable}
          />
          <WindowShortcutSections />
        </>
      ) : null}

      {view !== SETTINGS_VIEW.ROOT ? null : (
        <>
          {panelView ? <MacCommandsSection view={panelView} writes={writes} /> : null}

          <UpdatesSection control={updates} />

          {account.status === ACCOUNT_STATUS.SIGNED_IN ? (
            <AccountSection
              account={account}
              onSignOut={onSignOut}
              onDeleteAccount={onDeleteAccount}
            />
          ) : null}

          {/* Beside the account, where every Open Settings for GitHub not connected lands. */}
          {github !== undefined && account.status === ACCOUNT_STATUS.SIGNED_IN ? (
            <GitHubSection control={github} />
          ) : null}
        </>
      )}
    </div>
  );
}
