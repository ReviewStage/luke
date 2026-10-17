// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { Select, type SelectOption } from "./select.js";

/**
 * select.test.ts -- a select is a pop-up button: its field names the chosen
 * value, its menu opens on that value, the arrows pass over a value that
 * cannot be chosen now, a choice changes the value and hands focus back to
 * the field, and Escape, Tab, or a press elsewhere closes it choosing
 * nothing. Where the menu hangs is layout, which jsdom does not do.
 */

const THEMES = ["System", "Light", "Dark", "Sepia"] as const;
type Theme = (typeof THEMES)[number];
const OPTIONS: readonly SelectOption<Theme>[] = THEMES.map((value) => ({
  value,
  label: value,
  disabled: value === "Dark",
}));

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** A theme the caller holds, every change it is handed in order. */
function ThemeSelect({
  changes,
  options = OPTIONS,
  disabled = false,
}: {
  changes: Theme[];
  options?: readonly SelectOption<Theme>[];
  disabled?: boolean;
}): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>("Light");
  return createElement(Select<Theme>, {
    label: "Theme",
    options,
    value: theme,
    disabled,
    onChange: (next) => {
      changes.push(next);
      setTheme(next);
    },
  });
}

function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** The field, by the name a reader hears: the select's label and its value. */
function field(name: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  assert.ok(button, `the field "${name}" is drawn`);
  return button;
}

/** The menu standing open, if one is: drawn and not on its way out. */
function openMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"]:not([data-leaving])');
}

/** The menu's item for `label`. */
function item(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find(
    (each) => each.textContent === label,
  );
  assert.ok(found, `the menu offers ${label}`);
  return found;
}

function press(element: HTMLElement): void {
  act(() => element.click());
}

function key(name: string): void {
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });
}

test("the field names the chosen value and opens on it, the arrows pass over a dimmed value, and a choice changes the value and hands focus back", () => {
  const changes: Theme[] = [];
  mount(createElement(ThemeSelect, { changes }));
  press(field("Theme: Light"));
  assert.equal(field("Theme: Light").getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement, item("Light"), "the menu opens on the chosen value");
  assert.equal(item("Light").getAttribute("aria-checked"), "true");
  key("ArrowDown");
  assert.equal(document.activeElement, item("Sepia"), "the arrow passes over the dimmed Dark");
  press(item("Sepia"));
  assert.deepEqual(changes, ["Sepia"]);
  assert.equal(openMenu(), null);
  assert.equal(document.activeElement, field("Theme: Sepia"));
  assert.equal(field("Theme: Sepia").getAttribute("aria-expanded"), "false");
});

test("choosing the value the field already holds changes nothing", () => {
  const changes: Theme[] = [];
  mount(createElement(ThemeSelect, { changes }));
  press(field("Theme: Light"));
  press(item("Light"));
  assert.deepEqual(changes, []);
  assert.equal(openMenu(), null);
  assert.equal(document.activeElement, field("Theme: Light"));
});

test("Escape and Tab each close the menu choosing nothing, with focus back on the field", () => {
  const changes: Theme[] = [];
  mount(createElement(ThemeSelect, { changes }));
  for (const name of ["Escape", "Tab"]) {
    press(field("Theme: Light"));
    key("ArrowDown");
    key(name);
    assert.equal(openMenu(), null, `${name} closes the menu`);
    assert.equal(document.activeElement, field("Theme: Light"));
  }
  assert.deepEqual(changes, []);
});

test("a press elsewhere closes the menu choosing nothing", () => {
  const changes: Theme[] = [];
  mount(createElement(ThemeSelect, { changes }));
  press(field("Theme: Light"));
  act(() => {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  assert.equal(openMenu(), null);
  assert.deepEqual(changes, []);
});

test("a dimmed value takes no press", () => {
  const changes: Theme[] = [];
  mount(createElement(ThemeSelect, { changes }));
  press(field("Theme: Light"));
  assert.equal(item("Dark").disabled, true);
  press(item("Dark"));
  assert.deepEqual(changes, []);
  assert.notEqual(openMenu(), null);
});

test("a field that cannot be used, or has no value that can be chosen now, opens no menu", () => {
  const dimmed = OPTIONS.map((option) => ({ ...option, disabled: true }));
  for (const props of [{ disabled: true }, { options: dimmed }, { options: [] }]) {
    mount(createElement(ThemeSelect, { changes: [], ...props }));
    const button = field("Theme: Light");
    assert.equal(button.disabled, true);
    press(button);
    assert.equal(openMenu(), null);
    act(() => roots.pop()?.unmount());
    document.body.innerHTML = "";
  }
});
