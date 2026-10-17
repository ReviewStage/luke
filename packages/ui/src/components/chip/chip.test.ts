// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { CHIP_LOOK, Chip } from "./chip.js";

/**
 * chip.test.ts -- a row of filter chips announces the one pressed, and a
 * press moves it there.
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
