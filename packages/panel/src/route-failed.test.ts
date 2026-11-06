// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { LAZY_ROUTE } from "./panel-router.js";

/**
 * route-failed.test.ts -- a lazy route of the window's that landed and threw
 * while drawing says so with Reload, which draws it again in place, the
 * window left standing, as `lazy-route.ts`'s surfaces do.
 */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

test("a lazy route that landed and threw while drawing is drawn again in place on Reload", async () => {
  // Note that React says the failure its boundary caught on the console, as it would in the window.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const broken = { now: true };
  const Page = () => {
    if (broken.now) throw new Error("The page could not draw.");
    return createElement("p", null, "Settings");
  };
  const rootRoute = createRootRoute({ component: Outlet });
  const page = createRoute({ getParentRoute: () => rootRoute, path: "/page", ...LAZY_ROUTE });
  page.update({ component: Page });
  const router = createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ["/page"] }),
  });
  await act(async () => {
    await router.load();
    root.render(createElement(RouterProvider, { router }));
  });
  const reload = [...host.querySelectorAll("button")].find(
    (button) => button.textContent?.startsWith("Reload") === true,
  );
  assert.ok(reload, "the route says it failed, with Reload");

  broken.now = false;
  await act(async () => {
    reload.click();
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  assert.equal(host.textContent, "Settings");
});
