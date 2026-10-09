// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { SelectRow } from "./select-row";

const VOICES = [
  { value: "cedar", label: "Cedar" },
  { value: "marin", label: "Marin" },
  { value: "sage", label: "Sage" },
] as const;

type Voice = (typeof VOICES)[number]["value"];

const parse = (raw: string): Voice | undefined =>
  VOICES.find((voice) => voice.value === raw)?.value;

const roots: Root[] = [];
/** Every value the row asked to store, in order. */
let chosen: Voice[] = [];

beforeEach(() => {
  installScrollIntoView();
  chosen = [];
  // The chip asks the window to be key as it takes focus; nothing here reads the answer.
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: { act: () => Promise.resolve({ status: "done", value: undefined }) },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function mount(value: Voice = "cedar", within: HTMLElement = document.body): HTMLElement {
  const container = document.createElement("div");
  within.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(SelectRow<Voice>, {
        label: "Voice",
        detail: "How Luke sounds.",
        value,
        options: VOICES,
        parse,
        onChange: (next) => {
          chosen.push(next);
        },
      }),
    ),
  );
  return container;
}

const chip = (row: HTMLElement) =>
  row.querySelector<HTMLButtonElement>(".settings-picker-chip") ?? assert.fail("no chip");

function press(target: Element, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

test("the row draws its value on a chip and no native select, and a press drops the app's own menu with no search over a short set", () => {
  const row = mount();

  assert.equal(row.querySelector("select"), null);
  assert.equal(chip(row).textContent, "Cedar");
  assert.equal(chip(row).getAttribute("aria-expanded"), "false");
  assert.match(row.textContent ?? "", /How Luke sounds\./u);

  act(() => chip(row).click());
  assert.equal(chip(row).getAttribute("aria-expanded"), "true");
  assert.equal(row.querySelector('[role="listbox"] input'), null);
  assert.deepEqual(
    [...row.querySelectorAll('[role="option"]')].map((option) => option.textContent),
    ["Cedar", "Marin", "Sage"],
  );
  assert.equal(row.querySelector('[role="option"][aria-current="true"]')?.textContent, "Cedar");
});

test("a pick stores the parsed value, closes the menu, and hands the keyboard back to the chip", () => {
  const row = mount();
  act(() => chip(row).click());

  act(() => {
    [...row.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent === "Sage")
      ?.click();
  });
  assert.deepEqual(chosen, ["sage"]);
  assert.equal(row.querySelector('[role="listbox"]'), null);
  assert.equal(document.activeElement, chip(row));
});

test("Escape closes the menu, hands the keyboard back, and never reaches the window's own Escape", () => {
  const row = mount();
  const reachedWindow: string[] = [];
  const listen = (event: KeyboardEvent) => reachedWindow.push(event.key);
  window.addEventListener("keydown", listen);

  act(() => chip(row).click());
  const list = row.querySelector('[role="listbox"]') ?? assert.fail("no menu");
  press(document.activeElement ?? list, "Escape");
  assert.equal(row.querySelector('[role="listbox"]'), null);
  assert.equal(document.activeElement, chip(row));
  assert.deepEqual(reachedWindow, []);
  window.removeEventListener("keydown", listen);
});

test("the menu stands above the chip where the window leaves more room there, with its list capped to that room", () => {
  const row = mount();
  const tall = 600;
  Object.defineProperty(window, "innerHeight", { configurable: true, value: tall });
  // The chip stands near the window's foot: a list below would run off the edge.
  chip(row).getBoundingClientRect = () => new DOMRect(0, 540, 190, 28);

  act(() => chip(row).click());
  const picker = row.querySelector<HTMLElement>(".settings-picker") ?? assert.fail("no picker");
  assert.equal(picker.dataset.side, "above");
  const cap = Number.parseInt(picker.style.getPropertyValue("--settings-picker-list-max"), 10);
  assert.ok(cap > 0 && cap < 540, `the list is capped to the room above: ${cap}`);
});

test("inside a scroller the room is the scroller's, not the window's, since the scroller clips what runs past its edge", () => {
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  scroller.getBoundingClientRect = () => new DOMRect(0, 100, 600, 300);
  document.body.append(scroller);
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 2000 });
  const row = mount("cedar", scroller);
  // Plenty of window below the chip, but the scroller ends 32px under it.
  chip(row).getBoundingClientRect = () => new DOMRect(0, 340, 190, 28);

  act(() => chip(row).click());
  const picker = row.querySelector<HTMLElement>(".settings-picker") ?? assert.fail("no picker");
  assert.equal(picker.dataset.side, "above");
  const cap = Number.parseInt(picker.style.getPropertyValue("--settings-picker-list-max"), 10);
  assert.ok(cap > 0 && cap <= 240, `the list is capped to the room above in the scroller: ${cap}`);
});

test("inside Settings the menu's list is the scroller, contained, so a wheel over it never moves the page behind", () => {
  // The sheets the list's rules stand on, which jsdom does not load on its own.
  const sheet = document.createElement("style");
  sheet.textContent = ["desktop.css", "settings.css"]
    .map((name) => readFileSync(join(import.meta.dirname, "..", "styles", name), "utf8"))
    .join("\n");
  document.head.append(sheet);
  const row = mount();
  act(() => chip(row).click());

  const list = row.querySelector('[role="listbox"]') ?? assert.fail("no list");
  const style = getComputedStyle(list);
  assert.equal(style.overflowY, "auto");
  assert.equal(style.overscrollBehavior, "contain");
  document.head.innerHTML = "";
});
