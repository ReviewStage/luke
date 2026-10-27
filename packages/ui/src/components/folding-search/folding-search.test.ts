// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { holdExits } from "../../testing/held-exits.js";
import { FoldingSearch } from "./folding-search.js";

/**
 * folding-search.test.ts -- a magnifier beside a name unfolds a search over
 * them both, the caret in it, and the controls after it keep their places
 * and their nodes whether it is open or folded, so a press on one that folds
 * the search still lands; the field stands open while it holds words, Escape
 * empties and folds it, handing the keyboard back to the magnifier, and it
 * is held out of reach through its exit before the name stands alone again.
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

/** A head holding the search, a name, and a button after it, writing down every press of that button. */
function Head({ pressed }: { pressed: string[] }): React.JSX.Element {
  const [query, setQuery] = useState("");
  return createElement(
    "div",
    { className: "head" },
    createElement(FoldingSearch, {
      label: "Search inbox",
      value: query,
      onChange: setQuery,
      children: createElement("span", { className: "name" }, "Inbox"),
    }),
    createElement(
      "button",
      { type: "button", onClick: () => pressed.push("New thread") },
      "New thread",
    ),
  );
}

function render(): { pressed: string[] } {
  const pressed: string[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Head, { pressed })));
  return { pressed };
}

function magnifier(): HTMLButtonElement {
  return (
    document.querySelector<HTMLButtonElement>('button[aria-label="Search inbox"]') ??
    assert.fail("the magnifier stands")
  );
}

function field(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('input[aria-label="Search inbox"]');
}

function newThread(): HTMLButtonElement {
  return (
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (each) => each.textContent === "New thread",
    ) ?? assert.fail("New thread stands")
  );
}

/** The head's buttons in order, by their names. */
function buttons(): string[] {
  return [...document.querySelectorAll<HTMLButtonElement>(".head button")].map(
    (each) => each.getAttribute("aria-label") ?? each.textContent ?? "",
  );
}

function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("the magnifier unfolds the search over the name with the caret in it, every control after it keeping its place and its node", () => {
  render();
  const before = buttons();
  const button = newThread();

  act(() => magnifier().click());

  assert.equal(document.activeElement, field(), "the caret is in the field");
  assert.deepEqual(
    buttons().slice(-2),
    before.slice(-2),
    "the magnifier and New thread stand where they stood",
  );
  assert.equal(newThread(), button, "New thread is the same node");
  assert.equal(
    magnifier().closest("[inert]") !== null,
    true,
    "the magnifier is out of reach under the field",
  );
  assert.equal(
    document.querySelector(".name")?.closest("[inert]") !== null,
    true,
    "so is the name",
  );
});

test("a press on the control beside it while the search stands empty folds the search and lands on that control", () => {
  const exits = holdExits();
  try {
    const { pressed } = render();
    act(() => magnifier().click());
    const button = newThread();

    // Note that the press moves the focus first, which folds the empty search before the click lands.
    act(() => button.focus());
    act(() => button.click());

    assert.deepEqual(pressed, ["New thread"]);
    assert.equal(newThread(), button, "the button pressed is the one still standing");
    assert.equal(
      document.querySelector(".luke-folding-search-field")?.getAttribute("data-leaving"),
      "true",
      "the field folds through its exit",
    );
    act(() => exits.finish());
    assert.equal(field(), null, "and is taken once the exit ends");
  } finally {
    exits.restore();
  }
});

test("the search stands open while it holds words, and Escape empties and folds it, handing the keyboard back to the magnifier once it has left", () => {
  const exits = holdExits();
  try {
    render();
    act(() => magnifier().click());
    const input = field() ?? assert.fail("the field stands");
    type(input, "billing");

    act(() => newThread().focus());
    assert.equal(field()?.value, "billing", "the focus leaving keeps a search holding words open");

    act(() => input.focus());
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    assert.equal(field()?.value, "", "Escape empties it");
    assert.ok(field()?.closest("[inert]"), "the leaving field is out of reach");
    assert.equal(document.activeElement, magnifier(), "the keyboard is back on the magnifier");
    assert.equal(
      document.querySelector(".name")?.closest("[inert]"),
      null,
      "the name stands again",
    );

    act(() => exits.finish());
    assert.equal(field(), null);
  } finally {
    exits.restore();
  }
});
