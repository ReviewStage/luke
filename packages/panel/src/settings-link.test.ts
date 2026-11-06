// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { SETTINGS_SEARCH_ANCHOR_ATTRIBUTE } from "@repo/settings/settings-anchors";
import { SETTINGS_SECTION, SETTINGS_VIEW } from "@repo/settings/settings-views";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { WorkspacePage } from "./settings/workspace-page.js";
import { type SettingsRoute, useSettingsRoute } from "./settings-link.js";
import { fakeAppBridge } from "./testing/app-bridge.js";
import { withQueryClient } from "./testing/copy-feedback.js";
import { windowRouter } from "./testing/window-router.js";

/**
 * A Settings link followed as the window follows it: one navigation to the
 * address naming its workspace and its page, which the Workspace page shows
 * while Settings stands, and its section, the anchor its group wears on the
 * page drawn.
 */

const ACME: Workspace = {
  id: "workspace-acme",
  name: "acme",
  slug: "acme",
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "acme", active: true },
};

const PERSONAL: Workspace = { ...ACME, id: "workspace-personal", name: "personal", slug: "me" };

const roots: Root[] = [];

beforeEach(() => {
  fakeAppBridge({});
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

test("a link's workspace is named in Settings' address, which the Workspace page shows while the sidebar lists another, and a page turned keeps it in the link's step", () => {
  const held = windowRouter();
  let settings: SettingsRoute | undefined;
  function Probe() {
    settings = useSettingsRoute({
      workspaces: [PERSONAL, ACME],
      listedId: PERSONAL.id,
      narrow: false,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  act(() => root.render(held.provide(createElement(Probe))));

  act(() => void settings?.open({ page: SETTINGS_VIEW.WORKSPACE, workspaceId: ACME.id }));
  const linked = [held.history.location.href, settings?.workspaceId, settings?.view];
  act(() => void settings?.open({ page: SETTINGS_VIEW.APPEARANCE }));

  assert.deepEqual(linked, ["/acme/settings/workspace", ACME.id, SETTINGS_VIEW.WORKSPACE]);
  assert.deepEqual(held.addresses(), ["/app", "/acme/settings/appearance"]);
  assert.equal(settings?.workspaceId, ACME.id);
});

test("an old link's GitHub repositories section lands on the Workspace page's connections group, which holds GitHub's row", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
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
    ),
  );
  const landed = document.querySelector(
    `[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${SETTINGS_SECTION.GITHUB_REPOSITORIES}"]`,
  );

  assert.equal(landed?.querySelector("h2")?.textContent, "Workspace connections");
  assert.ok(
    [...(landed?.querySelectorAll('.ui-settings-row [id$="label"]') ?? [])].some(
      (name) => name.textContent === "GitHub",
    ),
    "the group the old GitHub repositories link names holds GitHub's row",
  );
});
