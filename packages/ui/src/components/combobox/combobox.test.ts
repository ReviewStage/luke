// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { Combobox, type ComboboxOption } from "./combobox.js";

/**
 * combobox.test.ts -- the keys move the active option through the list and
 * Enter chooses it while the caret stays in the field, the active option is
 * the one a reader is told of, Escape shuts the list and is kept from what
 * stands behind it, an Enter held with Command passes the options by, and
 * keys an input method is composing with never reach the list.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

const FRUIT = ["Apple", "Apricot", "Banana", "Cherry"];

/** A field over the fruit its words start, as a caller would hold it, with what it chose and what Enter passed by. */
function Fruit({ chosen, entered }: { chosen: string[]; entered: string[] }): React.JSX.Element {
  const [value, setValue] = useState("");
  const [active, setActive] = useState(0);
  const [shut, setShut] = useState(false);
  const options: ComboboxOption[] = FRUIT.filter(
    (name) => value !== "" && name.toLowerCase().startsWith(value.toLowerCase()),
  ).map((name) => ({ id: name, label: name }));
  return createElement(Combobox, {
    label: "Fruit",
    listLabel: "Fruit",
    value,
    onChange: (typed: string) => {
      setValue(typed);
      setActive(0);
      setShut(false);
    },
    groups: [{ label: "Fruit", options }],
    open: !shut,
    active,
    onActiveChange: setActive,
    onChoose: (_index: number, option: ComboboxOption) => chosen.push(option.id),
    onEnter: () => entered.push(value),
    onEscape: () => setShut(true),
  });
}

function mount() {
  const chosen: string[] = [];
  const entered: string[] = [];
  const escapedPast: string[] = [];
  // Note that the page behind the field listens a box above React's root,
  // because a press kept from it still reaches the root's own listeners.
  const page = document.body.appendChild(document.createElement("div"));
  const container = page.appendChild(document.createElement("div"));
  page.addEventListener("keydown", (event) => {
    if (event.key === "Escape") escapedPast.push("Escape");
  });
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Fruit, { chosen, entered })));
  const field = () =>
    container.querySelector<HTMLInputElement>('[role="combobox"]') ?? assert.fail("the field");
  return { container, field, chosen, entered, escapedPast };
}

/** Types `value` into `field` as the page would hand it to React. */
function type(field: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(field: HTMLElement, init: KeyboardEventInit): void {
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
}

/** The option a reader is told is active: the one the field names, as it reads, and whether it says it is selected. */
function announced(field: HTMLInputElement) {
  const id = field.getAttribute("aria-activedescendant");
  const option = id === null ? null : document.getElementById(id);
  return option === null
    ? undefined
    : { words: option.textContent, selected: option.getAttribute("aria-selected") };
}

test("the arrows, Home and End move the active option, wrapping, and Enter chooses it", () => {
  const { field, chosen } = mount();
  type(field(), "a");

  const opened = {
    expanded: field().getAttribute("aria-expanded"),
    options: [...document.querySelectorAll('[role="listbox"] [role="option"]')].map(
      (option) => option.textContent,
    ),
  };
  press(field(), { key: "ArrowDown" });
  const second = announced(field())?.words;
  press(field(), { key: "ArrowDown" });
  const wrapped = announced(field())?.words;
  press(field(), { key: "ArrowUp" });
  const back = announced(field())?.words;
  press(field(), { key: "Home" });
  const first = announced(field())?.words;
  press(field(), { key: "End" });
  press(field(), { key: "Enter" });

  assert.deepEqual(opened, { expanded: "true", options: ["Apple", "Apricot"] });
  assert.deepEqual([second, wrapped, back, first], ["Apricot", "Apple", "Apricot", "Apple"]);
  assert.deepEqual(chosen, ["Apricot"]);
});

test("the active option is the one the field names to a reader, and the only one selected", () => {
  const { field } = mount();
  type(field(), "ap");
  press(field(), { key: "ArrowDown" });

  const selected = [...document.querySelectorAll('[aria-selected="true"]')].map(
    (option) => option.textContent,
  );

  assert.deepEqual(announced(field()), { words: "Apricot", selected: "true" });
  assert.deepEqual(selected, ["Apricot"]);
  assert.equal(
    field().getAttribute("aria-controls"),
    document.querySelector('[role="listbox"]')?.id,
  );
});

test("Escape shuts the list and is kept from what stands behind it; with the list shut it passes", () => {
  const { field, escapedPast } = mount();
  type(field(), "b");

  press(field(), { key: "Escape" });
  const shut = {
    list: document.querySelector('[role="listbox"]'),
    expanded: field().getAttribute("aria-expanded"),
    active: field().getAttribute("aria-activedescendant"),
    escapedPast: escapedPast.length,
  };
  press(field(), { key: "Escape" });

  assert.deepEqual(shut, { list: null, expanded: "false", active: null, escapedPast: 0 });
  assert.equal(escapedPast.length, 1);
});

test("an Enter held with Command, or pressed while the list is shut, chooses no option and answers onEnter", () => {
  const { field, chosen, entered } = mount();
  type(field(), "ch");
  press(field(), { key: "Enter", metaKey: true });
  type(field(), "kiwi");
  press(field(), { key: "Enter" });

  assert.deepEqual(chosen, []);
  assert.deepEqual(entered, ["ch", "kiwi"]);
});

test("keys an input method is composing with never move, choose, or shut the list", () => {
  const { field, chosen, escapedPast } = mount();
  type(field(), "a");

  press(field(), { key: "ArrowDown", isComposing: true });
  press(field(), { key: "Enter", keyCode: 229 });
  press(field(), { key: "Escape", isComposing: true });

  assert.equal(announced(field())?.words, "Apple");
  assert.deepEqual(chosen, []);
  assert.notEqual(document.querySelector('[role="listbox"]'), null);
  assert.equal(escapedPast.length, 0, "the candidates' Escape is kept from the page");
});

test("a press on an option chooses it and keeps the caret in the field; the pointer makes an option active", () => {
  const { field, chosen } = mount();
  type(field(), "a");
  const apricot =
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (option) => option.textContent === "Apricot",
    ) ?? assert.fail("Apricot");

  act(() => {
    apricot.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  });
  const hovered = announced(field())?.words;
  const mousedown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => {
    apricot.dispatchEvent(mousedown);
    apricot.click();
  });

  assert.equal(hovered, "Apricot");
  assert.equal(mousedown.defaultPrevented, true);
  assert.deepEqual(chosen, ["Apricot"]);
});

test("an Escape an input method is composing with is kept from what stands behind even with the list shut", () => {
  const { field, escapedPast } = mount();
  type(field(), "kiwi");

  press(field(), { key: "Escape", keyCode: 229 });

  assert.equal(field().getAttribute("aria-expanded"), "false");
  assert.equal(escapedPast.length, 0);
});
