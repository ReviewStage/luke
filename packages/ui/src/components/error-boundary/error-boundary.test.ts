// @vitest-environment jsdom

import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ErrorBoundary, RELOAD_ROOM } from "./error-boundary.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FAILURE = "This window could not be shown.";

function alertSaying(failure: string): string {
  return `Something went wrong${failure}Reload`;
}

let roots: Root[] = [];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots = [];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function placeThatThrows(broken: { now: boolean }): () => React.JSX.Element {
  return () => {
    if (broken.now) throw new Error("The place could not draw.");
    return createElement("p", null, "The place");
  };
}

function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

test("a child that throws while drawing draws the failure and Reload rather than nothing, and what stands beside it stays", () => {
  const Place = placeThatThrows({ now: true });
  const page = mount(
    createElement(
      Fragment,
      null,
      createElement("p", null, "The sidebar"),
      createElement(ErrorBoundary, { failure: FAILURE }, createElement(Place)),
    ),
  );
  const alerts = page.querySelectorAll('[role="alert"]');
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.textContent).toBe(alertSaying(FAILURE));
  expect(page.textContent).toBe(`The sidebar${alertSaying(FAILURE)}`);
  expect([...page.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
    "Reload",
  ]);
});

test("a place that names no failure says the boundary's own sentence", () => {
  const Place = placeThatThrows({ now: true });
  const page = mount(createElement(ErrorBoundary, null, createElement(Place)));
  expect(page.querySelector('[role="alert"]')?.textContent).toBe(
    alertSaying("This page could not be shown."),
  );
});

test("a boundary over the whole window heads its failure as the window's one heading", () => {
  const Place = placeThatThrows({ now: true });
  const page = mount(
    createElement(
      ErrorBoundary,
      { failure: FAILURE, room: RELOAD_ROOM.WINDOW },
      createElement(Place),
    ),
  );
  expect(page.querySelector("h1")?.textContent).toBe("Something went wrong");
});

test("Reload runs what it is handed, then draws the place again", () => {
  const broken = { now: true };
  const Place = placeThatThrows(broken);
  const reloads: string[] = [];
  const page = mount(
    createElement(
      ErrorBoundary,
      {
        failure: FAILURE,
        onReload: () => {
          reloads.push("reload");
          broken.now = false;
        },
      },
      createElement(Place),
    ),
  );
  act(() => page.querySelector("button")?.click());
  expect(reloads).toEqual(["reload"]);
  expect(page.textContent).toBe("The place");
  expect(page.querySelector('[role="alert"]')).toBeNull();
});

test("a place that throws again on Reload says its failure again", () => {
  const Place = placeThatThrows({ now: true });
  const page = mount(createElement(ErrorBoundary, { failure: FAILURE }, createElement(Place)));
  act(() => page.querySelector("button")?.click());
  expect(page.querySelector('[role="alert"]')?.textContent).toBe(alertSaying(FAILURE));
});
