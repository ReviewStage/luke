import {
  type CredentialProviderId,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "../shared/credential-providers";
import { APP_SETTING_ID, type AppSettingId } from "./luke-guide";

/**
 * Where inside the Settings tab the panel currently is: its front page, or one
 * of the pages a front-page row opens. App state rather than panel state for
 * the same reason the tab is — Escape unwinds it one layer at a time from the
 * app's own key handler, and a credential entry begun on a settings page has
 * to bring the panel back to that page after its trip to the key slot.
 */
export const SETTINGS_VIEW = {
  ROOT: "root",
  VOICE: "voice",
  APPEARANCE: "appearance",
  SHORTCUTS: "shortcuts",
  CONNECTIONS: "connections",
} as const;

export type SettingsView = (typeof SETTINGS_VIEW)[keyof typeof SETTINGS_VIEW];

/** The pages the front page opens, in the order its rows offer them. */
export const SETTINGS_SUBVIEW_LIST = [
  SETTINGS_VIEW.VOICE,
  SETTINGS_VIEW.APPEARANCE,
  SETTINGS_VIEW.SHORTCUTS,
  SETTINGS_VIEW.CONNECTIONS,
] as const;

export type SettingsSubview = (typeof SETTINGS_SUBVIEW_LIST)[number];

/**
 * How long a leaving page's content takes to go when the token cannot be
 * read, in milliseconds — a mirror of the stylesheet's resting
 * `--duration-exit`, which is what fades it. The live value comes off the
 * element instead wherever possible, because a capture run and reduced
 * motion both zero the token, and the drawn page must swap as fast as the
 * fade they stilled.
 */
export const PAGE_EXIT_MS = 90;

/**
 * The stylesheet's `--duration-exit` as milliseconds. A computed time keeps
 * its authored unit, so both spellings are read; anything unreadable falls
 * back to the token's resting value rather than to no exit at all.
 */
export function pageExitFromToken(token: string): number {
  const trimmed = token.trim();
  const scale = trimmed.endsWith("ms") ? 1 : trimmed.endsWith("s") ? 1000 : undefined;
  const parsed = Number.parseFloat(trimmed);
  return scale === undefined || Number.isNaN(parsed) ? PAGE_EXIT_MS : parsed * scale;
}

/** Reads the exit duration off the element the fade actually runs on. */
export function pageExitMs(element: Element | null): number {
  if (!element) return PAGE_EXIT_MS;
  return pageExitFromToken(getComputedStyle(element).getPropertyValue("--duration-exit"));
}

/**
 * Which page each setting is drawn on.
 *
 * A page that is not open is not rendered at all, so this is what anything
 * reaching for a control by hand has to consult first — an errand flying to a
 * switch on a closed page would find nothing there and quietly go nowhere. A
 * `Record` over every id on purpose: the same lever the guide uses, so a
 * setting added later does not build until someone says where it lives.
 *
 * The guide says the same thing in prose, in the by-hand path it offers for
 * each setting. That the two agree is a test rather than a type, because one
 * is a sentence and the other is a page.
 */
export const SETTING_PAGE: Record<AppSettingId, SettingsView> = {
  [APP_SETTING_ID.VOICE]: SETTINGS_VIEW.VOICE,
  [APP_SETTING_ID.VOICE_SPEED]: SETTINGS_VIEW.VOICE,
  [APP_SETTING_ID.VOICE_CAPTIONS]: SETTINGS_VIEW.VOICE,
  [APP_SETTING_ID.DUCK_OTHER_MEDIA]: SETTINGS_VIEW.VOICE,
  // Beside the calendar row whose connection gives it meaning, not with the
  // voice switches: the quiet is a fact about the calendar integration.
  [APP_SETTING_ID.QUIET_DURING_MEETINGS]: SETTINGS_VIEW.CONNECTIONS,
  [APP_SETTING_ID.SHOW_IN_MENU_BAR]: SETTINGS_VIEW.APPEARANCE,
  [APP_SETTING_ID.SHOW_IN_DOCK]: SETTINGS_VIEW.APPEARANCE,
  [APP_SETTING_ID.SHOW_ON_ALL_DISPLAYS]: SETTINGS_VIEW.APPEARANCE,
  [APP_SETTING_ID.FORM_FACTOR]: SETTINGS_VIEW.APPEARANCE,
  // Drawn on the front page itself, beside Feedback: a flight
  // to it opens no page at all, only the tab.
  [APP_SETTING_ID.AUTOMATIC_UPDATES]: SETTINGS_VIEW.ROOT,
  // The three the guide describes but marks by-hand-only. Nothing flies to
  // them — a spoken ask is refused before it reaches a page — but where they
  // are drawn is a fact about the settings either way, and answering it here
  // is what keeps the answer right if one of them is ever opened up.
  [APP_SETTING_ID.DEFAULT_WORKSPACE_PROVIDER]: SETTINGS_VIEW.CONNECTIONS,
  [APP_SETTING_ID.WORKSPACE_AGENT_MODEL]: SETTINGS_VIEW.CONNECTIONS,
  [APP_SETTING_ID.WORKSPACE_AGENT_EFFORT]: SETTINGS_VIEW.CONNECTIONS,
};

/**
 * Which page draws a provider's credential row. Every key lives under
 * Connections except the one voice runs on: the OpenAI row stands at the top
 * of the Voice page, beside the feature it turns on. This is what brings a
 * credential entry back from the key slot to the page it began on — restoring
 * Connections around an entry begun on Voice would land the answer on a page
 * nobody was looking at.
 */
export function credentialSettingsPage(providerId: CredentialProviderId): SettingsSubview {
  return providerId === VOICE_CREDENTIAL_PROVIDER_ID
    ? SETTINGS_VIEW.VOICE
    : SETTINGS_VIEW.CONNECTIONS;
}

/** How each page names itself, which is how the guide's by-hand paths word it. */
export const SETTINGS_PAGE_LABEL: Record<SettingsView, string> = {
  [SETTINGS_VIEW.ROOT]: "front page",
  [SETTINGS_VIEW.VOICE]: "Voice",
  [SETTINGS_VIEW.APPEARANCE]: "Appearance",
  [SETTINGS_VIEW.SHORTCUTS]: "Keyboard shortcuts",
  [SETTINGS_VIEW.CONNECTIONS]: "Connections",
};

const NAV_ROW_ID: Record<SettingsSubview, string> = {
  [SETTINGS_VIEW.VOICE]: "settings-nav-voice",
  [SETTINGS_VIEW.APPEARANCE]: "settings-nav-appearance",
  [SETTINGS_VIEW.SHORTCUTS]: "settings-nav-shortcuts",
  [SETTINGS_VIEW.CONNECTIONS]: "settings-nav-connections",
};

/**
 * The element id of a page's front-page row, so leaving the page can hand the
 * keyboard back to the row that opened it.
 */
export function settingsNavRowId(view: SettingsSubview): string {
  return NAV_ROW_ID[view];
}
