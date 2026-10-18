// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { CHIP_LOOK, Chip, ChipName } from "./chip.js";

/**
 * chip.test.ts -- a row of filter chips announces the one pressed, and a
 * press moves it there; a chip drawn as its mark alone keeps its words as
 * its name; and a removable chip's × alone is a press, which lifts it.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FILTERS = ["All", "Plans", "Files"] as const;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function render(element: ReactElement): void {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
}

/** A row of filters whose caller holds the one pressed, as ⌘K's does. */
function Filters(): React.JSX.Element {
  const [chosen, setChosen] = useState<string>(FILTERS[0]);
  return createElement(
    "div",
    null,
    FILTERS.map((each) =>
      createElement(
        Chip,
        {
          key: each,
          look: CHIP_LOOK.FILTER,
          "aria-pressed": each === chosen,
          onClick: () => setChosen(each),
        },
        each,
      ),
    ),
  );
}

function chip(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((each) => each.textContent === name);
  assert.ok(found, `the ${name} filter is drawn`);
  return found;
}

/** The names of the filters that say they stand pressed. */
function pressed(): string[] {
  return [...document.querySelectorAll("button")]
    .filter((each) => each.getAttribute("aria-pressed") === "true")
    .map((each) => each.textContent ?? "");
}

test("a row of filter chips announces the first as pressed and the rest as not", () => {
  render(createElement(Filters));
  assert.equal(chip("Plans").getAttribute("aria-pressed"), "false");
  assert.deepEqual(pressed(), ["All"]);
});

test("pressing a filter chip makes it the one pressed", () => {
  render(createElement(Filters));
  act(() => chip("Files").click());
  assert.deepEqual(pressed(), ["Files"]);
  act(() => chip("Plans").click());
  assert.deepEqual(pressed(), ["Plans"]);
});

test("a chip drawn as its mark alone is still named by its words", () => {
  render(
    createElement(
      Chip,
      { look: CHIP_LOOK.PILL, iconOnly: true },
      createElement("svg", { "aria-hidden": "true" }),
      createElement(ChipName, null, "feature/expiry"),
    ),
  );
  assert.equal(chip("feature/expiry").textContent, "feature/expiry");
});

/** A removable chip whose caller lifts it, as the sidebar's view filter does. */
function Removable(): React.JSX.Element | null {
  const [standing, setStanding] = useState(true);
  if (!standing) return null;
  return createElement(Chip, {
    look: CHIP_LOOK.FILTER,
    removeLabel: "Show everyone's tasks",
    onRemove: () => setStanding(false),
    children: createElement(ChipName, null, "Created by me"),
  });
}

test("a removable chip is no press of its own, and its × named for what it does lifts it", () => {
  render(createElement(Removable));
  const buttons = [...document.querySelectorAll("button")];
  assert.deepEqual(
    buttons.map((each) => each.getAttribute("aria-label")),
    ["Show everyone's tasks"],
  );
  assert.ok(document.body.textContent?.includes("Created by me"));
  act(() => buttons[0]?.click());
  assert.equal(document.body.textContent, "");
});
