import { APP_PANEL_TAB, type AppPanelTab } from "@sidecar/guide";

/**
 * The window's two places, Plans and Settings, aliased from the core's set
 * rather than declared here: a counted tab change names a tab in the same
 * words the window does, and the two must not drift into separate
 * vocabularies. Every way into a place — a press, a key, a composer's return —
 * takes one of these.
 */
export const PANEL_TAB = APP_PANEL_TAB;

export type PanelTab = AppPanelTab;
