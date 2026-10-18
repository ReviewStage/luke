// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { type FootRow, type MenuRow, SearchableMenu } from "./searchable-menu";

/**
 * searchable-menu.test.ts -- the keys a picker menu reads from its field:
 * the arrows pass over a row that cannot be picked and go on into the
 * pinned rows, the field names the highlighted row to a reader, Right and
 * Left open and close a pinned row's submenu, Escape closes the submenu
 * before the menu and never reaches what stands behind it, Enter picks with
 * or without Command, keys an input method is composing with pick and move
 * nothing, and a list too short to search reads the same keys itself.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Note that jsdom lays nothing out and so scrolls nothing, and has no
// `scrollIntoView` for the menu to bring its highlight into view with.
Element.prototype.scrollIntoView ??= () => undefined;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

const ROWS: readonly MenuRow[] = [
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet", disabled: "Not on this plan" },
  { id: "haiku", label: "Haiku" },
];

/** What the menu was asked to do, in order. */
interface Asked {
  readonly said: string[];
  readonly escapedPast: string[];
}

/** A pinned effort row with its submenu, and a press of its own. */
function footOf(said: string[]): FootRow[] {
  return [
    {
      id: "effort",
      label: "Effort",
      submenu: {
        label: "Effort",
        rows: [
          { id: "low", label: "Low" },
          { id: "high", label: "High" },
        ],
        value: "high",
        onPick: (id) => said.push(`effort ${id}`),
      },
    },
    { id: "github", label: "Open on GitHub", onPress: () => said.push("github") },
  ];
}

/** The menu drawn over `rows`, with a field where `placeholder` is given, in a page that hears what Escape reaches. */
function mount(options: { placeholder?: string; foot?: boolean } = {}) {
  const asked: Asked = { said: [], escapedPast: [] };
  // Note that the page listens a box above React's root, because a press
  // kept from it still reaches the root's own listeners.
  const page = document.body.appendChild(document.createElement("div"));
  const container = page.appendChild(document.createElement("div"));
  page.addEventListener("keydown", (event) => {
    if (event.key === "Escape") asked.escapedPast.push("Escape");
  });
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(SearchableMenu, {
        id: "menu",
        label: "Model",
        placeholder: options.placeholder,
        rows: ROWS,
        value: undefined,
        noMatch: "No models match",
        onPick: (id) => asked.said.push(`pick ${id}`),
        onClose: () => asked.said.push("close"),
        onLeave: () => undefined,
        foot: options.foot === true ? footOf(asked.said) : undefined,
      }),
    ),
  );
  return asked;
}

/** Where the keys are read: the field, or the list where there is none. */
function keys(): HTMLElement {
  return (
    document.querySelector<HTMLElement>('[role="combobox"]') ??
    document.querySelector<HTMLElement>('[role="listbox"]') ??
    assert.fail("the keys' element")
  );
}

function press(init: KeyboardEventInit): void {
  act(() => {
    keys().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
}

/** The words of the row the keys' element names active to a reader. */
function announced(): string | undefined {
  const id = keys().getAttribute("aria-activedescendant");
  const row = id === null ? null : document.getElementById(id);
  return row?.textContent ?? undefined;
}

test("the arrows pass over a row that cannot be picked, wrap, and Enter picks the one named", () => {
  const asked = mount({ placeholder: "Search models" });
  const first = announced();
  press({ key: "ArrowDown" });
  const passed = announced();
  press({ key: "ArrowDown" });
  const wrapped = announced();
  press({ key: "End" });
  press({ key: "Enter" });

  assert.equal(document.activeElement, keys());
  assert.deepEqual([first, passed, wrapped], ["Opus", "Haiku", "Opus"]);
  assert.deepEqual(asked.said, ["pick haiku"]);
});

test("an Enter held with Command picks the highlighted row as a bare one does", () => {
  const asked = mount({ placeholder: "Search models" });
  press({ key: "ArrowDown" });
  press({ key: "Enter", metaKey: true });

  assert.deepEqual(asked.said, ["pick haiku"]);
});

test("the arrows go on into the pinned rows, whose submenu Right opens, Left closes, and Enter picks in", () => {
  const asked = mount({ placeholder: "Search models", foot: true });
  press({ key: "ArrowUp" });
  const last = announced();
  press({ key: "ArrowUp" });
  const effort = announced();
  press({ key: "ArrowRight" });
  const inside = announced();
  const expanded = document
    .querySelector('[aria-haspopup="listbox"]')
    ?.getAttribute("aria-expanded");
  press({ key: "ArrowLeft" });
  const closed = document.querySelector('[aria-label="Effort"][role="listbox"]');
  press({ key: "ArrowRight" });
  press({ key: "ArrowUp" });
  press({ key: "Enter" });

  assert.deepEqual([last, effort, inside, expanded], ["Open on GitHub", "Effort", "High", "true"]);
  assert.equal(closed, null);
  assert.deepEqual(asked.said, ["effort low"]);
});

test("Enter on a pinned row presses it", () => {
  const asked = mount({ placeholder: "Search models", foot: true });
  press({ key: "ArrowUp" });
  press({ key: "Enter" });

  assert.deepEqual(asked.said, ["github"]);
});

test("Escape closes an open submenu before the menu, and never reaches the page behind", () => {
  const asked = mount({ placeholder: "Search models", foot: true });
  press({ key: "ArrowUp" });
  press({ key: "ArrowUp" });
  press({ key: "ArrowRight" });
  press({ key: "Escape" });
  const submenu = document.querySelector('[aria-label="Effort"][role="listbox"]');
  press({ key: "Escape" });

  assert.equal(submenu, null);
  assert.deepEqual(asked.said, ["close"]);
  assert.deepEqual(asked.escapedPast, []);
});

test("keys an input method is composing with move nothing and pick nothing", () => {
  const asked = mount({ placeholder: "Search models" });
  press({ key: "ArrowDown", isComposing: true });
  const still = announced();
  press({ key: "Enter", isComposing: true });
  press({ key: "Escape", isComposing: true });

  assert.equal(still, "Opus");
  assert.deepEqual(asked.said, []);
  assert.deepEqual(asked.escapedPast, []);
});

test("a list too short to search holds focus, names its highlight, and reads the same keys", () => {
  const asked = mount();
  press({ key: "ArrowDown" });
  const moved = announced();
  press({ key: "Enter" });

  assert.equal(keys().getAttribute("role"), "listbox");
  assert.equal(document.activeElement, keys());
  assert.equal(moved, "Haiku");
  assert.deepEqual(asked.said, ["pick haiku"]);
});
