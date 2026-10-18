import type { SettingsLink, SettingsView } from "@luke/settings/settings-views";
import { useState } from "react";
import { PANEL_TAB, type PanelTab } from "./panel-tabs.js";
import { landOnSettingsRow } from "./settings-search.js";

/**
 * settings-link.ts -- following a Settings link: the workspace it names, the tab, the page, and the section landed on.
 *
 * Every Open Settings press names where it leads as a `SettingsLink`, and
 * this is the one place that turns it into the window's state, in the order
 * the window needs: the workspace it names first, which the Workspace page
 * shows for as long as Settings stays open, the sidebar untouched; then
 * Settings, which lands on Profile, then the page, and last the section,
 * which is looked for once the page is drawn and given up on quietly where
 * it is not. Note that the sidebar is left as it was, because the task open
 * behind Settings must still be the listed workspace's when Back returns to
 * it, and an open of another task answered late must not move what Settings
 * shows.
 */

/** The window's own ways to turn to a place in Settings. */
export interface SettingsLinkTargets {
  readonly changeTab: (tab: PanelTab) => void;
  readonly changeView: (view: SettingsView) => void;
  /** Shows the workspace on the Workspace page while Settings stays open. */
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

/** The workspace Settings shows, and the door a link's workspace is handed to. */
export interface SettingsWorkspace {
  /** The workspace's id: one a link named, else the one the sidebar lists. */
  readonly shownId: string | undefined;
  /** Shows the workspace while Settings stays open. */
  readonly link: (workspaceId: string) => void;
}

/**
 * The workspace Settings shows: the one a link named, while Settings stays
 * open and the sidebar lists the same one it did when the link was followed,
 * else the one the sidebar lists. It answers the workspace's id and the door
 * a link's workspace is handed to.
 */
export function useSettingsWorkspace(input: {
  /** The workspace the sidebar lists. */
  listedId: string | undefined;
  /** The workspaces the account is a member of, which a named one must be among. */
  workspaces: readonly { readonly id: string }[];
  /** Whether Settings is the tab on screen. */
  settingsShown: boolean;
}): SettingsWorkspace {
  const [linked, setLinked] = useState<{ workspaceId: string; over: string | undefined }>();
  // A link's workspace gives way once Settings is left or the sidebar lists another.
  if (linked !== undefined && (!input.settingsShown || linked.over !== input.listedId)) {
    setLinked(undefined);
  }
  const named =
    linked !== undefined && input.workspaces.some((each) => each.id === linked.workspaceId)
      ? linked.workspaceId
      : undefined;
  return {
    shownId: named ?? input.listedId,
    link: (workspaceId) => setLinked({ workspaceId, over: input.listedId }),
  };
}
