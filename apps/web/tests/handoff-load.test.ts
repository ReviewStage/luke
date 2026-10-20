// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { browserLoadedFresh } from "../src/app/mac-app-handoff";
import { pageLoadedBy } from "./support/page-load";

/**
 * Which loads of a tab the hand-off counts as fresh, by what the browser
 * says of how it loaded the page: a navigation to the address is one; a
 * reload, a Back or Forward into the tab, or a navigation onto an entry
 * holding a place the panel saved is not; and a browser that says nothing is
 * taken as not.
 */

const TASK_ADDRESS = "/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

test("a navigation to the address is fresh", () => {
  window.history.replaceState(null, "", TASK_ADDRESS);
  pageLoadedBy("navigate");

  assert.equal(browserLoadedFresh(), true);
});

test("a reload, or a Back or Forward into the tab, is not", () => {
  window.history.replaceState(null, "", TASK_ADDRESS);
  for (const type of ["reload", "back_forward"] as const) {
    pageLoadedBy(type);
    assert.equal(browserLoadedFresh(), false, type);
  }
});

test("a navigation onto an entry holding a place the panel saved is not", () => {
  window.history.replaceState({ state: { place: "plan" }, idx: 3 }, "", TASK_ADDRESS);
  pageLoadedBy("navigate");

  assert.equal(browserLoadedFresh(), false);
});

test("a browser that does not say how it loaded the page is taken as not", () => {
  window.history.replaceState(null, "", TASK_ADDRESS);
  pageLoadedBy(undefined);

  assert.equal(browserLoadedFresh(), false);
});
