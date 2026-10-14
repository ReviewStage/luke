import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import { landOnSettingsRow } from "./settings-search";
import type { SettingsLink, SettingsView } from "./settings-views";

/**
 * settings-link.ts -- following a Settings link: the tab, the page, the workspace it shows, and the section landed on.
 *
 * Every Open Settings press names where it leads as a `SettingsLink`, and
 * this is the one place that turns it into the window's state, in the order
 * the window needs: Settings first, which lands on its front page, then the
 * page, the workspace the Workspace page shows, and last the section, which
 * is looked for once the page is drawn and given up on quietly where it is
 * not.
 */

/** The window's own ways to turn to a place in Settings. */
export interface SettingsLinkTargets {
  readonly changeTab: (tab: PanelTab) => void;
  readonly changeView: (view: SettingsView) => void;
  /** The workspace the Workspace page shows, or none for the one the sidebar lists. */
  readonly changeWorkspace: (workspaceId: string | undefined) => void;
  /** Looks for a section's anchor once drawn; answers how to give the look up. */
  readonly land?: (anchor: string) => () => void;
}

/** Turns the window to the place the link names; answers how to give up the look for its section. */
export function followSettingsLink(link: SettingsLink, targets: SettingsLinkTargets): () => void {
  targets.changeTab(PANEL_TAB.SETTINGS);
  targets.changeView(link.page);
  targets.changeWorkspace(link.workspaceId);
  if (link.section === undefined) return () => undefined;
  return (targets.land ?? landOnSettingsRow)(link.section);
}
