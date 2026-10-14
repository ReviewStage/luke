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
import { BellIcon, InfoIcon, UsersIcon } from "lucide-react";
import { SETTINGS_VIEW, type SettingsView } from "../settings-views";

/**
 * What each page is called in the Settings sidebar and at its own head. One
 * table, because the row that opens a page and the title over it must never
 * disagree about its name. The name and the glyph are the whole row: what a
 * page holds is one press away.
 */
const SETTINGS_PAGE = {
  [SETTINGS_VIEW.ACCOUNT]: { title: "Account", icon: <UserIcon /> },
  [SETTINGS_VIEW.WORKSPACE]: { title: "Workspace", icon: <UsersIcon className="settings-icon" /> },
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
  [SETTINGS_VIEW.ABOUT]: { title: "About", icon: <InfoIcon className="settings-icon" /> },
  [SETTINGS_VIEW.SHORTCUTS]: { title: "Keyboard shortcuts", icon: <KeyboardIcon /> },
} satisfies Record<SettingsView, { title: string; icon: React.JSX.Element }>;

/** Any page's name and glyph: what the Settings sidebar, a page's title, and the command palette name it by. */
export function settingsPageOf(view: SettingsView): { title: string; icon: React.JSX.Element } {
  return SETTINGS_PAGE[view];
}
