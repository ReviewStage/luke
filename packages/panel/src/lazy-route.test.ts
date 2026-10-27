// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { lazyRoute } from "./lazy-route.js";

const LOADING = "Loading the page";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

/** A page whose module is handed over when `land` is called. */
function pageOnDemand() {
  const Page = ({ name }: { name: string }) => createElement("p", null, `Page of ${name}`);
  // Note that the module is held back until the test lands it, as a slow chunk would be.
  const chunk = Promise.withResolvers<typeof Page>();
  const route = lazyRoute<{ name: string }>(() => chunk.promise);
  return { route, land: () => chunk.resolve(Page) };
}

function routeIn(route: ReturnType<typeof pageOnDemand>["route"]): React.ReactNode {
  return createElement(
    Suspense,
    { fallback: createElement("p", null, LOADING) },
    createElement(route.Route, { name: "Ada" }),
  );
}

test("a route drawn before its chunk lands stands its fallback, then the page", async () => {
  const { route, land } = pageOnDemand();
  await act(async () => root.render(routeIn(route)));
  assert.equal(host.textContent, LOADING);
  await act(async () => {
    land();
  });
  assert.equal(host.textContent, "Page of Ada");
});

test("a route prefetched before its draw stands the page at once", async () => {
  const { route, land } = pageOnDemand();
  route.prefetch();
  await act(async () => {
    land();
  });
  // Note that the draw is not awaited, so a page that suspended once more would still stand its fallback here.
  act(() => root.render(routeIn(route)));
  assert.equal(host.textContent, "Page of Ada");
});

/** The Reload a route's failure stands with, once it stands. */
function reloadButton(): HTMLButtonElement {
  const reload = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Reload",
  );
  assert.ok(
    host.querySelector('[role="alert"]') !== null && reload !== undefined,
    "the failure stands with Reload",
  );
  return reload;
}

test("a route whose chunk failed says so with Reload, which reloads the window to read the chunk again", async () => {
  // Note that React says the failure its boundary caught on the console, as it would in the window.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const chunk = Promise.withResolvers<() => React.JSX.Element>();
  const reloads: string[] = [];
  const route = lazyRoute<{ name: string }>(
    () => chunk.promise,
    () => reloads.push("window"),
  );
  await act(async () => root.render(routeIn(route)));
  await act(async () => {
    chunk.reject(new TypeError("Failed to fetch dynamically imported module"));
  });
  assert.doesNotMatch(host.textContent ?? "", /Page of Ada/u);

  act(() => reloadButton().click());
  assert.deepEqual(reloads, ["window"]);
});

test("a route that landed and threw while drawing is drawn again in place on Reload, the window left standing", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const broken = { now: true };
  const Page = ({ name }: { name: string }) => {
    if (broken.now) throw new Error("The page could not draw.");
    return createElement("p", null, `Page of ${name}`);
  };
  const reloads: string[] = [];
  const route = lazyRoute<{ name: string }>(
    () => Promise.resolve(Page),
    () => reloads.push("window"),
  );
  await act(async () => root.render(routeIn(route)));
  const reload = reloadButton();

  broken.now = false;
  act(() => reload.click());
  assert.equal(host.textContent, "Page of Ada");
  assert.deepEqual(reloads, []);
});
