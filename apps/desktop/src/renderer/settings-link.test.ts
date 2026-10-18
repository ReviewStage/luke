// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { SETTINGS_SEARCH_ANCHOR_ATTRIBUTE } from "@luke/settings/settings-anchors";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsView } from "@luke/settings/settings-views";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import { WorkspacePage } from "./settings/workspace-page";
import { followSettingsLink, useSettingsWorkspace } from "./settings-link";

/**
 * A Settings link followed as the window follows it: Settings, then the
 * page, the workspace the Workspace page shows, and the section, which is
 * the anchor its group wears on the page drawn.
 */

const ACME: Workspace = {
  id: "workspace-acme",
  name: "acme",
  slug: "acme",
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "acme", active: true },
};

/** Where a link's section landed, once it did. */
interface Landing {
  on: Element | null;
}

const roots: Root[] = [];

beforeEach(() => {
  fakeAppBridge({
    act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: [] }),
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

test("a link lists its workspace, turns to Settings and its page, and lands on its section's group as the page draws it", () => {
  const turned: (PanelTab | SettingsView | string)[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(WorkspacePage, {
        readerId: undefined,
        control: {
          workspaces: [ACME],
          workspaceId: ACME.id,
          listFailed: false,
          onRetryList: () => undefined,
          onLeft: () => undefined,
        },
      }),
    ),
  );
  const landed: Landing = { on: null };

  followSettingsLink(
    {
      page: SETTINGS_VIEW.WORKSPACE,
      section: SETTINGS_SECTION.GITHUB_REPOSITORIES,
      workspaceId: ACME.id,
    },
    {
      changeTab: (tab) => turned.push(tab),
      changeView: (view) => turned.push(view),
      chooseWorkspace: (workspaceId) => turned.push(workspaceId),
      land: (anchor) => {
        landed.on = document.querySelector(`[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${anchor}"]`);
        return () => undefined;
      },
    },
  );

  assert.deepEqual(turned, [ACME.id, PANEL_TAB.SETTINGS, SETTINGS_VIEW.WORKSPACE]);
  assert.equal(landed.on?.querySelector("h2")?.textContent, "Integrations");
  assert.ok(
    [...(landed.on?.querySelectorAll('.luke-settings-row [id$="label"]') ?? [])].some(
      (name) => name.textContent === "GitHub",
    ),
    "the group the old GitHub repositories link names holds GitHub's row",
  );
});

test("a link naming no section or workspace lands on the page's head, and leaves the sidebar's workspace listed", () => {
  const turned: (PanelTab | SettingsView | string)[] = [];
  let landings = 0;

  followSettingsLink(
    { page: SETTINGS_VIEW.WORKSPACE },
    {
      changeTab: (tab) => turned.push(tab),
      changeView: (view) => turned.push(view),
      chooseWorkspace: (workspaceId) => turned.push(workspaceId),
      land: () => {
        landings += 1;
        return () => undefined;
      },
    },
  );

  assert.deepEqual(turned, [PANEL_TAB.SETTINGS, SETTINGS_VIEW.WORKSPACE]);
  assert.equal(landings, 0);
});

test("a link's workspace stands on the Workspace page while Settings stays open, the sidebar's listing untouched, and gives way once Settings is left or the sidebar lists another", () => {
  const workspaces = [
    { id: "workspace-personal" },
    { id: "workspace-acme" },
    { id: "workspace-platform" },
  ];
  let shown: ReturnType<typeof useSettingsWorkspace> | undefined;
  function Probe(props: { listedId: string; settingsShown: boolean }) {
    shown = useSettingsWorkspace({ ...props, workspaces });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const draw = (listedId: string, settingsShown: boolean) =>
    act(() => root.render(createElement(Probe, { listedId, settingsShown })));

  draw("workspace-personal", true);
  act(() => shown?.link("workspace-acme"));
  const linked = shown?.shownId;
  draw("workspace-personal", false);
  const left = shown?.shownId;
  draw("workspace-personal", true);
  act(() => shown?.link("workspace-acme"));
  draw("workspace-platform", true);
  const switched = shown?.shownId;
  act(() => root.unmount());

  assert.deepEqual(
    [linked, left, switched],
    ["workspace-acme", "workspace-personal", "workspace-platform"],
  );
});
