import {
  SETTINGS_PAGE as SETTINGS_VIEW,
  type SettingsPage as SettingsView,
} from "@sidecar/settings";

export type { SettingsView };
/**
 * Where inside the Settings tab the panel currently is: its front page, or one
 * of the pages a front-page row opens. App state rather than panel state for
 * the same reason the tab is — Escape unwinds it one layer at a time from the
 * app's own key handler.
 */
export { SETTINGS_VIEW };

/** The pages the front page opens, in the order its rows offer them. */
export const SETTINGS_SUBVIEW_LIST = [
  SETTINGS_VIEW.WORKSPACE,
  SETTINGS_VIEW.VOICE,
  SETTINGS_VIEW.APPEARANCE,
  SETTINGS_VIEW.SHORTCUTS,
  SETTINGS_VIEW.PLAN_TEMPLATE,
  SETTINGS_VIEW.CODING_AGENTS,
  SETTINGS_VIEW.INTEGRATIONS,
] as const;

export type SettingsSubview = (typeof SETTINGS_SUBVIEW_LIST)[number];

const NAV_ROW_ID = {
  [SETTINGS_VIEW.VOICE]: "settings-nav-voice",
  [SETTINGS_VIEW.APPEARANCE]: "settings-nav-appearance",
  [SETTINGS_VIEW.SHORTCUTS]: "settings-nav-shortcuts",
  [SETTINGS_VIEW.PLAN_TEMPLATE]: "settings-nav-plan-template",
  [SETTINGS_VIEW.CODING_AGENTS]: "settings-nav-coding-agents",
  [SETTINGS_VIEW.INTEGRATIONS]: "settings-nav-integrations",
  [SETTINGS_VIEW.WORKSPACE]: "settings-nav-workspace",
};

/**
 * The element id of a page's front-page row, so leaving the page can hand the
 * keyboard back to the row that opened it.
 */
export function settingsNavRowId(view: SettingsSubview): string {
  return NAV_ROW_ID[view];
}

/**
 * A section of a Settings page a link lands on. Each is the anchor its group
 * wears, the same anchor a search result lands on, so a link and a result
 * reach a section the one way, and a section keeps its name whatever page it
 * stands on.
 */
export const SETTINGS_SECTION = {
  /** A workspace's members, its invite, and the leave. */
  MEMBERS: "workspace-members",
  /** A workspace's GitHub repositories: the connected GitHub account, its connect and disconnect, and the repositories chosen on GitHub. */
  GITHUB_REPOSITORIES: "workspace-github-repositories",
  /** The accounts linked to the account: its own GitHub, connected or disconnected in the browser. */
  CONNECTED_ACCOUNTS: "connected-accounts",
} as const;

type SettingsSection = (typeof SETTINGS_SECTION)[keyof typeof SETTINGS_SECTION];

/**
 * Where an Open Settings press lands: a page, a section on it, and on the
 * Workspace page the workspace it shows, the sidebar's own where none is
 * named. Every way into Settings at a place takes one of these.
 */
export interface SettingsLink {
  readonly page: SettingsView;
  readonly section?: SettingsSection;
  readonly workspaceId?: string;
}
