// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { layTitle } from "../../testing/laid-title.js";
import type { MenuEntry } from "../menu/menu.js";
import { PaneBar } from "./pane-bar.js";

/**
 * pane-bar.test.ts -- a tab's bar draws its lead, its middle, and its
 * actions in that order with the ⋯ last, and leaves out a slot that says
 * nothing; the ⋯ drops the menu it was handed, named as the ⋯ is, and a
 * choice in it acts and closes it; a title the bar would cut under the
 * readable floor stands on a row of its own, still read whole.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TITLE = "Quarterly review of the onboarding funnel";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function render(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

function barOf(container: HTMLElement): HTMLElement {
  return container.querySelector("header") ?? assert.fail("the bar");
}

/** The button named `name`. */
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => (each.getAttribute("aria-label") ?? each.textContent) === name,
  );
  return found ?? assert.fail(`a button named ${name}`);
}

/** The menu named `label` standing open, if it is: drawn and not on its way out. */
function openMenu(label: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[role="menu"][aria-label="${label}"]:not([data-leaving])`,
  );
}

const ignore = (): void => undefined;

test("the lead, the middle, and the actions stand in that order, the ⋯ last", () => {
  const container = render(
    createElement(PaneBar, {
      mark: createElement("svg", { "data-part": "mark", "aria-hidden": true }),
      title: TITLE,
      detail: "Version 2 of 3",
      middle: createElement("span", { "data-part": "middle" }, "src / index.ts"),
      actions: createElement("button", { type: "button", onClick: ignore }, "Reload"),
      menu: { thing: "Page", groups: [[{ label: "Copy link", onSelect: ignore }]] },
    }),
  );
  const said = [...barOf(container).querySelectorAll("[data-part], .luke-one-line, button")].map(
    (part) => part.getAttribute("data-part") ?? part.getAttribute("aria-label") ?? part.textContent,
  );
  assert.deepEqual(said, ["mark", TITLE, "middle", "Reload", "Page actions"]);
  assert.ok(barOf(container).textContent?.includes("Version 2 of 3"));
});

test("a slot that says nothing is not drawn, and a bar with no menu has no ⋯", () => {
  const container = render(createElement(PaneBar, { title: TITLE, middle: null, actions: "" }));
  const bar = barOf(container);
  assert.equal(bar.querySelector("button"), null);
  assert.equal(bar.textContent, TITLE);
});

test("the ⋯ drops the menu it was handed, and a choice in it acts and closes it", () => {
  const chosen: string[] = [];
  const groups: readonly (readonly MenuEntry[])[] = [
    [
      { label: "Copy path", onSelect: () => chosen.push("Copy path") },
      { label: "Save as…", onSelect: () => chosen.push("Save as…") },
    ],
  ];
  render(createElement(PaneBar, { title: "index.ts", menu: { thing: "File", groups } }));
  const more = button("File actions");
  assert.equal(more.getAttribute("aria-haspopup"), "menu");
  assert.equal(openMenu("File actions"), null);

  act(() => more.click());
  const menu = openMenu("File actions") ?? assert.fail("the file's menu");
  assert.equal(more.getAttribute("aria-expanded"), "true");
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  assert.deepEqual(
    items.map((item) => item.textContent),
    ["Copy path", "Save as…"],
  );

  act(() => items[0]?.click());
  assert.deepEqual(chosen, ["Copy path"]);
  assert.equal(more.getAttribute("aria-expanded"), "false");
});

test("a title the bar would cut under the readable floor stands on a row of its own", () => {
  const laid = layTitle({
    room: ".luke-pane-bar-lead",
    words: ".luke-pane-bar-title",
    roomWidth: 64,
    whole: 203,
    floor: 120,
  });
  try {
    const bar = barOf(
      render(
        createElement(PaneBar, { title: TITLE, actions: createElement("span", null, "Viewed") }),
      ),
    );
    assert.equal(bar.dataset.wrapped, "true");
    assert.match(bar.textContent ?? "", new RegExp(TITLE));
  } finally {
    laid.restore();
  }
});
