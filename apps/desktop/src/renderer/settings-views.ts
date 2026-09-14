import type { CredentialProviderId } from "@sidecar/credentials/vocabulary";
import {
  SETTINGS_PAGE as SETTINGS_VIEW,
  type SettingsPage as SettingsView,
} from "@sidecar/settings";

export type { SettingsView };
/**
 * Where inside the Settings tab the panel currently is: its front page, or one
 * of the pages a front-page row opens. App state rather than panel state for
 * the same reason the tab is — Escape unwinds it one layer at a time from the
 * app's own key handler, and a credential entry begun on a settings page has
 * to bring the panel back to that page after its trip to the key slot.
 */
export { SETTINGS_VIEW };

/** The pages the front page opens, in the order its rows offer them. */
export const SETTINGS_SUBVIEW_LIST = [
  SETTINGS_VIEW.VOICE,
  SETTINGS_VIEW.APPEARANCE,
  SETTINGS_VIEW.SHORTCUTS,
  SETTINGS_VIEW.CONNECTIONS,
] as const;

export type SettingsSubview = (typeof SETTINGS_SUBVIEW_LIST)[number];

/**
 * Which page draws a provider's credential row: every key lives under
 * Connections. This is what brings a credential entry back from the key slot
 * to the page it began on, and it stays a question of the provider so a row
 * drawn elsewhere one day answers for itself rather than landing the answer
 * on a page nobody was looking at.
 */
export function credentialSettingsPage(_providerId: CredentialProviderId): SettingsView {
  return SETTINGS_VIEW.CONNECTIONS;
}

/**
 * The three things that can stand the panel down and take its place: a key
 * being entered, a calendar sign-in waiting on the browser, and a note being
 * written. Each is begun from a row on one of Settings' pages, and each has to
 * come back to that row.
 */
export const PANEL_STAND_DOWN = {
  KEY: "key",
  CONSENT: "consent",
  FEEDBACK: "feedback",
} as const;

/**
 * The two of those three the slot shape is drawn around, never both at once.
 * A note is not one of them: the composer is its own shape, at its own size.
 */
export type SlotOccupant = typeof PANEL_STAND_DOWN.KEY | typeof PANEL_STAND_DOWN.CONSENT;

/** What stood the panel down, and — for a key — whose row it was begun from. */
export type StoodDown =
  | { kind: typeof PANEL_STAND_DOWN.KEY; providerId: CredentialProviderId }
  | { kind: typeof PANEL_STAND_DOWN.CONSENT }
  | { kind: typeof PANEL_STAND_DOWN.FEEDBACK };

/**
 * Which page a stand-down comes back to: the page its own row is drawn on.
 * Returning is a fact about what was begun, not about what was begun last —
 * one remembered page shared by all three lands a cancelled note on whichever
 * page the last key entry happened to belong to.
 *
 * A key's row is its provider's; every consent sign-in's block stands under
 * Integrations on Connections; the feedback composer's section is on the front
 * page itself, which is also where a return that knows nothing else belongs.
 */
export function standDownReturnPage(stood: StoodDown): SettingsView {
  switch (stood.kind) {
    case PANEL_STAND_DOWN.KEY:
      return credentialSettingsPage(stood.providerId);
    case PANEL_STAND_DOWN.CONSENT:
      return SETTINGS_VIEW.CONNECTIONS;
    case PANEL_STAND_DOWN.FEEDBACK:
      return SETTINGS_VIEW.ROOT;
  }
}

const NAV_ROW_ID = {
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
