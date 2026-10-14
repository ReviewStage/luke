import {
  DisplayIcon,
  DocumentIcon,
  KeyboardIcon,
  LaptopIcon,
  PlugIcon,
  SpeakerIcon,
  TerminalIcon,
  UserIcon,
} from "@sidecar/panel";
import { SETTINGS_VIEW, type SettingsView } from "../settings-views";

/**
 * What each page is called on the front page and at its own head. One table,
 * because the row that opens a page and the header that leaves it must never
 * disagree about its name. The name and the glyph are the whole row: what a
 * page holds is one press away, and a sentence under every name made the
 * front page read as prose rather than as places to go.
 */
const SETTINGS_PAGE = {
  [SETTINGS_VIEW.VOICE]: {
    title: "Voice",
    icon: <SpeakerIcon />,
  },
  [SETTINGS_VIEW.APPEARANCE]: {
    title: "Appearance",
    icon: <DisplayIcon />,
  },
  [SETTINGS_VIEW.SHORTCUTS]: {
    title: "Keyboard shortcuts",
    icon: <KeyboardIcon />,
  },
  [SETTINGS_VIEW.PLAN_TEMPLATE]: {
    title: "Plan template",
    icon: <DocumentIcon />,
  },
  [SETTINGS_VIEW.CODING_AGENTS]: {
    title: "Coding agents",
    icon: <TerminalIcon />,
  },
  [SETTINGS_VIEW.INTEGRATIONS]: {
    title: "Integrations",
    icon: <PlugIcon />,
  },
  [SETTINGS_VIEW.WORKSPACE]: {
    title: "Workspace",
    icon: <UserIcon />,
  },
};

/** The front page's name where it is one page among the others rather than their index. */
const GENERAL_PAGE = { title: "General", icon: <LaptopIcon /> } as const;

/** Any page's name and glyph, the front page's as General: what the desktop sidebar and the command palette list it by. */
export function settingsPageOf(view: SettingsView): { title: string; icon: React.JSX.Element } {
  return view === SETTINGS_VIEW.ROOT ? GENERAL_PAGE : SETTINGS_PAGE[view];
}
