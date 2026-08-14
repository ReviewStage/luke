/**
 * Where inside the Settings tab the panel currently is: its front page, or one
 * of the pages a front-page row opens. App state rather than panel state for
 * the same reason the tab is — Escape unwinds it one layer at a time from the
 * app's own key handler, and a credential entry begun on the Connections page
 * has to bring the panel back to that page after its trip to the key slot.
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
