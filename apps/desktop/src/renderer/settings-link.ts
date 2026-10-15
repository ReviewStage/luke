import type { SettingsLink, SettingsView } from "@luke/settings/settings-views";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import { landOnSettingsRow } from "./settings-search";

/**
 * settings-link.ts -- following a Settings link: the workspace it names, the tab, the page, and the section landed on.
 *
 * Every Open Settings press names where it leads as a `SettingsLink`, and
 * this is the one place that turns it into the window's state, in the order
 * the window needs: the workspace it names first, which the sidebar then
 * lists, so the Workspace page, which shows the listed one, follows the
 * sidebar still; then Settings, which lands on Profile, then the page, and
 * last the section, which is looked for once the page is drawn and given up
 * on quietly where it is not.
 */

/** The window's own ways to turn to a place in Settings. */
export interface SettingsLinkTargets {
  readonly changeTab: (tab: PanelTab) => void;
  readonly changeView: (view: SettingsView) => void;
  /** Lists the workspace in the sidebar, as its switcher would. */
  readonly chooseWorkspace: (workspaceId: string) => void;
  /** Looks for a section's anchor once drawn; answers how to give the look up. */
  readonly land?: (anchor: string) => () => void;
}

/** Turns the window to the place the link names; answers how to give up the look for its section. */
export function followSettingsLink(link: SettingsLink, targets: SettingsLinkTargets): () => void {
  if (link.workspaceId !== undefined) targets.chooseWorkspace(link.workspaceId);
  targets.changeTab(PANEL_TAB.SETTINGS);
  targets.changeView(link.page);
  if (link.section === undefined) return () => undefined;
  return (targets.land ?? landOnSettingsRow)(link.section);
}
