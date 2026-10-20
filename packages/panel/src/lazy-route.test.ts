// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
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
});

/** A page whose module is handed over when `land` is called, counting how often it was asked for. */
function pageOnDemand() {
  const asked = { count: 0 };
  const Page = ({ name }: { name: string }) => createElement("p", null, `Page of ${name}`);
  // Note that the module is held back until the test lands it, as a slow chunk would be.
  const chunk = Promise.withResolvers<typeof Page>();
  const route = lazyRoute<{ name: string }>(() => {
    asked.count += 1;
    return chunk.promise;
  });
  return { route, asked, land: () => chunk.resolve(Page) };
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

test("a route prefetched before its draw stands the page at once, imported once", async () => {
  const { route, asked, land } = pageOnDemand();
  route.prefetch();
  route.prefetch();
  await act(async () => {
    land();
  });
  // Note that the draw is not awaited, so a page that suspended once more would still stand its fallback here.
  act(() => root.render(routeIn(route)));
  assert.equal(host.textContent, "Page of Ada");
  assert.equal(asked.count, 1);
});
