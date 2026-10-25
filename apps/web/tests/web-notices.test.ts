// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { onTabShownChanged, webNoticeDoors } from "../src/app/web-notices";

/**
 * A browser tab's notices: the tab said shown or hidden, and the count before
 * the tab's title or on the installed app's own badge. The tab's visibility
 * and the badge are the operating system's, so both are faked at that
 * boundary.
 */

let visibility: DocumentVisibilityState;

/** Stands the installed app's badge in the browser, recording each count it is set to, and the display mode the site runs in. */
function fakeAppBadge(displayMode: "standalone" | "browser"): number[] {
  const counts: number[] = [];
  vi.stubGlobal("navigator", {
    ...navigator,
    setAppBadge: (count: number) => {
      counts.push(count);
      return Promise.resolve();
    },
    clearAppBadge: () => {
      counts.push(0);
      return Promise.resolve();
    },
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === `(display-mode: ${displayMode})`,
  }));
  return counts;
}

beforeEach(() => {
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.title = "";
});

test("the tab is said shown as the listener stands, and hidden as it goes behind", () => {
  const said: boolean[] = [];
  const stop = onTabShownChanged((shown) => said.push(shown));

  visibility = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  stop();
  visibility = "visible";
  document.dispatchEvent(new Event("visibilitychange"));

  assert.deepEqual(said, [true, false]);
});

test("the count stands before the tab's title as the panel renames it, and leaves at none", async () => {
  const doors = webNoticeDoors();
  document.title = "Luke";

  doors.badge(2);
  assert.equal(document.title, "(2) Luke");

  document.title = "Inbox — Acme";
  await vi.waitFor(() => assert.equal(document.title, "(2) Inbox — Acme"));

  doors.badge(0);
  assert.equal(document.title, "Inbox — Acme");
  doors.close();
});

test("an uninstalled tab counts before its title, though the browser names an app badge", () => {
  const appBadge = fakeAppBadge("browser");
  const doors = webNoticeDoors();
  document.title = "Luke";

  doors.badge(2);

  assert.equal(document.title, "(2) Luke");
  assert.deepEqual(appBadge, []);
  doors.close();
});

test("the installed app counts on its own badge, and leaves the title alone", () => {
  const appBadge = fakeAppBadge("standalone");
  const doors = webNoticeDoors();
  document.title = "Luke";

  doors.badge(2);
  doors.close();

  assert.equal(document.title, "Luke");
  assert.deepEqual(appBadge, [2, 0]);
});
