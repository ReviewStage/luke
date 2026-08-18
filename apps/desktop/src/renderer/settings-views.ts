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
  [APP_SETTING_ID.PREFER_BUILT_IN_MICROPHONE]: SETTINGS_VIEW.VOICE,
  // Beside the calendar row whose connection gives it meaning, not with the
  // voice switches: the quiet is a fact about the calendar integration.
  [APP_SETTING_ID.QUIET_DURING_MEETINGS]: SETTINGS_VIEW.CONNECTIONS,
  [APP_SETTING_ID.SHOW_IN_DOCK]: SETTINGS_VIEW.APPEARANCE,
  [APP_SETTING_ID.SHOW_ON_ALL_DISPLAYS]: SETTINGS_VIEW.APPEARANCE,
  [APP_SETTING_ID.FORM_FACTOR]: SETTINGS_VIEW.APPEARANCE,
  // The three the guide describes but marks by-hand-only. Nothing flies to
  // them — a spoken ask is refused before it reaches a page — but where they
  // are drawn is a fact about the settings either way, and answering it here
  // is what keeps the answer right if one of them is ever opened up.
  [APP_SETTING_ID.DEFAULT_WORKSPACE_PROVIDER]: SETTINGS_VIEW.CONNECTIONS,
  [APP_SETTING_ID.WORKSPACE_AGENT_MODEL]: SETTINGS_VIEW.CONNECTIONS,
  [APP_SETTING_ID.WORKSPACE_AGENT_EFFORT]: SETTINGS_VIEW.CONNECTIONS,
  // The front page itself, which is why the value type is a view rather than
  // a subview: the choice of what Luke runs on leads the page rather than
  // living on one the page opens. By-hand-only like the three above, so
  // nothing ever flies to it — but where it is drawn is a fact either way.
  [APP_SETTING_ID.VOICE_SOURCE]: SETTINGS_VIEW.ROOT,
};

/**
 * Which page draws a provider's credential row. Every key lives under
 * Connections except the one voice runs on: the OpenAI row stands in the
 * What Luke runs on section on the Settings front page, beside the allowance it
 * replaces. This is what brings a credential entry back from the key slot to
 * the page it began on — restoring Connections around an entry begun on the
 * front page would land the answer on a page nobody was looking at.
 */
export function credentialSettingsPage(providerId: CredentialProviderId): SettingsView {
  return providerId === VOICE_CREDENTIAL_PROVIDER_ID
    ? SETTINGS_VIEW.ROOT
    : SETTINGS_VIEW.CONNECTIONS;
}

/**
 * The three things that can stand the panel down and take its place: a key
 * being entered, a calendar sign-in waiting on the browser, and a note being
 * written. Each is begun from a row on one of Settings' pages, and each has to
 * come back to that row.
 */
export const PANEL_STAND_DOWN = {
  KEY: "key",
  CALENDAR: "calendar",
  FEEDBACK: "feedback",
} as const;

export type PanelStandDown = (typeof PANEL_STAND_DOWN)[keyof typeof PANEL_STAND_DOWN];

/**
 * The two of those three the slot shape is drawn around, never both at once.
 * A note is not one of them: the composer is its own shape, at its own size.
 */
export type SlotOccupant = typeof PANEL_STAND_DOWN.KEY | typeof PANEL_STAND_DOWN.CALENDAR;

/** What stood the panel down, and — for a key — whose row it was begun from. */
export type StoodDown =
  | { kind: typeof PANEL_STAND_DOWN.KEY; providerId: CredentialProviderId }
  | { kind: typeof PANEL_STAND_DOWN.CALENDAR }
  | { kind: typeof PANEL_STAND_DOWN.FEEDBACK };

/**
 * Which page a stand-down comes back to: the page its own row is drawn on.
 * Returning is a fact about what was begun, not about what was begun last —
 * one remembered page shared by all three lands a cancelled note on whichever
 * page the last key entry happened to belong to.
 *
 * A key's row is its provider's; the calendar's block stands under
 * Integrations on Connections; the feedback composer's section is on the front
 * page itself, which is also where a return that knows nothing else belongs.
 */
export function standDownReturnPage(stood: StoodDown): SettingsView {
  switch (stood.kind) {
    case PANEL_STAND_DOWN.KEY:
      return credentialSettingsPage(stood.providerId);
    case PANEL_STAND_DOWN.CALENDAR:
      return SETTINGS_VIEW.CONNECTIONS;
    case PANEL_STAND_DOWN.FEEDBACK:
      return SETTINGS_VIEW.ROOT;
  }
}

/** How each page names itself, which is how the guide's by-hand paths word it. */
export const SETTINGS_PAGE_LABEL: Record<SettingsView, string> = {
  // Not a page a row opens, but a place a setting can be drawn — and the
  // words the guide's by-hand paths use for it.
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
