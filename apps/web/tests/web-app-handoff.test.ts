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
 * The web app's root opened at a plan's link on a Mac, by a fresh
 * navigation, for an account that chose to open its Luke links in the Mac
 * app: the panel draws first, the link the tab loaded at is handed to the
 * app, and the tab stays drawn beside it, handing nothing again as the
 * visitor returns to it. One mount per file, because the panel's state read
 * is the tab's once.
 */

let app: WebApp | undefined;

afterEach(async () => {
  await app?.close();
  localStorage.clear();
  vi.restoreAllMocks();
});

test("a plan's link opened on a Mac by an account that chose the Mac app is handed to the app once, and the tab stays", async () => {
  pageLoadedBy("navigate");
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
  await vi.waitFor(() => assert.equal(opened.length, 1, "the link is handed to the app"));
  assert.match(opened[0] ?? "", /^tryluke:/u);
  assert.match(opened[0] ?? "", new RegExp(`/plan/${LISTED_TASK.id}$`, "u"));
  // The visitor comes back to the tab, which is still drawn and asks the app nothing more.
  window.dispatchEvent(new Event("focus"));
  await vi.waitFor(() => assert.match(root.textContent ?? "", new RegExp(LISTED_TASK.name, "u")));
  assert.equal(opened.length, 1);
  assert.equal(root.querySelector("section.sign-in-gate"), null, "no sign-in is drawn");
});
