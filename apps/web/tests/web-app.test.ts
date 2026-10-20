// @vitest-environment jsdom
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "@luke/panel/testing/match-media";
import "@luke/panel/testing/resize-observer";
import { LINK_PLATFORM } from "@luke/features/link-open";
import { afterEach, test, vi } from "vitest";
import { mountWebApp, type WebApp } from "../src/app/web-root";
import { type FakeService, fakeService, LISTED_TASK } from "./support/fake-service";

/**
 * The web app's root signed out, on a Mac: the shared host in the tab reads
 * the cookie session, finds none, and the panel draws its own sign-in with
 * the way to the Mac app beside it; and a return to the tab after the cookie
 * changed, another tab having signed in, reads the session again and opens
 * Home on the account's tasks. The next load's frame (app.html's, as
 * `public/app-theme.js` stands it) follows the tab: no sidebar while it
 * reads nobody signed in, though the sidebar was last kept open, and the
 * sidebar once it reads someone. One mount per file, because the panel's
 * state read is the tab's once.
 */

const BOOT = readFileSync(join(import.meta.dirname, "..", "public", "app-theme.js"), "utf8");

/** Whether the next load's frame stands the sidebar, as the head's script reads what this tab kept. */
function nextFramePinsSidebar(): boolean {
  document.documentElement.removeAttribute("data-luke-boot-sidebar");
  // biome-ignore lint/security/noGlobalEval: the script under test is the site's own file, run as the page runs it.
  window.eval(BOOT);
  return document.documentElement.getAttribute("data-luke-boot-sidebar") === "pinned";
}

let app: WebApp | undefined;

/** How many session reads the tab has begun so far. */
function sessionReads(service: FakeService): number {
  return service.seen().filter((request) => request.path === "/api/auth/get-session").length;
}

afterEach(async () => {
  await app?.close();
  localStorage.clear();
  document.documentElement.removeAttribute("data-luke-boot-sidebar");
});

test("signed out, the panel draws its sign-in; a return after another tab signed in opens Home", async () => {
  const service = fakeService({ signedIn: false });
  // An earlier load read someone signed in here, the sidebar open.
  localStorage.setItem("luke.signed-in-here", "true");
  localStorage.setItem("luke.sidebar-collapsed", "false");
  const root = document.createElement("div");
  document.body.append(root);

  app = await mountWebApp(root, { httpClient: service.layer, linkPlatform: LINK_PLATFORM.MAC });

  assert.ok(app !== undefined, "the host stands");
  await vi.waitFor(() =>
    assert.ok(root.querySelector("section.sign-in-gate") !== null, "the panel draws its sign-in"),
  );
  const toMac = [...root.querySelectorAll("a")].find(
    (link) => link.textContent === "Open in the Mac app",
  );
  assert.match(toMac?.getAttribute("href") ?? "", /^tryluke:/u);
  await vi.waitFor(() =>
    assert.equal(nextFramePinsSidebar(), false, "signed out, the next frame stands no sidebar"),
  );

  // The launch reads the session again once the host stands; that read must
  // have begun before the cookie changes, or it alone would sign the tab in
  // and the return below would prove nothing. A return to the tab while a
  // read is still out joins it, so the tab is returned to until a read begun
  // after the change lands.
  await vi.waitFor(() => assert.ok(sessionReads(service) >= 2, "the launch's reads have begun"));

  // Another tab signed in: the cookie names someone now, and this tab is focused again.
  service.setSession(true);
  await vi.waitFor(() => {
    window.dispatchEvent(new Event("focus"));
    assert.ok(root.querySelector("section.sign-in-gate") === null, "the sign-in is gone");
    assert.match(root.textContent ?? "", new RegExp(LISTED_TASK.name, "u"));
  }, 5_000);
  await vi.waitFor(() =>
    assert.ok(nextFramePinsSidebar(), "signed in, the next frame stands the sidebar"),
  );
});
