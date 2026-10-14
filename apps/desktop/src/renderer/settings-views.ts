import { SETTINGS_PAGE as SETTINGS_VIEW, type SettingsPage as SettingsView } from "@luke/settings";

export type { SettingsView };
/**
 * Which page of the Settings tab is showing. App state rather than panel state
 * for the same reason the tab is — a shortcut, a voice request, or a button
 * elsewhere in the window turns it from outside the panel.
 */
export { SETTINGS_VIEW };

/**
 * The pages in the order the Settings sidebar lists them, Account first since
 * Settings opens on it. Every option has one home among them; Keyboard
 * shortcuts, which only lists the window's own chords, comes last. The
 * command palette lists them in the same order.
 */
export const SETTINGS_PAGE_LIST = [
  SETTINGS_VIEW.ACCOUNT,
  SETTINGS_VIEW.WORKSPACE,
  SETTINGS_VIEW.CODING_AGENTS,
  SETTINGS_VIEW.INTEGRATIONS,
  SETTINGS_VIEW.PLAN_TEMPLATE,
  SETTINGS_VIEW.VOICE,
  SETTINGS_VIEW.APPEARANCE,
  SETTINGS_VIEW.NOTIFICATIONS,
  SETTINGS_VIEW.THIS_MAC,
  SETTINGS_VIEW.ABOUT,
  SETTINGS_VIEW.SHORTCUTS,
] as const satisfies readonly SettingsView[];

/**
 * A section of a Settings page a link lands on. Each is the anchor its group
 * wears, the same anchor a search result lands on, so a link and a result
 * reach a section the one way, and a section keeps its name whatever page it
 * stands on.
 */
export const SETTINGS_SECTION = {
  /** A workspace's members, its invite, and the leave. */
  MEMBERS: "workspace-members",
  /** A workspace's Integrations, the group once called GitHub repositories and still anchored by its name: GitHub's connect, Manage, and disconnect, and the repositories chosen on GitHub. */
  GITHUB_REPOSITORIES: "workspace-github-repositories",
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
