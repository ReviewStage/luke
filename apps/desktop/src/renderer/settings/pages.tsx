import {
  SETTINGS_PAGE_GROUP,
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

/** Any page's name and glyph: what the Settings sidebar, a page's title, and the command palette name it by. */
export function settingsPageOf(view: SettingsView): SettingsPage {
  return SETTINGS_PAGE[view];
}

/** A group's heading in the Settings sidebar, the first's where no workspace is listed. */
export function settingsGroupHeadingOf(group: SettingsPageGroup): string {
  return SETTINGS_GROUP_HEADING[group];
}
