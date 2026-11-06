// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { CHIP_CUT, CHIP_LOOK, CHIP_SIZE, Chip, ChipName } from "../../index.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FILTERS = ["All", "Tasks", "Files"] as const;

const roots: Root[] = [];

class StandInResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StandInResizeObserver);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function render(element: ReactElement): void {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
}

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

function pressed(): string[] {
  return [...document.querySelectorAll("button")]
    .filter((each) => each.getAttribute("aria-pressed") === "true")
    .map((each) => each.textContent ?? "");
}

test("a row of filter chips announces the first as pressed and the rest as not", () => {
  render(createElement(Filters));
  assert.equal(chip("Tasks").getAttribute("aria-pressed"), "false");
  assert.deepEqual(pressed(), ["All"]);
});

test("pressing a filter chip makes it the one pressed", () => {
  render(createElement(Filters));
  act(() => chip("Files").click());
  assert.deepEqual(pressed(), ["Files"]);
  act(() => chip("Tasks").click());
  assert.deepEqual(pressed(), ["Tasks"]);
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

function Reaction(): React.JSX.Element {
  const [mine, setMine] = useState(false);
  const [out, setOut] = useState(false);
  return createElement(
    "div",
    null,
    createElement(
      Chip,
      {
        look: CHIP_LOOK.FILTER,
        size: CHIP_SIZE.COMPACT,
        "aria-pressed": mine,
        busy: out,
        disabled: out,
        onClick: () => {
          setMine(!mine);
          setOut(true);
        },
      },
      mine ? "👍2" : "👍1",
    ),
    createElement("button", { type: "button", onClick: () => setOut(false) }, "Answer"),
  );
}

test("a compact chip pressed says it is busy until its change is answered, then stands pressed", () => {
  render(createElement(Reaction));
  const reaction = chip("👍1");
  assert.equal(reaction.getAttribute("aria-busy"), null);
  act(() => reaction.click());
  assert.equal(reaction.getAttribute("aria-busy"), "true");
  assert.equal(reaction.disabled, true);
  act(() => chip("Answer").click());
  assert.equal(reaction.getAttribute("aria-busy"), null);
  assert.deepEqual(pressed(), ["👍2"]);
});

test("a long name cut in its middle keeps its words whole and its end, after a join, apart; a short one is not cut in two", () => {
  render(
    createElement(
      "div",
      null,
      createElement(ChipName, {
        mono: true,
        cut: CHIP_CUT.MIDDLE,
        children: "agent/pull-request-header-menu-and-pill",
      }),
      createElement(ChipName, { mono: true, cut: CHIP_CUT.MIDDLE, children: "main" }),
    ),
  );
  const [long, short] = [...document.querySelectorAll(".ui-chip-name")];
  assert.equal(long?.textContent, "agent/pull-request-header-menu-and-pill");
  assert.equal(long?.querySelector(".ui-chip-name-end")?.textContent, "and-pill");
  assert.equal(short?.textContent, "main");
  assert.equal(short?.querySelector(".ui-chip-name-end"), null);
});

test("a chip given an address is a link named by its words, going there, and its press is heard before the page is followed", () => {
  const presses: boolean[] = [];
  render(
    createElement(
      Chip,
      {
        look: CHIP_LOOK.PILL,
        href: "https://github.com/acme/web/issues/312",
        onClick: (event) => {
          event.preventDefault();
          presses.push(event.defaultPrevented);
        },
      },
      createElement(ChipName, { mono: true, children: "#312" }),
    ),
  );

  const link = document.querySelector("a");
  assert.equal(link?.textContent, "#312");
  assert.equal(link?.getAttribute("href"), "https://github.com/acme/web/issues/312");
  assert.equal(document.querySelector("button"), null);
  act(() => link?.click());
  assert.deepEqual(presses, [true]);
});
