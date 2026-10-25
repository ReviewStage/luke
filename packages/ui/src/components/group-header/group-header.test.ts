// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { NAV_COUNT_SHOWN } from "../nav-item/nav-item.js";
import { type GroupFold, GroupHeader } from "./group-header.js";

/**
 * group-header.test.ts -- pressing a group's head folds and unfolds its
 * rows and says so in `aria-expanded`, open or folded from the start or as
 * its holder keeps it; an action beside the fold presses without folding;
 * a head that folds nothing draws its rows always and no fold control; a
 * head may offer a search that the actions beside it survive; the count is
 * drawn as its caller gives it; and a folded group draws what it leaves
 * standing.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROWS = "Fix the sign-in loop";

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

function group(fold: GroupFold | undefined, extra: object = {}): ReactElement {
  return createElement(GroupHeader, { label: "acme/web", fold, ...extra, children: ROWS });
}

function headOf(container: HTMLElement): HTMLButtonElement {
  return container.querySelector("button[aria-expanded]") ?? assert.fail("a fold control");
}

test("pressing the head folds its group and unfolds it again, and aria-expanded follows", () => {
  const container = render(group({ defaultOpen: true }));
  const head = headOf(container);
  assert.equal(head.getAttribute("aria-expanded"), "true");
  assert.ok(container.textContent?.includes(ROWS));

  act(() => head.click());
  assert.equal(head.getAttribute("aria-expanded"), "false");
  assert.ok(!container.textContent?.includes(ROWS));

  act(() => head.click());
  assert.equal(head.getAttribute("aria-expanded"), "true");
  assert.ok(container.textContent?.includes(ROWS));
});

test("a group folded from the start draws its head alone, and names its rows once they stand", () => {
  const container = render(group({ defaultOpen: false }));
  const head = headOf(container);
  assert.equal(head.getAttribute("aria-expanded"), "false");
  assert.equal(head.getAttribute("aria-controls"), null);
  assert.ok(!container.textContent?.includes(ROWS));

  act(() => head.click());
  const rows = document.getElementById(head.getAttribute("aria-controls") ?? "");
  assert.equal(rows?.textContent, ROWS);
});

test("an open group with no rows names no rows it controls", () => {
  const container = render(
    createElement(GroupHeader, { label: "acme/web", fold: { defaultOpen: true } }),
  );
  const head = headOf(container);
  assert.equal(head.getAttribute("aria-expanded"), "true");
  assert.equal(head.getAttribute("aria-controls"), null);
});

test("a group its holder keeps folds as the holder says, told of each press", () => {
  const heard: boolean[] = [];
  function Held(): React.JSX.Element {
    const [open, setOpen] = useState(false);
    return group({
      open,
      onOpenChange: (next) => {
        heard.push(next);
        setOpen(next);
      },
    });
  }
  const container = render(createElement(Held));
  const head = headOf(container);
  act(() => head.click());
  act(() => head.click());
  assert.deepEqual(heard, [true, false]);
  assert.equal(head.getAttribute("aria-expanded"), "false");
  assert.ok(!container.textContent?.includes(ROWS));
});

test("an action beside the fold is pressed without folding the group", () => {
  let presses = 0;
  const actions = createElement(
    "button",
    { type: "button", onClick: () => (presses += 1) },
    "New task",
  );
  const container = render(group({ defaultOpen: true }, { actions }));
  const action = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "New task",
  );
  act(() => action?.click());
  assert.equal(presses, 1);
  assert.equal(headOf(container).getAttribute("aria-expanded"), "true");
  assert.ok(container.textContent?.includes(ROWS));
});

test("a head that offers a search unfolds it over the label while the actions beside it stay pressable", () => {
  const typed: string[] = [];
  let presses = 0;
  const container = render(
    group(undefined, {
      actions: createElement(
        "button",
        { type: "button", onClick: () => (presses += 1) },
        "View options",
      ),
      search: { label: "Search tasks", value: "", onChange: (value: string) => typed.push(value) },
    }),
  );
  const magnifier = container.querySelector<HTMLButtonElement>('button[aria-label="Search tasks"]');
  assert.ok(magnifier, "the head offers the search");
  assert.equal(container.querySelector("h2")?.textContent, "acme/web");

  act(() => magnifier.click());
  assert.ok(container.querySelector("input"), "the field is open");
  const options = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "View options",
  );
  act(() => options?.click());
  assert.equal(presses, 1);
});

test("a label that is a placeholder block heads a group as its words do", () => {
  const container = render(group(undefined, { label: createElement("i", null, "block") }));
  assert.equal(container.querySelector("h2")?.textContent, "block");
});

test("a head that folds nothing is a heading with its rows always drawn under it", () => {
  const container = render(group(undefined));
  assert.equal(container.querySelector("button"), null);
  assert.equal(container.querySelector("h2")?.textContent, "acme/web");
  assert.ok(container.textContent?.includes(ROWS));
});

test("the count is drawn as its caller gives it, none included, and read with its noun", () => {
  const counted = render(
    group(
      { defaultOpen: false },
      { count: { value: 0, noun: "tasks", shown: NAV_COUNT_SHOWN.ALWAYS } },
    ),
  );
  assert.equal(headOf(counted).textContent, "acme/web0 tasks");

  const uncounted = render(group({ defaultOpen: false }));
  assert.equal(headOf(uncounted).textContent, "acme/web");
});

test("what a folded group leaves standing is drawn once the rows fade, and not while they stand", () => {
  const container = render(group({ defaultOpen: true }, { standing: "Retry the audit" }));
  assert.ok(container.textContent?.includes(ROWS));
  assert.ok(!container.textContent?.includes("Retry the audit"));

  act(() => headOf(container).click());
  assert.ok(!container.textContent?.includes(ROWS));
  assert.ok(container.textContent?.includes("Retry the audit"));

  act(() => headOf(container).click());
  assert.ok(container.textContent?.includes(ROWS));
  assert.ok(!container.textContent?.includes("Retry the audit"));

  const unfolding = render(group(undefined, { standing: "Retry the audit" }));
  assert.ok(
    !unfolding.textContent?.includes("Retry the audit"),
    "a head that folds nothing keeps none",
  );
});
