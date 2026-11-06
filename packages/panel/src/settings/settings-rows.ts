import type { AccountSnapshot } from "@repo/credentials/snapshot";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import type { Workspace } from "@repo/features/workspace-wire";
import {
  EXPERIMENT,
  type Experiment,
  type ExperimentChoices,
  experimentOn,
  HOST_CAPABILITY,
  type HostCapability,
} from "@repo/settings";
import {
  SETTINGS_PAGE_LIST,
  SETTINGS_VIEW,
  type SettingsView,
} from "@repo/settings/settings-views";
import type { AppSettingsView } from "@repo/settings/wire";
import type { SettingsSearchInput } from "../settings-search.js";
import type { WorkspaceSettingsControl } from "./workspace-page.js";

const PAGE_CAPABILITY = {
  [SETTINGS_VIEW.ACCOUNT]: null,
  [SETTINGS_VIEW.WORKSPACE]: null,
  [SETTINGS_VIEW.AGENTS]: null,
  [SETTINGS_VIEW.HOSTS]: null,
  [SETTINGS_VIEW.INTEGRATIONS]: null,
  [SETTINGS_VIEW.MCP]: null,
  [SETTINGS_VIEW.CLI]: null,
  [SETTINGS_VIEW.SKILLS]: null,
  [SETTINGS_VIEW.MEMORY]: null,
  [SETTINGS_VIEW.APPEARANCE]: null,
  [SETTINGS_VIEW.THIS_MAC]: HOST_CAPABILITY.MAC_COMMANDS,
  [SETTINGS_VIEW.EXPERIMENTAL]: null,
  [SETTINGS_VIEW.ABOUT]: null,
  [SETTINGS_VIEW.SHORTCUTS]: HOST_CAPABILITY.DESKTOP_APP,
} as const satisfies Record<SettingsView, HostCapability | null>;

const PAGE_EXPERIMENT: Partial<Record<SettingsView, Experiment>> = {
  [SETTINGS_VIEW.HOSTS]: EXPERIMENT.BRING_YOUR_OWN_HOST,
  [SETTINGS_VIEW.SKILLS]: EXPERIMENT.SKILLS,
  [SETTINGS_VIEW.MEMORY]: EXPERIMENT.MEMORY,
};

export function settingsPageExperimentStands(
  view: SettingsView,
  experiments: ExperimentChoices,
): boolean {
  const experiment = PAGE_EXPERIMENT[view];
  return experiment === undefined || experimentOn(experiments, experiment);
}

export function experimentPages(experiment: Experiment): readonly SettingsView[] {
  return SETTINGS_PAGE_LIST.filter((view) => PAGE_EXPERIMENT[view] === experiment);
}

export function settingsPageShown(
  view: SettingsView,
  capabilities: readonly HostCapability[],
  experiments: ExperimentChoices,
): boolean {
  const capability: HostCapability | null = PAGE_CAPABILITY[view];
  return (
    (capability === null || capabilities.includes(capability)) &&
    settingsPageExperimentStands(view, experiments)
  );
}

export function shownSettingsView(
  view: SettingsView,
  capabilities: readonly HostCapability[],
  experiments: ExperimentChoices,
): SettingsView {
  return settingsPageShown(view, capabilities, experiments) ? view : SETTINGS_VIEW.ACCOUNT;
}

export function shownWorkspace(
  control: Pick<WorkspaceSettingsControl, "workspaces" | "workspaceId">,
): Workspace | undefined {
  return (
    control.workspaces.find((each) => each.id === control.workspaceId) ?? control.workspaces[0]
  );
}

export function settingsRowsInput({
  settings,
  account,
  capabilities,
  workspace,
}: {
  settings?: AppSettingsView | undefined;
  account: AccountSnapshot;
  capabilities: readonly HostCapability[];
  workspace?: Pick<WorkspaceSettingsControl, "workspaces" | "workspaceId"> | undefined;
}): SettingsSearchInput | undefined {
  if (!settings) return undefined;
  const accountDrawn = account.status === ACCOUNT_STATUS.SIGNED_IN;
  return {
    settings,
    accountDrawn,
    capabilities,
    workspace: accountDrawn && workspace ? shownWorkspace(workspace) : undefined,
  };
}
