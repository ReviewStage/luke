// @vitest-environment jsdom
import assert from "node:assert/strict";
import {
  createBrowserHistory,
  type HistoryLocation,
  type RouterHistory,
} from "@tanstack/react-router";
import { afterEach, test, vi } from "vitest";
import { browserLoadedFresh } from "../src/app/mac-app-handoff";
import { pageLoadedBy } from "./support/page-load";

/**
 * Which loads of a tab the hand-off counts as fresh, by what the browser
 * says of how it loaded the page: a navigation to the address is one; a
 * reload, a Back or Forward into the tab, or a navigation onto an entry
 * holding a place the panel saved is not, nor one our own Open in
 * browser flagged to stay on the web, once; and a browser that says nothing
 * is taken as not.
 */

const TASK_ADDRESS = "/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";

const histories: RouterHistory[] = [];

/** The tab's router history as the page loads it, which the web root makes before reading the load. */
function loadedHistory(): RouterHistory {
  const history = createBrowserHistory();
  histories.push(history);
  return history;
}

/** Where the page loaded, as the tab's router history reads it. */
function loaded(): HistoryLocation {
  return loadedHistory().location;
}

afterEach(() => {
  for (const history of histories.splice(0)) history.destroy();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

test("a navigation to the address is fresh", () => {
  window.history.replaceState(null, "", TASK_ADDRESS);
  pageLoadedBy("navigate");

  assert.equal(browserLoadedFresh(loaded()), true);
});

test("a reload, or a Back or Forward into the tab, is not", () => {
  window.history.replaceState(null, "", TASK_ADDRESS);
  for (const type of ["reload", "back_forward"] as const) {
    pageLoadedBy(type);
    assert.equal(browserLoadedFresh(loaded()), false, type);
  }
});

test("a navigation onto an entry holding a place the panel saved is not", () => {
  window.history.replaceState(null, "", "/");
  // A step the panel saved through an earlier load's router history, read back by the next load's.
  const earlier = loadedHistory();
  earlier.replace(TASK_ADDRESS, { step: { place: { kind: "plan", taskId: "t1" }, index: 3 } });
  earlier.flush();
  pageLoadedBy("navigate");

  assert.equal(browserLoadedFresh(loaded()), false);
});

test("a navigation Open in browser flagged to stay on the web is not, once, the flag leaving the address and nothing else", () => {
  window.history.replaceState(null, "", `${TASK_ADDRESS}?comment=t1&stay=web`);
  pageLoadedBy("navigate");

  assert.equal(browserLoadedFresh(loaded()), false);
  assert.equal(`${location.pathname}${location.search}`, `${TASK_ADDRESS}?comment=t1`);
  assert.equal(
    browserLoadedFresh(loaded()),
    true,
    "an ordinary navigation to the address still is",
  );
});

test("a browser that does not say how it loaded the page is taken as not", () => {
  window.history.replaceState(null, "", TASK_ADDRESS);
  pageLoadedBy(undefined);

  assert.equal(browserLoadedFresh(loaded()), false);
});
