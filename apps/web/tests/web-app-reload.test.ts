// @vitest-environment jsdom
import assert from "node:assert/strict";
import "@luke/panel/testing/match-media";
import "@luke/panel/testing/resize-observer";
import { LINK_OPEN, LINK_PLATFORM } from "@luke/features/link-open";
import { afterEach, test, vi } from "vitest";
import { mountWebApp, type WebApp } from "../src/app/web-root";
import { fakeService, LISTED_TASK } from "./support/fake-service";
import { pageLoadedBy } from "./support/page-load";

/**
 * The web app's root reloaded at a plan's link on a Mac, for an account that
 * chose to open its Luke links in the Mac app: the panel draws the plan, and
 * nothing is handed to the app, because a visitor reloading the tab is
 * staying on the web. One mount per file, because the panel's state read is
 * the tab's once.
 */

let app: WebApp | undefined;

afterEach(async () => {
  await app?.close();
  localStorage.clear();
  vi.restoreAllMocks();
});

test("a plan's link reloaded on a Mac by an account that chose the Mac app is not handed to the app", async () => {
  pageLoadedBy("reload");
  const service = fakeService({ signedIn: true, linkOpen: LINK_OPEN.MAC_APP });
  window.history.replaceState(null, "", `/${LISTED_TASK.workspaceId}/plan/${LISTED_TASK.id}`);
  const root = document.createElement("div");
  document.body.append(root);
  const opened: string[] = [];

  app = await mountWebApp(root, {
    httpClient: service.layer,
    linkPlatform: LINK_PLATFORM.MAC,
    openMacApp: (link) => opened.push(link),
  });

  assert.ok(app !== undefined, "the host stands");
  // The plan drawn comes well after a hand-off would have, which asks the service once.
  await vi.waitFor(() => assert.match(root.textContent ?? "", new RegExp(LISTED_TASK.name, "u")));
  assert.deepEqual(opened, []);
});
