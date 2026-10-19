// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { TAB_COUNT_TONE, TabCount, Tabs } from "./tabs.js";

/**
 * tabs.test.ts -- a row of tabs is a tablist: the selected tab is the one
 * Tab lands on and the one its panel is shown for, a press or an arrow
 * shows another and takes the keyboard there, wrapping at either end, and
 * Home and End go to the ends; ↑ and ↓, and a key held with a modifier, are
 * not the row's. A count's glyph says its state in words.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const VIEWS = ["Conversation", "Checks", "Files"] as const;
type View = (typeof VIEWS)[number];

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

/** A row the caller holds, over a panel for each view, the selected one shown. */
function PullRequestViews(): React.JSX.Element {
  const [view, setView] = useState<View>("Checks");
  const ids = (each: View) => ({ tab: `${each}-tab`, panel: `${each}-panel` });
  return createElement(
    "div",
    null,
    createElement(Tabs<View>, {
      label: "Pull request",
      tabs: VIEWS.map((value) => ({
        value,
        label: value,
        count:
          value === "Checks"
            ? createElement(
                TabCount,
                { tone: TAB_COUNT_TONE.DANGER, glyph: "×", glyphLabel: "failing" },
                "1",
              )
            : undefined,
      })),
      value: view,
      onChange: setView,
      ids,
    }),
    ...VIEWS.map((each) =>
      createElement(
        "div",
        {
          key: each,
          role: "tabpanel",
          id: ids(each).panel,
          "aria-labelledby": ids(each).tab,
          hidden: each !== view,
        },
        `${each} view`,
      ),
    ),
  );
}

function tabs(page: HTMLElement): HTMLButtonElement[] {
  return [...page.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
}

/** What a reader meets of the row: the tab selected, the one Tab lands on, the one focused, and the panel shown. */
interface Reading {
  readonly selected: string[];
  readonly tabStop: string[];
  readonly focused: string | undefined;
  readonly shown: string[];
}

/** The view a tab is named for, read off its words. */
function nameOf(tab: Element | null): string | undefined {
  return VIEWS.find((view) => tab?.textContent?.startsWith(view) === true);
}

function reading(page: HTMLElement): Reading {
  return {
    selected: tabs(page)
      .filter((tab) => tab.getAttribute("aria-selected") === "true")
      .map((tab) => nameOf(tab) ?? ""),
    tabStop: tabs(page)
      .filter((tab) => tab.tabIndex === 0)
      .map((tab) => nameOf(tab) ?? ""),
    focused: nameOf(tabs(page).find((tab) => tab === document.activeElement) ?? null),
    shown: [...page.querySelectorAll<HTMLElement>('[role="tabpanel"]')]
      .filter((panel) => !panel.hidden)
      .map((panel) => panel.textContent ?? ""),
  };
}

function pressKey(page: HTMLElement, key: string, held: KeyboardEventInit = {}): void {
  const focused = document.activeElement ?? page;
  act(() => {
    focused.dispatchEvent(new KeyboardEvent("keydown", { ...held, key, bubbles: true }));
  });
}

test("a tablist named by its label, Tab landing on the selected tab, whose panel alone is shown", () => {
  const page = render(createElement(PullRequestViews));
  assert.equal(page.querySelector('[role="tablist"]')?.getAttribute("aria-label"), "Pull request");
  assert.deepEqual(reading(page), {
    selected: ["Checks"],
    tabStop: ["Checks"],
    focused: undefined,
    shown: ["Checks view"],
  });
  const checks = tabs(page)[1];
  assert.equal(
    document.getElementById(checks?.getAttribute("aria-controls") ?? "")?.textContent,
    "Checks view",
    "the tab controls its own panel",
  );
});

test("a press shows that tab's view", () => {
  const page = render(createElement(PullRequestViews));
  act(() => tabs(page)[2]?.click());
  assert.deepEqual(reading(page).selected, ["Files"]);
  assert.deepEqual(reading(page).shown, ["Files view"]);
});

test("the arrows show the next view along and take the keyboard there, wrapping at either end", () => {
  const page = render(createElement(PullRequestViews));
  act(() => tabs(page)[1]?.focus());
  pressKey(page, "ArrowRight");
  assert.deepEqual(reading(page), {
    selected: ["Files"],
    tabStop: ["Files"],
    focused: "Files",
    shown: ["Files view"],
  });
  pressKey(page, "ArrowRight");
  assert.deepEqual(reading(page).selected, ["Conversation"]);
  assert.equal(reading(page).focused, "Conversation");
  pressKey(page, "ArrowLeft");
  assert.deepEqual(reading(page).selected, ["Files"]);
  assert.equal(reading(page).focused, "Files");
});

test("Home and End go to either end of the row", () => {
  const page = render(createElement(PullRequestViews));
  act(() => tabs(page)[1]?.focus());
  pressKey(page, "Home");
  assert.deepEqual(reading(page).selected, ["Conversation"]);
  assert.equal(reading(page).focused, "Conversation");
  pressKey(page, "End");
  assert.deepEqual(reading(page).selected, ["Files"]);
  assert.equal(reading(page).focused, "Files");
});

test("↑ and ↓, and a key held with a modifier, leave the row as it is", () => {
  const page = render(createElement(PullRequestViews));
  act(() => tabs(page)[1]?.focus());
  pressKey(page, "ArrowDown");
  pressKey(page, "ArrowUp");
  for (const held of [{ metaKey: true }, { altKey: true }, { ctrlKey: true }, { shiftKey: true }]) {
    pressKey(page, "ArrowRight", held);
    pressKey(page, "Home", held);
  }
  assert.deepEqual(reading(page), {
    selected: ["Checks"],
    tabStop: ["Checks"],
    focused: "Checks",
    shown: ["Checks view"],
  });
});

test("a count's glyph says its state in words beside the count", () => {
  const page = render(createElement(PullRequestViews));
  const checks = tabs(page)[1];
  assert.equal(checks?.querySelector('[role="img"]')?.getAttribute("aria-label"), "failing");
  assert.equal(checks?.textContent, "Checks×1");
});
