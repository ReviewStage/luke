// @vitest-environment jsdom
import assert from "node:assert/strict";
import "@luke/panel/testing/match-media";
import "@luke/panel/testing/resize-observer";
import { afterEach, test, vi } from "vitest";
import { mountWebApp, type WebApp } from "../src/app/web-root";
import { type FakeService, fakeService, LISTED_TASK } from "./support/fake-service";

/**
 * The web app's root signed out: the shared host in the tab reads the
 * cookie session, finds none, and the panel draws its own sign-in with the
 * way to the Mac app beside it; and a return to the tab after the cookie
 * changed, another tab having signed in, reads the session again and opens
 * Home on the account's tasks. One mount per file, because the panel's
 * state read is the tab's once.
 */

let app: WebApp | undefined;

/** How many times the tab has read its session so far. */
function sessionReads(service: FakeService): number {
  return service.seen().filter((request) => request.path === "/api/auth/get-session").length;
}

afterEach(async () => {
  await app?.close();
  localStorage.clear();
});

test("signed out, the panel draws its sign-in; a return after another tab signed in opens Home", async () => {
  const service = fakeService({ signedIn: false });
  const root = document.createElement("div");
  document.body.append(root);

  app = await mountWebApp(root, { httpClient: service.layer });

  assert.ok(app !== undefined, "the host stands");
  await vi.waitFor(() =>
    assert.ok(root.querySelector("section.sign-in-gate") !== null, "the panel draws its sign-in"),
  );
  const toMac = [...root.querySelectorAll("a")].find(
    (link) => link.textContent === "Open in the Mac app",
  );
  assert.match(toMac?.getAttribute("href") ?? "", /^tryluke:/u);

  // The launch reads the session once more as the host stands, before the
  // cookie changes; a return to the tab while that read is still out joins
  // it, so the tab is returned to until a read begun after the change lands.
  await vi.waitFor(() => assert.equal(sessionReads(service), 2));

  // Another tab signed in: the cookie names someone now, and this tab is focused again.
  service.setSession(true);
  await vi.waitFor(() => {
    window.dispatchEvent(new Event("focus"));
    assert.ok(root.querySelector("section.sign-in-gate") === null, "the sign-in is gone");
    assert.match(root.textContent ?? "", new RegExp(LISTED_TASK.name, "u"));
  }, 5_000);
});
