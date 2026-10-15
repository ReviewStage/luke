// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { SETTINGS_SEARCH_ANCHOR_ATTRIBUTE } from "@luke/settings/settings-anchors";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsView } from "@luke/settings/settings-views";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import { WorkspacePage } from "./settings/workspace-page";
import { followSettingsLink } from "./settings-link";

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
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: [] }),
      recordSurfaceEvent: () => undefined,
    },
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
  assert.equal(landed.on?.querySelector("h2")?.textContent, "GitHub");
  assert.ok(
    [...(landed.on?.querySelectorAll(".settings-row strong") ?? [])].some(
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
