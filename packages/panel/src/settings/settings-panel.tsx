import type { AccountSnapshot } from "@repo/credentials/snapshot";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { SIGNED_OUT_WORDS } from "@repo/features/words";
import { EXPERIMENTS, HOST_CAPABILITY, type HostCapability, NO_EXPERIMENTS } from "@repo/settings";
import type {
  MicrophoneControl,
  NotificationsControl,
  UpdateControl,
} from "@repo/settings/settings-controls";
import { SETTINGS_VIEW, type SettingsView } from "@repo/settings/settings-views";
import type { AppSettingsView } from "@repo/settings/wire";
import { TEXT_TONE, TEXT_VARIANT, Text } from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { AccountSection } from "./account-section.js";
import { AgentComposerSection } from "./agent-composer-section.js";
import { AgentsPage } from "./agents-page.js";
import { AppearanceSection } from "./appearance-page.js";
import { CliPage } from "./cli-page.js";
import { CommitsSection } from "./commits-section.js";
import { ExperimentalPage } from "./experimental-page.js";
import { HostsSection } from "./hosts-section.js";
import { type IntegrationsFilter, IntegrationsSection } from "./integrations-page.js";
import { LinksSection } from "./links-section.js";
import { MacCommandsSection } from "./mac-commands-section.js";
import { McpClientsSections } from "./mcp-clients-section.js";
import { MemorySection } from "./memory-page.js";
import { MicrophoneSection } from "./microphone-section.js";
import { PrivacySection } from "./privacy-section.js";
import { settingsRowsInput, shownWorkspace } from "./settings-rows.js";
import { WindowShortcutSections } from "./shortcuts-page.js";
import { SkillsPage } from "./skills-page.js";
import { TasksSection } from "./tasks-section.js";
import { UpdatesSection } from "./updates.js";
import { WorkspacePage, type WorkspaceSettingsControl } from "./workspace-page.js";
import { useSettingsWrites } from "./writes.js";

export interface SettingsPanelProps {
  account: AccountSnapshot;
  onSignOut: () => Promise<void>;
  view: SettingsView;
  onViewChange: (view: SettingsView) => void;
  microphone: MicrophoneControl;
  notifications: NotificationsControl;
  updates: UpdateControl;
  settings?: AppSettingsView;
  capabilities: readonly HostCapability[];
  workspace?: WorkspaceSettingsControl;
}

export function SettingsPanel({
  account,
  onSignOut,
  view,
  microphone,
  notifications,
  updates,
  settings,
  workspace,
  capabilities,
  integrationsFilter,
}: SettingsPanelProps & {
  integrationsFilter?: IntegrationsFilter | undefined;
}): React.JSX.Element {
  const writes = useSettingsWrites();
  const panelView = settingsRowsInput({ settings, account, capabilities });
  const signedIn = account.status === ACCOUNT_STATUS.SIGNED_IN;
  return (
    <ReplayUnmask>
      {view === SETTINGS_VIEW.ACCOUNT ? (
        signedIn ? (
          <>
            <AccountSection account={account} onSignOut={onSignOut} />
            {panelView ? <LinksSection view={panelView} writes={writes} /> : null}
            {panelView ? <AgentComposerSection view={panelView} writes={writes} /> : null}
            {panelView ? (
              <CommitsSection view={panelView} writes={writes} account={account} />
            ) : null}
            {panelView ? <TasksSection view={panelView} writes={writes} /> : null}
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

      {view === SETTINGS_VIEW.AGENTS ? <AgentsPage signedIn={signedIn} /> : null}

      {view === SETTINGS_VIEW.HOSTS ? <HostsSection signedIn={signedIn} /> : null}

      {view === SETTINGS_VIEW.INTEGRATIONS ? (
        <IntegrationsSection signedIn={signedIn} filter={integrationsFilter} />
      ) : null}

      {view !== SETTINGS_VIEW.MCP ? null : signedIn ? (
        <McpClientsSections />
      ) : (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {SIGNED_OUT_WORDS}
        </Text>
      )}

      {view !== SETTINGS_VIEW.CLI ? null : signedIn ? (
        <CliPage />
      ) : (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {SIGNED_OUT_WORDS}
        </Text>
      )}

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
    </ReplayUnmask>
  );
}
