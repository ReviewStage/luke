import { SETTINGS_PAGE as SETTINGS_VIEW, type SettingsPage as SettingsView } from "@luke/settings";

export type { SettingsView };
/**
 * Which page of the Settings tab is showing. App state rather than panel state
 * for the same reason the tab is — a shortcut, a voice request, or a button
 * elsewhere in the window turns it from outside the panel.
 */
export { SETTINGS_VIEW };

/**
 * The pages in the order the command palette and the settings search list
 * them, and the Settings sidebar within each of its groups, Account first
 * since Settings opens on it. Every option has one home among them;
 * Experimental follows This Mac, so About and Keyboard shortcuts, which only
 * lists the window's own chords, stay last.
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
  SETTINGS_VIEW.EXPERIMENTAL,
  SETTINGS_VIEW.ABOUT,
  SETTINGS_VIEW.SHORTCUTS,
] as const satisfies readonly SettingsView[];

/**
 * The headings the Settings sidebar groups its pages under, in the order it
 * draws them, as Linear and Notion group theirs: the workspace the sidebar
 * lists, what is the account's whichever workspace is listed, and what is
 * this Mac's alone.
 */
export const SETTINGS_PAGE_GROUP = {
  WORKSPACE: "workspace",
  ACCOUNT: "account",
  THIS_MAC: "thisMac",
} as const;

export type SettingsPageGroup = (typeof SETTINGS_PAGE_GROUP)[keyof typeof SETTINGS_PAGE_GROUP];

/**
 * The heading each page stands under. Experiments are the account's choice,
 * carried to every window, so Experimental stands under Account.
 */
const GROUP_OF_PAGE = {
  [SETTINGS_VIEW.ACCOUNT]: SETTINGS_PAGE_GROUP.ACCOUNT,
  [SETTINGS_VIEW.WORKSPACE]: SETTINGS_PAGE_GROUP.WORKSPACE,
  [SETTINGS_VIEW.CODING_AGENTS]: SETTINGS_PAGE_GROUP.ACCOUNT,
  [SETTINGS_VIEW.INTEGRATIONS]: SETTINGS_PAGE_GROUP.ACCOUNT,
  [SETTINGS_VIEW.PLAN_TEMPLATE]: SETTINGS_PAGE_GROUP.ACCOUNT,
  [SETTINGS_VIEW.VOICE]: SETTINGS_PAGE_GROUP.THIS_MAC,
  [SETTINGS_VIEW.APPEARANCE]: SETTINGS_PAGE_GROUP.THIS_MAC,
  [SETTINGS_VIEW.NOTIFICATIONS]: SETTINGS_PAGE_GROUP.THIS_MAC,
  [SETTINGS_VIEW.THIS_MAC]: SETTINGS_PAGE_GROUP.THIS_MAC,
  [SETTINGS_VIEW.EXPERIMENTAL]: SETTINGS_PAGE_GROUP.ACCOUNT,
  [SETTINGS_VIEW.ABOUT]: SETTINGS_PAGE_GROUP.THIS_MAC,
  [SETTINGS_VIEW.SHORTCUTS]: SETTINGS_PAGE_GROUP.THIS_MAC,
} as const satisfies Record<SettingsView, SettingsPageGroup>;

/** The Settings sidebar's groups in the order it draws them, each with its pages in the list's own order. */
export const SETTINGS_PAGE_GROUPS: readonly {
  readonly group: SettingsPageGroup;
  readonly pages: readonly SettingsView[];
}[] = Object.values(SETTINGS_PAGE_GROUP).map((group) => ({
  group,
  pages: SETTINGS_PAGE_LIST.filter((page) => GROUP_OF_PAGE[page] === group),
}));

/**
 * A section of a Settings page a link lands on. Each is the anchor its group
 * wears, the same anchor a search result lands on, so a link and a result
 * reach a section the one way, and a section keeps its name whatever page it
 * stands on.
 */
export const SETTINGS_SECTION = {
  /** A workspace's members. */
  MEMBERS: "workspace-members",
  /** A workspace's invite and the invitations still pending, an owner's or an admin's. */
  INVITATIONS: "workspace-invitations",
  /** The way out of a workspace, for anyone but its owner. */
  LEAVE: "workspace-leave",
  /** A workspace's GitHub, the group once called GitHub repositories and still anchored by its name: the GitHub accounts connected, and Connect or Manage on GitHub, where accounts are added and repositories chosen. */
  GITHUB_REPOSITORIES: "workspace-github-repositories",
} as const;

type SettingsSection = (typeof SETTINGS_SECTION)[keyof typeof SETTINGS_SECTION];

/**
 * Where an Open Settings press lands: a page, a section on it, and a
 * workspace, which the sidebar lists before the page is drawn, so the
 * Workspace page, which shows the listed one, shows it; the sidebar's
 * stays listed where none is named. Every way into Settings at a place
 * takes one of these.
 */
export interface SettingsLink {
  readonly page: SettingsView;
  readonly section?: SettingsSection;
  readonly workspaceId?: string;
}
