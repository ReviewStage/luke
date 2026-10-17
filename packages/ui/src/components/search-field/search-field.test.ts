// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { SearchField, type SearchTally } from "./search-field.js";

/**
 * search-field.test.ts -- a search draws the query its caller holds and
 * hands every change back, answers Enter, Shift-Enter, and Escape with the
 * caller's callbacks and never while an input method is composing, keeps an
 * Escape it answers from the surface behind it, says its tally while a query
 * stands, shows its chord while empty, and clears a query through its clear
 * button, handing the caret back.
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

function render(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** Types `value` into `field` as the page would hand it to React. */
function type(field: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** How a press went: whether it was kept from what stands behind the field. */
interface Pressed {
  readonly stopped: boolean;
}

/** Presses a key in `field`, answering whether the press was kept from what stands behind it. */
function press(field: HTMLElement, init: KeyboardEventInit): Pressed {
  let reached = false;
  const behind = () => {
    reached = true;
  };
  document.body.addEventListener("keydown", behind);
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
  document.body.removeEventListener("keydown", behind);
  return { stopped: !reached };
}

/** A search the caller holds, writing down every key it answered. */
function Held({
  tally,
  clears = false,
}: {
  tally?: SearchTally;
  clears?: boolean;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [heard, setHeard] = useState<string[]>([]);
  const hear = (key: string) => () => setHeard((now) => [...now, key]);
  return createElement(
    "div",
    null,
    createElement(SearchField, {
      label: "Search tools",
      placeholder: "Search",
      value: query,
      onChange: setQuery,
      shortcut: createElement("kbd", null, "⌘F"),
      onEnter: hear("enter"),
      onShiftEnter: hear("shift-enter"),
      onEscape: hear("escape"),
      ...(tally === undefined ? undefined : { tally }),
      ...(clears ? { onClear: () => setQuery("") } : undefined),
    }),
    createElement("output", null, heard.join(",")),
  );
}

function fieldOf(page: HTMLElement): HTMLInputElement {
  const field = page.querySelector<HTMLInputElement>('input[aria-label="Search tools"]');
  return field ?? assert.fail("no field named Search tools");
}

const heardOf = (page: HTMLElement) => page.querySelector("output")?.textContent;

test("typing reaches the caller, which the field then draws", () => {
  const page = render(createElement(Held));
  const field = fieldOf(page);

  type(field, "deploy");

  assert.equal(field.value, "deploy");
  assert.equal(field.placeholder, "Search");
});

test("Enter, Shift-Enter, and Escape each answer their own callback", () => {
  const page = render(createElement(Held));
  const field = fieldOf(page);

  press(field, { key: "Enter" });
  press(field, { key: "Enter", shiftKey: true });
  const escaped = press(field, { key: "Escape" });

  assert.equal(heardOf(page), "enter,shift-enter,escape");
  assert.equal(escaped.stopped, true, "an Escape the field answers stays in the field");
});

test("keys pressed while an input method composes are the input method's", () => {
  const page = render(createElement(Held));
  const field = fieldOf(page);

  press(field, { key: "Enter", isComposing: true });
  press(field, { key: "Enter", keyCode: 229 });
  press(field, { key: "Enter", shiftKey: true, isComposing: true });
  const escaped = press(field, { key: "Escape", isComposing: true });

  assert.equal(heardOf(page), "");
  assert.equal(escaped.stopped, true, "the composition's Escape never closes what is behind");
});

test("a field that answers no Escape lets it reach what stands behind", () => {
  const page = render(
    createElement(SearchField, { label: "Search tools", value: "", onChange: () => undefined }),
  );

  assert.equal(press(fieldOf(page), { key: "Escape" }).stopped, false);
});

test("the chord stands while the field is empty, and the tally while a query does", () => {
  const page = render(createElement(Held, { tally: { count: 12, at: 2 } }));
  const field = fieldOf(page);
  const tally = () => page.querySelector('[aria-live="polite"]')?.textContent;

  assert.equal(page.querySelector("kbd")?.textContent, "⌘F");
  assert.equal(tally(), undefined);

  type(field, "deploy");

  assert.equal(page.querySelector("kbd"), null);
  assert.equal(tally(), "3 of 12");
});

test("a tally says none found, how many, or which of how many", () => {
  const said = (tally: SearchTally) => {
    const page = render(
      createElement(SearchField, { label: "Find", value: "x", onChange: () => undefined, tally }),
    );
    return page.querySelector('[aria-live="polite"]')?.textContent;
  };

  assert.deepEqual(
    [
      said({ count: 0 }),
      said({ count: 4 }),
      said({ count: 500, more: true }),
      said({ count: 4, at: 0 }),
    ],
    ["No results", "4 results", "500+ results", "1 of 4"],
  );
});

test("Clear search empties the query and hands the caret back to the field", () => {
  const page = render(createElement(Held, { clears: true }));
  const field = fieldOf(page);
  const clear = () => page.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]');

  assert.equal(clear(), null, "nothing to clear while empty");
  type(field, "deploy");
  act(() => clear()?.click());

  assert.equal(field.value, "");
  assert.equal(document.activeElement, field);
  assert.equal(clear(), null);
});
