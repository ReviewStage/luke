import type { AccountSnapshot } from "@luke/credentials/snapshot";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import type { Workspace } from "@luke/features/workspace-wire";
import { HOST_CAPABILITY, type HostCapability } from "@luke/settings";
import { SETTINGS_VIEW, type SettingsView } from "@luke/settings/settings-views";
import type { AppSettingsView } from "@luke/settings/wire";
import { microphoneAccessRow } from "@luke/voice/microphone-access";
import type { MicrophoneControl } from "@luke/voice/settings-controls";
import type { SettingsSearchInput } from "../settings-search.js";
import type { WorkspaceSettingsControl } from "./workspace-page.js";

/**
 * settings-rows.ts -- what the settings pages offer, judged without drawing one.
 *
 * Note that this module imports no component, only types and plain functions:
 * the window's shell reads which page shows and which rows stand on every
 * launch, while the pages themselves are one `lazy()` boundary away
 * (`desktop-settings.tsx`), and a static import of a page from the shell would
 * pull every page into the bundle each launch parses.
 */

/**
 * The capability a page stands on, for each page whose every row is one
 * platform feature's, and nothing for a page that stands everywhere: where
 * the platform does not offer it, the page is not listed, found, or drawn.
 */
const PAGE_CAPABILITY = {
  [SETTINGS_VIEW.ACCOUNT]: null,
  [SETTINGS_VIEW.WORKSPACE]: null,
  [SETTINGS_VIEW.CODING_AGENTS]: null,
  [SETTINGS_VIEW.INTEGRATIONS]: null,
  [SETTINGS_VIEW.PLAN_TEMPLATE]: null,
  [SETTINGS_VIEW.VOICE]: HOST_CAPABILITY.VOICE,
  [SETTINGS_VIEW.APPEARANCE]: null,
  [SETTINGS_VIEW.NOTIFICATIONS]: HOST_CAPABILITY.NOTIFICATIONS,
  [SETTINGS_VIEW.THIS_MAC]: HOST_CAPABILITY.MAC_COMMANDS,
  [SETTINGS_VIEW.EXPERIMENTAL]: null,
  [SETTINGS_VIEW.ABOUT]: null,
  // The menu bar's chords, which a browser keeps many of for its own tabs.
  [SETTINGS_VIEW.SHORTCUTS]: HOST_CAPABILITY.DESKTOP_APP,
} as const satisfies Record<SettingsView, HostCapability | null>;

/** Whether a page stands on this platform: the sidebar, the command palette, the search, and the page Settings shows all ask it. */
export function settingsPageShown(
  view: SettingsView,
  capabilities: readonly HostCapability[],
): boolean {
  const capability: HostCapability | null = PAGE_CAPABILITY[view];
  return capability === null || capabilities.includes(capability);
}

/**
 * The page Settings shows for the one chosen: that page where the platform
 * offers it, and Profile in place of one a link turned to that it does not,
 * so the title, the reset, the copied link, and the history all name the
 * page on screen.
 */
export function shownSettingsView(
  view: SettingsView,
  capabilities: readonly HostCapability[],
): SettingsView {
  return settingsPageShown(view, capabilities) ? view : SETTINGS_VIEW.ACCOUNT;
}

/** The workspace the page shows: the one the sidebar lists, else the first; none before the workspaces are read. */
export function shownWorkspace(
  control: Pick<WorkspaceSettingsControl, "workspaces" | "workspaceId">,
): Workspace | undefined {
  return (
    control.workspaces.find((each) => each.id === control.workspaceId) ?? control.workspaces[0]
  );
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
