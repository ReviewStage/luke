// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { NAV_COUNT_SHOWN } from "../nav-item/nav-item.js";
import { type GroupFold, GroupHeader } from "./group-header.js";

/**
 * group-header.test.ts -- pressing a group's head folds and unfolds its
 * rows and says so in `aria-expanded`, open or folded from the start or as
 * its holder keeps it; an action beside the fold presses without folding;
 * a head that folds nothing draws its rows always and no fold control; the
 * count is drawn as its caller gives it; a press that opens plays the
 * Disclosure's motion, and every motion the fold and its chevron run is
 * timed on a token reduced motion holds still.
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

test("a press that opens plays the fold's motion, and a group drawn open plays none", () => {
  const container = render(group({ defaultOpen: false }));
  const root = container.firstElementChild ?? assert.fail("a group");
  assert.equal(root.getAttribute("data-disclosure"), null);

  act(() => headOf(container).click());
  assert.equal(root.getAttribute("data-disclosure"), "opening");

  const open = render(group({ defaultOpen: true }));
  assert.equal(open.firstElementChild?.getAttribute("data-disclosure"), null);
});

/** The rule blocks a stylesheet draws for `selector`, joined. */
function rulesFor(css: string, selector: string): string {
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  return blocks
    .filter(([, head]) => head?.includes(selector))
    .map(([, , body]) => body)
    .join("\n");
}

/** The duration tokens a block of declarations names. */
function durations(declarations: string): string[] {
  return [...declarations.matchAll(/var\((--luke-duration-[a-z-]+)\)/g)].flatMap(([, name]) =>
    name === undefined ? [] : [name],
  );
}

test("every motion the fold and its chevron run is timed on a token reduced motion holds still", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const disclosure = read("../disclosure/disclosure.css");
  const reduced = read("../../tokens/motion.css").split("prefers-reduced-motion")[1] ?? "";
  const motions = [
    ...durations(rulesFor(disclosure, ".luke-disclosure-turn {")),
    ...durations(rulesFor(disclosure, '[data-disclosure="opening"] > .luke-disclosure-body')),
    ...durations(rulesFor(disclosure, '[data-disclosure="closing"] > .luke-disclosure-body')),
    // Note that a hover's settle is a colour's or a fade's, which reduced motion keeps.
    ...durations(read("./group-header.css")).filter((token) => token !== "--luke-duration-hover"),
  ];
  assert.ok(motions.length >= 3);
  for (const token of motions) {
    assert.match(
      reduced,
      new RegExp(`${token}: 1ms;`),
      `${token} is held still under reduced motion`,
    );
  }
});
