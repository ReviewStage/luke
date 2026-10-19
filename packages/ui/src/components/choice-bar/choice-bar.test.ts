// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { COUNT_TONE, linesCount } from "../choice/count-part.js";
import {
  CHOICE_BAR_FOCUS,
  CHOICE_BAR_LOOK,
  ChoiceBar,
  type ChoiceBarFocus,
  type ChoiceBarLook,
  type ChoiceItem,
} from "./choice-bar.js";

/**
 * choice-bar.test.ts -- a bar handed panels is a tablist whose tabs control
 * them, and one without is a radio group, in either look; a clearable bar's
 * chosen option pressed again takes the choice back, and a fixed one's
 * stands; a bar that takes no focus leaves no option for Tab to land on and
 * keeps the keyboard where it was when pressed; the arrows, Home, and End
 * choose as they move and take the keyboard along, ↑ and ↓ only in a radio
 * group, and neither with a modifier held nor in a disabled bar; a disabled
 * option is not chosen; a count's glyph says its state in words; and the
 * app's `data-` attributes reach the bar.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const VIEW = {
  CONVERSATION: "conversation",
  CHECKS: "checks",
  FILES: "files",
} as const;
type View = (typeof VIEW)[keyof typeof VIEW];

const ITEMS: readonly ChoiceItem<View>[] = [
  { value: VIEW.CONVERSATION, label: "Conversation", count: "12" },
  { value: VIEW.CHECKS, label: "Checks", disabled: true },
  { value: VIEW.FILES, label: "Files", count: linesCount(214, 38) },
];

/** The same views, every one of them open to the keyboard, the checks failing. */
const OPEN_ITEMS: readonly ChoiceItem<View>[] = [
  { value: VIEW.CONVERSATION, label: "Conversation" },
  {
    value: VIEW.CHECKS,
    label: "Checks",
    count: [{ text: "1", tone: COUNT_TONE.DANGER, glyph: "×", glyphLabel: "failing" }],
  },
  { value: VIEW.FILES, label: "Files" },
];

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

/** A bar the caller holds, over a panel for each view where it shows panels. */
function Held({
  items = ITEMS,
  look = CHOICE_BAR_LOOK.FILL,
  withPanels = false,
  clearable = false,
  disabled = false,
  focus,
  start = VIEW.CONVERSATION,
}: {
  items?: readonly ChoiceItem<View>[];
  look?: ChoiceBarLook;
  withPanels?: boolean;
  clearable?: boolean;
  disabled?: boolean;
  focus?: ChoiceBarFocus;
  start?: View | undefined;
}): React.JSX.Element {
  const [view, setView] = useState<View | undefined>(start);
  const panels = (each: View) => ({ tab: `${each}-tab`, panel: `${each}-panel` });
  return createElement(
    "div",
    null,
    createElement(ChoiceBar<View>, {
      label: "Pull request",
      items,
      value: view,
      onChange: setView,
      look,
      clearable,
      disabled,
      focus,
      panels: withPanels ? panels : undefined,
      "data-settings-anchor": "pull-request-views",
    }),
    withPanels
      ? Object.values(VIEW).map((each) =>
          createElement(
            "div",
            {
              key: each,
              role: "tabpanel",
              id: panels(each).panel,
              "aria-labelledby": panels(each).tab,
              hidden: each !== view,
            },
            `${each} view`,
          ),
        )
      : null,
  );
}

function options(page: HTMLElement): HTMLButtonElement[] {
  return [...page.querySelectorAll<HTMLButtonElement>('[role="tab"], [role="radio"]')];
}

function option(page: HTMLElement, name: string): HTMLButtonElement {
  const found = options(page).find((each) => each.textContent?.startsWith(name) === true);
  assert.ok(found, `the bar offers ${name}`);
  return found;
}

/** The options a reader hears as chosen, and the ones Tab lands on. */
interface Reading {
  readonly chosen: string[];
  readonly tabStops: string[];
}

/** The name of the option the keyboard is on, if any. */
function focused(): string | undefined {
  return document.activeElement?.querySelector(".luke-choice-bar-label")?.textContent ?? undefined;
}

function pressKey(key: string, held: KeyboardEventInit = {}): void {
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { ...held, key, bubbles: true }),
    );
  });
}

function reading(page: HTMLElement): Reading {
  const name = (each: HTMLElement) =>
    each.querySelector(".luke-choice-bar-label")?.textContent ?? "";
  return {
    chosen: options(page)
      .filter(
        (each) =>
          (each.getAttribute("aria-selected") ?? each.getAttribute("aria-checked")) === "true",
      )
      .map(name),
    tabStops: options(page)
      .filter((each) => each.tabIndex === 0)
      .map(name),
  };
}

test("a bar handed panels is a tablist whose tabs control them, in either look", () => {
  for (const look of Object.values(CHOICE_BAR_LOOK)) {
    const page = render(createElement(Held, { look, withPanels: true }));
    const list = page.querySelector('[role="tablist"]');
    assert.equal(list?.getAttribute("aria-label"), "Pull request", look);
    assert.equal(page.querySelector('[role="radiogroup"]'), null, look);
    const files = option(page, "Files");
    assert.equal(
      document.getElementById(files.getAttribute("aria-controls") ?? "")?.textContent,
      "files view",
      `${look}: the tab controls its own panel`,
    );
    act(() => files.click());
    assert.deepEqual(reading(page), { chosen: ["Files"], tabStops: ["Files"] }, look);
  }
});

test("a bar without panels is a radio group of radios, in either look", () => {
  for (const look of Object.values(CHOICE_BAR_LOOK)) {
    const page = render(createElement(Held, { look }));
    assert.equal(
      page.querySelector('[role="radiogroup"]')?.getAttribute("aria-label"),
      "Pull request",
    );
    assert.equal(page.querySelector('[role="tablist"]'), null, look);
    assert.ok(
      options(page).every((each) => each.getAttribute("role") === "radio"),
      look,
    );
    assert.ok(
      options(page).every((each) => !each.hasAttribute("aria-controls")),
      look,
    );
    assert.deepEqual(reading(page), { chosen: ["Conversation"], tabStops: ["Conversation"] }, look);
  }
});

test("a clearable bar's chosen option pressed again takes the choice back, and a fixed bar's stands", () => {
  const fixed = render(createElement(Held));
  act(() => option(fixed, "Conversation").click());
  assert.deepEqual(reading(fixed).chosen, ["Conversation"]);
  const clearable = render(createElement(Held, { clearable: true }));
  act(() => option(clearable, "Conversation").click());
  assert.deepEqual(reading(clearable), { chosen: [], tabStops: ["Conversation"] });
  act(() => option(clearable, "Files").click());
  assert.deepEqual(reading(clearable).chosen, ["Files"]);
});

test("a bar that takes no focus leaves no option for Tab, keeps the keyboard where it was, and still chooses", () => {
  const page = render(createElement(Held, { focus: CHOICE_BAR_FOCUS.NONE }));
  assert.deepEqual(reading(page).tabStops, []);
  const field = document.body.appendChild(document.createElement("input"));
  act(() => field.focus());
  const files = option(page, "Files");
  const pressed = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => {
    files.dispatchEvent(pressed);
    files.click();
  });
  assert.ok(pressed.defaultPrevented, "the press does not take the keyboard");
  assert.equal(document.activeElement, field);
  assert.deepEqual(reading(page).chosen, ["Files"]);
});

test("the arrows step past a disabled option, and a press on one chooses nothing", () => {
  const page = render(createElement(Held));
  act(() => option(page, "Checks").click());
  assert.deepEqual(reading(page).chosen, ["Conversation"]);
  act(() => option(page, "Conversation").focus());
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
  assert.deepEqual(reading(page).chosen, ["Files"]);
  assert.equal(document.activeElement, option(page, "Files"));
});

test("the app's data- attributes reach the bar", () => {
  const page = render(createElement(Held));
  assert.equal(
    page.querySelector('[data-settings-anchor="pull-request-views"]')?.getAttribute("role"),
    "radiogroup",
  );
});

test("the arrows choose as they move and take the keyboard along, wrapping, and Home and End go to either end, in a tablist and a radio group", () => {
  for (const withPanels of [true, false]) {
    const page = render(createElement(Held, { items: OPEN_ITEMS, withPanels, start: VIEW.CHECKS }));
    act(() => option(page, "Checks").focus());
    pressKey("ArrowRight");
    assert.deepEqual(reading(page), { chosen: ["Files"], tabStops: ["Files"] });
    assert.equal(focused(), "Files");
    pressKey("ArrowRight");
    assert.deepEqual(reading(page).chosen, ["Conversation"], "wraps past the last");
    pressKey("ArrowLeft");
    assert.deepEqual(reading(page).chosen, ["Files"], "wraps past the first");
    pressKey("Home");
    assert.deepEqual(reading(page).chosen, ["Conversation"]);
    assert.equal(focused(), "Conversation");
    pressKey("End");
    assert.deepEqual(reading(page).chosen, ["Files"]);
    assert.equal(focused(), "Files");
  }
});

test("↑ and ↓ step a radio group and leave a tablist alone, and a key held with a modifier moves neither", () => {
  const tabs = render(
    createElement(Held, { items: OPEN_ITEMS, withPanels: true, start: VIEW.CHECKS }),
  );
  act(() => option(tabs, "Checks").focus());
  pressKey("ArrowDown");
  pressKey("ArrowUp");
  assert.deepEqual(reading(tabs).chosen, ["Checks"]);
  const radios = render(createElement(Held, { items: OPEN_ITEMS, start: VIEW.CHECKS }));
  act(() => option(radios, "Checks").focus());
  pressKey("ArrowDown");
  assert.deepEqual(reading(radios).chosen, ["Files"]);
  pressKey("ArrowUp");
  pressKey("ArrowUp");
  assert.deepEqual(reading(radios).chosen, ["Conversation"]);
  assert.equal(focused(), "Conversation");
  for (const held of [{ metaKey: true }, { altKey: true }, { ctrlKey: true }, { shiftKey: true }]) {
    pressKey("ArrowRight", held);
    pressKey("End", held);
  }
  assert.deepEqual(reading(radios).chosen, ["Conversation"]);
  assert.equal(focused(), "Conversation");
});

test("a disabled bar takes no key", () => {
  const page = render(createElement(Held, { items: OPEN_ITEMS, disabled: true }));
  for (const key of ["ArrowRight", "End"]) {
    act(() => {
      option(page, "Conversation").dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
    });
  }
  assert.deepEqual(reading(page).chosen, ["Conversation"]);
});

test("the arrows from an option a clearable press left unchosen step from that option", () => {
  const page = render(createElement(Held, { items: OPEN_ITEMS, clearable: true }));
  act(() => {
    option(page, "Checks").focus();
    option(page, "Checks").click();
  });
  act(() => option(page, "Checks").click());
  assert.deepEqual(reading(page).chosen, []);
  pressKey("ArrowRight");
  assert.deepEqual(reading(page).chosen, ["Files"]);
});

test("a count's glyph says its state in words beside the count", () => {
  const page = render(createElement(Held, { items: OPEN_ITEMS, withPanels: true }));
  const checks = option(page, "Checks");
  assert.equal(checks.querySelector('[role="img"]')?.getAttribute("aria-label"), "failing");
  assert.equal(checks.textContent, "Checks×1");
});
