import { HOST_CAPABILITY, type HostCapability } from "@luke/settings";
import {
  SETTINGS_PAGE_GROUP,
  SETTINGS_PAGE_GROUPS,
  SETTINGS_VIEW,
  type SettingsPageGroup,
  type SettingsView,
} from "@luke/settings/settings-views";
import {
  DisplayIcon,
  DocumentIcon,
  KeyboardIcon,
  LaptopIcon,
  PlugIcon,
  SpeakerIcon,
  TerminalIcon,
  UserIcon,
} from "@luke/ui";
import { BellIcon, FlaskConicalIcon, InfoIcon, UsersIcon } from "lucide-react";
import { settingsPageShown } from "./settings-rows.js";

/** A page's name and glyph. */
interface SettingsPage {
  readonly title: string;
  readonly icon: React.JSX.Element;
}

/**
 * What each page is called in the Settings sidebar and at its own head. One
 * table, because the row that opens a page and the title over it must never
 * disagree about its name. The name and the glyph are the whole row: what a
 * page holds is one press away. Account's own page is Profile, so its row
 * does not repeat the heading it stands under; the Workspace page's row is
 * Workspace under the listed workspace's name, and its head names that
 * workspace.
 */
const SETTINGS_PAGE = {
  [SETTINGS_VIEW.ACCOUNT]: { title: "Profile", icon: <UserIcon /> },
  [SETTINGS_VIEW.WORKSPACE]: {
    title: "Workspace",
    icon: <UsersIcon className="settings-icon" />,
  },
  [SETTINGS_VIEW.CODING_AGENTS]: { title: "Coding agents", icon: <TerminalIcon /> },
  [SETTINGS_VIEW.INTEGRATIONS]: { title: "Integrations", icon: <PlugIcon /> },
  [SETTINGS_VIEW.PLAN_TEMPLATE]: { title: "Plan template", icon: <DocumentIcon /> },
  [SETTINGS_VIEW.VOICE]: { title: "Voice", icon: <SpeakerIcon /> },
  [SETTINGS_VIEW.APPEARANCE]: { title: "Appearance", icon: <DisplayIcon /> },
  [SETTINGS_VIEW.NOTIFICATIONS]: {
    title: "Notifications",
    icon: <BellIcon className="settings-icon" />,
  },
  [SETTINGS_VIEW.THIS_MAC]: { title: "This Mac", icon: <LaptopIcon /> },
  [SETTINGS_VIEW.EXPERIMENTAL]: {
    title: "Experimental",
    icon: <FlaskConicalIcon className="settings-icon" />,
  },
  [SETTINGS_VIEW.ABOUT]: { title: "About", icon: <InfoIcon className="settings-icon" /> },
  [SETTINGS_VIEW.SHORTCUTS]: { title: "Keyboard shortcuts", icon: <KeyboardIcon /> },
} satisfies Record<SettingsView, SettingsPage>;

/** What each of the Settings sidebar's groups is headed by where no workspace is listed to name the first. */
const SETTINGS_GROUP_HEADING = {
  [SETTINGS_PAGE_GROUP.WORKSPACE]: "Workspace",
  [SETTINGS_PAGE_GROUP.ACCOUNT]: "Account",
  [SETTINGS_PAGE_GROUP.THIS_MAC]: "This Mac",
} satisfies Record<SettingsPageGroup, string>;

/** The last group's heading in a browser, which runs on whatever the reader holds rather than on a Mac. */
const THIS_DEVICE_HEADING = "This device";

/** Any page's name and glyph: what the Settings sidebar, a page's title, and the command palette name it by. */
export function settingsPageOf(view: SettingsView): SettingsPage {
  return SETTINGS_PAGE[view];
}

/** The Settings sidebar's groups with the pages this platform offers, a group left with none dropped. */
export function shownSettingsPageGroups(
  capabilities: readonly HostCapability[],
): readonly { readonly group: SettingsPageGroup; readonly pages: readonly SettingsView[] }[] {
  return SETTINGS_PAGE_GROUPS.map(({ group, pages }) => ({
    group,
    pages: pages.filter((page) => settingsPageShown(page, capabilities)),
  })).filter(({ pages }) => pages.length > 0);
}

/** A group's heading in the Settings sidebar, the first's where no workspace is listed; the machine's own group is named for the Mac only in the app installed there. */
export function settingsGroupHeadingOf(
  group: SettingsPageGroup,
  capabilities: readonly HostCapability[],
): string {
  if (
    group === SETTINGS_PAGE_GROUP.THIS_MAC &&
    !capabilities.includes(HOST_CAPABILITY.DESKTOP_APP)
  ) {
    return THIS_DEVICE_HEADING;
  }
  return SETTINGS_GROUP_HEADING[group];
}
