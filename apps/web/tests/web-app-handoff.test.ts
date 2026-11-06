// @vitest-environment jsdom
import assert from "node:assert/strict";
import "@repo/panel/testing/match-media";
import "@repo/panel/testing/resize-observer";
import { LINK_OPEN, LINK_PLATFORM } from "@repo/features/link-open";
import { afterEach, test, vi } from "vitest";
import { mountWebApp, type WebApp } from "../src/app/web-root";
import { fakeService, LISTED_TASK } from "./support/fake-service";
import { pageLoadedBy } from "./support/page-load";

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
  assert.match(opened[0] ?? "", /^vespin:/u);
  assert.match(opened[0] ?? "", new RegExp(`/task/${LISTED_TASK.id}$`, "u"));
  window.dispatchEvent(new Event("focus"));
  await vi.waitFor(() => assert.match(root.textContent ?? "", new RegExp(LISTED_TASK.name, "u")));
  assert.equal(opened.length, 1);
  assert.equal(root.querySelector("section.ui-auth-card"), null, "no sign-in is drawn");
});
