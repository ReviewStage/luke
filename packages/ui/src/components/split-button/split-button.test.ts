// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { Menu, useMenu } from "../menu/menu.js";
import { SplitButton } from "./split-button.js";

/**
 * split-button.test.ts -- a split button's main part does its act and its
 * chevron opens the options' menu, focus on its first item; the keys walk
 * the menu, a choice acts and closes it, and Escape closes it with focus back
 * on the chevron. Unavailable, both halves refuse their press yet stay Tab
 * stops; busy, the main part is named by what it is doing and refuses its
 * press while the chevron still opens the menu.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** What a test's split button was asked to do, in the order it was asked. */
type Done = string[];

/** A Save split button whose chevron drops Save as draft and Save and close. */
function Harness({
  done,
  disabled,
  busy,
}: {
  done: Done;
  disabled?: boolean;
  busy?: string;
}): React.JSX.Element {
  const menu = useMenu(true);
  return createElement(
    "div",
    null,
    createElement(SplitButton, {
      label: "Save the plan",
      disabled,
      busy,
      onClick: () => done.push("Save"),
      menu: { label: "More ways to save", ...menu.trigger() },
      children: "Save",
    }),
    menu.drawn === undefined
      ? null
      : createElement(Menu, {
          label: "More ways to save",
          menu: menu.drawn,
          groups: [
            [
              { label: "Save as draft", onSelect: () => done.push("Save as draft") },
              { label: "Save and close", onSelect: () => done.push("Save and close") },
            ],
          ],
          onClose: menu.close,
        }),
  );
}

function mount(element: React.ReactElement): void {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
}

/** The button whose name is `name`. */
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => (each.getAttribute("aria-label") ?? each.textContent) === name,
  );
  if (found === undefined) throw new Error(`no button named ${name}`);
  return found;
}

function openMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[role="menu"][aria-label="More ways to save"]:not([data-leaving])',
  );
}

function focused(): string | null | undefined {
  return document.activeElement?.textContent;
}

function key(name: string): void {
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });
}

function press(element: HTMLElement): void {
  act(() => element.click());
}

test("the main part, named by its label and showing its words, does its act and opens nothing", () => {
  const done: Done = [];
  mount(createElement(Harness, { done }));
  const save = button("Save the plan");
  expect(save.textContent).toBe("Save");

  press(save);

  expect(done).toEqual(["Save"]);
  expect(openMenu()).toBeNull();
});

test("the chevron opens the menu on its first item, and a second press closes it", () => {
  mount(createElement(Harness, { done: [] }));
  const chevron = button("More ways to save");
  expect(chevron.getAttribute("aria-haspopup")).toBe("menu");
  expect(chevron.getAttribute("aria-expanded")).toBe("false");

  press(chevron);
  expect(openMenu()).not.toBeNull();
  expect(chevron.getAttribute("aria-expanded")).toBe("true");
  expect(focused()).toBe("Save as draft");

  press(chevron);
  expect(openMenu()).toBeNull();
});

test("the keys walk the menu, a choice acts and closes it, and Escape closes it with focus back on the chevron", () => {
  const done: Done = [];
  mount(createElement(Harness, { done }));
  const chevron = button("More ways to save");

  press(chevron);
  key("ArrowDown");
  expect(focused()).toBe("Save and close");
  const item = document.activeElement;
  if (!(item instanceof HTMLElement)) throw new Error("nothing has focus");
  press(item);
  expect(done).toEqual(["Save and close"]);
  expect(openMenu()).toBeNull();
  expect(document.activeElement).toBe(chevron);

  press(chevron);
  key("Escape");
  expect(openMenu()).toBeNull();
  expect(document.activeElement).toBe(chevron);
  expect(done).toEqual(["Save and close"]);
});

test("unavailable, both halves refuse their press and stay Tab stops", () => {
  const done: Done = [];
  mount(createElement(Harness, { done, disabled: true }));
  const save = button("Save the plan");
  const chevron = button("More ways to save");

  press(save);
  press(chevron);

  expect(done).toEqual([]);
  expect(openMenu()).toBeNull();
  expect(
    [save, chevron].map((each) => [each.getAttribute("aria-disabled"), each.tabIndex]),
  ).toEqual([
    ["true", 0],
    ["true", 0],
  ]);
});

test("busy, the main part is named by what it is doing and refuses its press, while the chevron still opens the menu", () => {
  const done: Done = [];
  mount(createElement(Harness, { done, busy: "Saving" }));
  const saving = button("Saving");

  press(saving);
  press(button("More ways to save"));

  expect(saving.getAttribute("aria-busy")).toBe("true");
  expect(done).toEqual([]);
  expect(openMenu()).not.toBeNull();
});
