// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_ROLE, type Workspace } from "@sidecar/hosted/workspace-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import { WorkspacePage } from "./settings/workspace-page";
import { SETTINGS_SEARCH_ANCHOR_ATTRIBUTE } from "./settings-anchors";
import { followSettingsLink } from "./settings-link";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsView } from "./settings-views";

/**
 * A Settings link followed as the window follows it: Settings, then the
 * page, the workspace the Workspace page shows, and the section, which is
 * the anchor its group wears on the page drawn.
 */

const ACME: Workspace = {
  id: "workspace-acme",
  name: "acme",
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "acme", active: true },
};

/** Where a link's section landed, once it did. */
interface Landing {
  on: Element | null;
}

const roots: Root[] = [];

beforeEach(() => {
  Object.defineProperty(window, "sidecar", {
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

test("a link turns to Settings, its page, and its workspace, and lands on its section's group as the page draws it", () => {
  const turned: (PanelTab | SettingsView | string | undefined)[] = [];
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
          onChooseWorkspace: () => undefined,
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
      changeWorkspace: (workspaceId) => turned.push(workspaceId),
      land: (anchor) => {
        landed.on = document.querySelector(`[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${anchor}"]`);
        return () => undefined;
      },
    },
  );

  assert.deepEqual(turned, [PANEL_TAB.SETTINGS, SETTINGS_VIEW.WORKSPACE, ACME.id]);
  assert.equal(landed.on?.querySelector("h2")?.textContent, "GitHub repositories");
});

test("a link naming no section or workspace lands on the page's head, with the sidebar's workspace", () => {
  const turned: (PanelTab | SettingsView | string | undefined)[] = [];
  let landings = 0;

  followSettingsLink(
    { page: SETTINGS_VIEW.WORKSPACE },
    {
      changeTab: (tab) => turned.push(tab),
      changeView: (view) => turned.push(view),
      changeWorkspace: (workspaceId) => turned.push(workspaceId),
      land: () => {
        landings += 1;
        return () => undefined;
      },
    },
  );

  assert.deepEqual(turned, [PANEL_TAB.SETTINGS, SETTINGS_VIEW.WORKSPACE, undefined]);
  assert.equal(landings, 0);
});
