// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { CHIP_CUT, CHIP_LOOK, CHIP_SIZE, Chip, ChipName } from "../../index.js";
import { holdExits } from "../../testing/held-exits.js";

/**
 * chip.test.ts -- a row of filter chips announces the one pressed, and a
 * press moves it there; a chip drawn as its mark alone keeps its words as
 * its name; a removable chip's × alone is a press, which lifts it once the
 * chip has scaled out, and a lift its caller refuses leaves it standing; and a
 * compact count says it is busy while the change it made is out. A chip's
 * words fade out at their end only while the chip cuts them short, and a
 * long name cut in its middle keeps its end.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FILTERS = ["All", "Plans", "Files"] as const;

const roots: Root[] = [];

/** The measurement each observed box was handed, fired as a resize; jsdom lays nothing out, so nothing reports one of its own accord. */
const resizes: (() => void)[] = [];

class StandInResizeObserver {
  readonly #fire: () => void;
  constructor(fire: () => void) {
    this.#fire = fire;
  }
  observe(): void {
    resizes.push(this.#fire);
  }
  disconnect(): void {}
}

/** Stands every box's words `wide` pixels in a box 100px wide, and fires every observed box's measurement, as a resize would. */
function resize(wide: number): void {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(wide);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
  act(() => {
    for (const fire of resizes) fire();
  });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StandInResizeObserver);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  resizes.splice(0);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

test("a removable chip pressed off stays drawn, leaving and inert, until its exit is done, then is lifted", () => {
  const exits = holdExits();
  try {
    render(createElement(Removable));
    const chipBox = () => document.querySelector(".luke-chip");
    act(() => document.querySelector("button")?.click());
    assert.equal(chipBox()?.getAttribute("data-leaving"), "true");
    assert.equal(chipBox()?.hasAttribute("inert"), true);
    assert.ok(document.body.textContent?.includes("Created by me"), "drawn through its exit");
    act(() => exits.finish());
    assert.equal(document.body.textContent, "");
  } finally {
    exits.restore();
  }
});

test("a removable chip whose caller keeps it after its exit stands again", () => {
  const exits = holdExits();
  const asked: string[] = [];
  try {
    render(
      createElement(Chip, {
        look: CHIP_LOOK.FILTER,
        removeLabel: "Show everyone's tasks",
        onRemove: () => asked.push("lift"),
        children: "Created by me",
      }),
    );
    act(() => document.querySelector("button")?.click());
    assert.deepEqual(asked, []);
    act(() => exits.finish());
    assert.deepEqual(asked, ["lift"]);
    const chipBox = document.querySelector(".luke-chip");
    assert.equal(chipBox?.getAttribute("data-leaving"), null);
    assert.equal(chipBox?.hasAttribute("inert"), false);
  } finally {
    exits.restore();
  }
});

/** A reaction's count as a compact filter whose press gives the reader's own and waits until it is answered. */
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

test("a chip's words fade out at their end only while the chip cuts them short", () => {
  render(
    createElement(Chip, { look: CHIP_LOOK.PILL }, createElement(ChipName, null, "feature/expiry")),
  );
  const name = () => document.querySelector(".luke-chip-name");
  resize(80);
  assert.equal(name()?.getAttribute("data-overflow"), "false");
  resize(160);
  assert.equal(name()?.getAttribute("data-overflow"), "true");
});

test("a long name cut in its middle keeps its words whole and its end, after a join, apart; a short one is not cut in two", () => {
  render(
    createElement(
      "div",
      null,
      createElement(ChipName, {
        mono: true,
        cut: CHIP_CUT.MIDDLE,
        children: "luke/pull-request-header-menu-and-pill",
      }),
      createElement(ChipName, { mono: true, cut: CHIP_CUT.MIDDLE, children: "main" }),
    ),
  );
  const [long, short] = [...document.querySelectorAll(".luke-chip-name")];
  assert.equal(long?.textContent, "luke/pull-request-header-menu-and-pill");
  assert.equal(long?.querySelector(".luke-chip-name-end")?.textContent, "and-pill");
  assert.equal(short?.textContent, "main");
  assert.equal(short?.querySelector(".luke-chip-name-end"), null);
});
