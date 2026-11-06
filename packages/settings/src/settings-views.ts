import { MODEL_PROVIDER, type ModelProvider } from "@repo/features/models-wire";
import {
  EXPERIMENT,
  SETTINGS_PAGE as SETTINGS_VIEW,
  type SettingsPage as SettingsView,
} from "@repo/settings";
import { EXPERIMENT_ANCHOR, SETTINGS_SEARCH_ROW } from "@repo/settings/settings-anchors";

export type { SettingsView };
export { SETTINGS_VIEW };

export const SETTINGS_PAGE_LIST = [
  SETTINGS_VIEW.ACCOUNT,
  SETTINGS_VIEW.WORKSPACE,
  SETTINGS_VIEW.MEMORY,
  SETTINGS_VIEW.AGENTS,
  SETTINGS_VIEW.HOSTS,
  SETTINGS_VIEW.INTEGRATIONS,
  SETTINGS_VIEW.MCP,
  SETTINGS_VIEW.CLI,
  SETTINGS_VIEW.SKILLS,
  SETTINGS_VIEW.APPEARANCE,
  SETTINGS_VIEW.THIS_MAC,
  SETTINGS_VIEW.EXPERIMENTAL,
  SETTINGS_VIEW.ABOUT,
  SETTINGS_VIEW.SHORTCUTS,
] as const satisfies readonly SettingsView[];

export const SETTINGS_PAGE_GROUP = {
  WORKSPACE: "workspace",
  ACCOUNT: "account",
  THIS_MAC: "thisMac",
} as const;

export type SettingsPageGroup = (typeof SETTINGS_PAGE_GROUP)[keyof typeof SETTINGS_PAGE_GROUP];

const GROUP_OF_PAGE = {
  [SETTINGS_VIEW.ACCOUNT]: SETTINGS_PAGE_GROUP.ACCOUNT,
  [SETTINGS_VIEW.WORKSPACE]: SETTINGS_PAGE_GROUP.WORKSPACE,
  [SETTINGS_VIEW.AGENTS]: SETTINGS_PAGE_GROUP.ACCOUNT,
  [SETTINGS_VIEW.HOSTS]: SETTINGS_PAGE_GROUP.ACCOUNT,
  [SETTINGS_VIEW.INTEGRATIONS]: SETTINGS_PAGE_GROUP.ACCOUNT,
  [SETTINGS_VIEW.MCP]: SETTINGS_PAGE_GROUP.ACCOUNT,
  [SETTINGS_VIEW.CLI]: SETTINGS_PAGE_GROUP.ACCOUNT,
  [SETTINGS_VIEW.SKILLS]: SETTINGS_PAGE_GROUP.ACCOUNT,
  [SETTINGS_VIEW.MEMORY]: SETTINGS_PAGE_GROUP.WORKSPACE,
  [SETTINGS_VIEW.APPEARANCE]: SETTINGS_PAGE_GROUP.THIS_MAC,
  [SETTINGS_VIEW.THIS_MAC]: SETTINGS_PAGE_GROUP.THIS_MAC,
  [SETTINGS_VIEW.EXPERIMENTAL]: SETTINGS_PAGE_GROUP.ACCOUNT,
  [SETTINGS_VIEW.ABOUT]: SETTINGS_PAGE_GROUP.THIS_MAC,
  [SETTINGS_VIEW.SHORTCUTS]: SETTINGS_PAGE_GROUP.THIS_MAC,
} as const satisfies Record<SettingsView, SettingsPageGroup>;

export const SETTINGS_PAGE_GROUPS: readonly {
  readonly group: SettingsPageGroup;
  readonly pages: readonly SettingsView[];
}[] = Object.values(SETTINGS_PAGE_GROUP).map((group) => ({
  group,
  pages: SETTINGS_PAGE_LIST.filter((page) => GROUP_OF_PAGE[page] === group),
}));

export const SETTINGS_SECTION = {
  MEMBERS: "workspace-members",
  INVITATIONS: "workspace-invitations",
  LEAVE: "workspace-leave",
  GITHUB_REPOSITORIES: "workspace-github-repositories",
  CLAUDE: SETTINGS_SEARCH_ROW.API_KEY_ANTHROPIC,
  CODEX: SETTINGS_SEARCH_ROW.API_KEY_OPENAI,
  GITHUB_TOKEN: SETTINGS_SEARCH_ROW.GITHUB_ACCESS,
  BRING_YOUR_OWN_HOST: EXPERIMENT_ANCHOR[EXPERIMENT.BRING_YOUR_OWN_HOST],
} as const;

type SettingsSection = (typeof SETTINGS_SECTION)[keyof typeof SETTINGS_SECTION];

export interface SettingsLink {
  readonly page: SettingsView;
  readonly section?: SettingsSection;
  readonly workspaceId?: string;
  readonly listed?: true;
}

const HARNESS_SECTION = {
  [MODEL_PROVIDER.ANTHROPIC]: SETTINGS_SECTION.CLAUDE,
  [MODEL_PROVIDER.OPENAI]: SETTINGS_SECTION.CODEX,
} as const satisfies Record<ModelProvider, SettingsSection>;

export function agentKeyLink(provider: ModelProvider | undefined): SettingsLink {
  if (provider === undefined) return { page: SETTINGS_VIEW.AGENTS };
  return { page: SETTINGS_VIEW.AGENTS, section: HARNESS_SECTION[provider] };
}
