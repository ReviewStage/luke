// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { Button } from "../button/button.js";
import { List, ListRow } from "../list-row/list-row.js";
import { PAGE_FRAME } from "../page-frame/page-frame.js";
import { TextField } from "../text-field/text-field.js";
import { COLLECTION_STATE, CollectionPage, type CollectionState } from "./collection-page.js";

/**
 * collection-page.test.ts -- the page is named by its title, each state of
 * its content shows what that state says, a read in progress is announced by
 * name, and the header and filters a reader is using stay as they were while
 * the content changes state under them. Under the window's toolbar the page
 * draws no title of its own, stands the toolbar, and is named by its label.
 * Synthetic tasks.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** The tasks page at `state`, its search held in the page's caller as an app holds it. */
function Tasks({ state }: { state: CollectionState }): React.JSX.Element {
  const [query, setQuery] = useState("");
  return createElement(CollectionPage, {
    title: "Tasks",
    description: "Everything planned in this workspace.",
    actions: createElement(Button, null, "New task"),
    filters: createElement(TextField, { label: "Search tasks", value: query, onChange: setQuery }),
    state,
    loadingLabel: "Reading tasks",
    empty: createElement("p", null, "No tasks yet"),
    error: createElement("p", { role: "alert" }, "Tasks could not be read"),
    children: createElement(List, {
      label: "Tasks",
      children: ["Launch checklist", "Billing migration"].map((name) =>
        createElement(ListRow, { key: name, title: name, onPress: () => undefined }),
      ),
    }),
  });
}

/** Draws the tasks page at `state`, and hands back a way to move it to another. */
function draw(state: CollectionState): (next: CollectionState) => void {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (next: CollectionState) =>
    act(() => root.render(createElement(Tasks, { state: next })));
  render(state);
  return render;
}

function search(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search tasks"]');
  if (input === null) throw new Error("the search field is not drawn");
  return input;
}

function typeInto(input: HTMLInputElement, value: string): void {
  // Note that React reads a change from the value its tracker last saw, so the setter is the prototype's.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("the page is a region named by its title, with its acts and filters in every state", () => {
  const render = draw(COLLECTION_STATE.LOADING);
  for (const state of Object.values(COLLECTION_STATE)) {
    render(state);
    const region = document.querySelector("section");
    const heading = document.querySelector("h1");
    expect(heading?.textContent).toBe("Tasks");
    expect(region?.getAttribute("aria-labelledby")).toBe(heading?.id);
    expect(region?.textContent).toContain("Everything planned in this workspace.");
    expect([...document.querySelectorAll("button")].map((button) => button.textContent)).toContain(
      "New task",
    );
    search();
  }
});

test("a read in progress is announced by name, and shows no rows", () => {
  draw(COLLECTION_STATE.LOADING);
  const status = document.querySelector('[role="status"]');
  expect(status?.textContent).toBe("Reading tasks");
  expect(status?.getAttribute("aria-busy")).toBe("true");
  expect(document.querySelector('[role="list"], ul')).toBeNull();
});

test("an empty collection shows its empty state alone, and a failed one its error", () => {
  const render = draw(COLLECTION_STATE.EMPTY);
  expect(document.body.textContent).toContain("No tasks yet");
  expect(document.querySelector('[role="status"]')).toBeNull();
  expect(document.querySelector("ul")).toBeNull();

  render(COLLECTION_STATE.ERROR);
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Tasks could not be read");
  expect(document.body.textContent).not.toContain("No tasks yet");
});

test("a ready collection shows its rows, and nothing in their place", () => {
  draw(COLLECTION_STATE.READY);
  const list = document.querySelector('ul[aria-label="Tasks"]');
  expect([...(list?.querySelectorAll("li") ?? [])].map((row) => row.textContent)).toEqual([
    "Launch checklist",
    "Billing migration",
  ]);
  expect(document.querySelector('[role="status"]')).toBeNull();
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

test("a search being typed keeps its words and its focus while the content changes state", () => {
  const render = draw(COLLECTION_STATE.READY);
  const input = search();
  act(() => input.focus());
  typeInto(input, "launch");
  render(COLLECTION_STATE.LOADING);
  render(COLLECTION_STATE.EMPTY);
  expect(search()).toBe(input);
  expect(input.value).toBe("launch");
  expect(document.activeElement).toBe(input);
});

/** The tasks page under the window's toolbar at `state`, the toolbar holding the title and the act. */
function drawUnderToolbar(state: CollectionState): (next: CollectionState) => void {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (next: CollectionState) =>
    act(() =>
      root.render(
        createElement(CollectionPage, {
          frame: PAGE_FRAME.TOOLBAR,
          label: "Tasks",
          toolbar: createElement(
            "header",
            null,
            createElement("span", null, "Tasks toolbar"),
            createElement(Button, null, "New task"),
          ),
          filters: createElement(TextField, {
            label: "Search tasks",
            value: "",
            onChange: () => undefined,
          }),
          state: next,
          loadingLabel: "Reading tasks",
          empty: createElement("p", null, "No tasks yet"),
          error: createElement("p", { role: "alert" }, "Tasks could not be read"),
          children: createElement(List, {
            label: "Tasks",
            children: createElement(ListRow, {
              title: "Launch checklist",
              onPress: () => undefined,
            }),
          }),
        }),
      ),
    );
  render(state);
  return render;
}

test("under the toolbar the page is a region named by its label, with no title of its own", () => {
  drawUnderToolbar(COLLECTION_STATE.READY);
  const region = document.querySelector("section");
  expect(region?.getAttribute("aria-label")).toBe("Tasks");
  expect(document.querySelector("h1")).toBeNull();
  expect(region?.textContent).toContain("Tasks toolbar");
  expect([...document.querySelectorAll("button")].map((button) => button.textContent)).toContain(
    "New task",
  );
  search();
});

test("under the toolbar each state shows what it says, under the same toolbar and filters", () => {
  const render = drawUnderToolbar(COLLECTION_STATE.LOADING);
  const toolbar = document.querySelector("header");
  const input = search();
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Reading tasks");

  render(COLLECTION_STATE.EMPTY);
  expect(document.body.textContent).toContain("No tasks yet");

  render(COLLECTION_STATE.ERROR);
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Tasks could not be read");

  render(COLLECTION_STATE.READY);
  expect(document.querySelector('ul[aria-label="Tasks"]')?.textContent).toBe("Launch checklist");
  expect(document.querySelector("header")).toBe(toolbar);
  expect(search()).toBe(input);
});
