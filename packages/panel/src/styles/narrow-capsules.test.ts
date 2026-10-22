// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  BADGE_TONE,
  Badge,
  CHOICE_LOOK,
  ChoiceList,
  PROFILE,
  surfaceAttributes,
  THEME,
} from "@luke/ui";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { WaitingBadge } from "../desktop/task-row-parts.js";
import { layContainersAt } from "../testing/container-width.js";

/**
 * narrow-capsules.test.ts -- in a narrow column, a side panel's or a
 * phone's, nothing round swells into a bubble and no label is squeezed to a
 * word a line. A form's select option and a badge (the Inbox's settled and
 * waiting pills among them) round their corners by half a line's height rather than
 * fully, so one whose words wrap stands as a rounded box; an option's badge
 * drops under its label rather than squeezing it; a board card's "1 needs
 * you" keeps its words on one line; and a settled form's value drops under
 * its name rather than crushing it. jsdom lays nothing out and resolves no
 * `var()`, so the sheets are laid (`testing/container-width.ts`) and each
 * length is read as a browser reads it, its tokens followed from the element.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];
let laid: HTMLStyleElement | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  for (const [name, value] of Object.entries(surfaceAttributes(PROFILE.DESKTOP, THEME.DARK))) {
    if (value !== undefined) document.documentElement.setAttribute(name, value);
  }
  laid = layContainersAt({});
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
  for (const name of ["data-luke-profile", "data-luke-theme", "data-luke-density"]) {
    document.documentElement.removeAttribute(name);
  }
});

/** Draws `element` inside markup of the given classes, outermost first, and answers the innermost. */
function draw(element: ReactElement, ...around: readonly string[]): HTMLElement {
  let holder = document.body.appendChild(document.createElement("div"));
  for (const className of around) {
    holder = holder.appendChild(document.createElement("div"));
    holder.className = className;
  }
  const root = createRoot(holder);
  roots.push(root);
  act(() => root.render(element));
  return holder;
}

/** A length with every `var()` in it read off `element` and every `calc()` worked out, in pixels. */
function pixels(element: Element, value: string): number {
  const style = getComputedStyle(element);
  let text = value.trim();
  for (let depth = 0; depth < 8 && text.includes("var("); depth += 1) {
    text = text.replace(/var\((--[\w-]+)\)/g, (_, name: string) =>
      style.getPropertyValue(name).trim(),
    );
  }
  const sum = text.replace(/calc\(/g, "(").replace(/(\d+(?:\.\d+)?)px/g, "$1");
  assert.match(sum, /^[\d.\s()+\-*/]+$/, `a length in pixels: ${value} (${text})`);
  return Number(new Function(`return ${sum};`)());
}

/** Whether a box whose one line stands `line` pixels tall, rounded as `element` is, keeps flat sides once its words wrap. */
function roundsByHalfALine(element: Element, line: number): boolean {
  const radius = pixels(element, getComputedStyle(element).getPropertyValue("border-radius"));
  return radius > 0 && radius <= line / 2;
}

const LONG_OPTION = 'Unavailable, with "Add an OpenAI API key in Settings"';

test("a form's select option whose words wrap stands as a rounded box, never an ellipse", () => {
  const list = draw(
    createElement(ChoiceList<string>, {
      legend: "Voice and dictation",
      options: [{ value: LONG_OPTION, label: LONG_OPTION, badge: "Recommended" }],
      value: [LONG_OPTION],
      look: CHOICE_LOOK.PILL,
      readOnly: true,
      onChange: () => undefined,
    }),
  );
  const pill = list.querySelector(".luke-choice") ?? assert.fail("the option");
  const line = pixels(pill, getComputedStyle(pill).getPropertyValue("min-height"));
  assert.ok(roundsByHalfALine(pill, line));
});

test("an option's badge drops under its label in a narrow column rather than squeezing it", () => {
  const list = draw(
    createElement(ChoiceList<string>, {
      legend: "Titles",
      options: [
        {
          value: "plain",
          label: "Plain fallback: title from the first words",
          badge: "Recommended",
        },
      ],
      value: [],
      look: CHOICE_LOOK.MARKED,
      onChange: () => undefined,
    }),
  );
  const head = list.querySelector(".luke-choice-head") ?? assert.fail("the row's head");
  assert.equal(getComputedStyle(head).flexWrap, "wrap");
  const label = list.querySelector(".luke-choice-label") ?? assert.fail("the label");
  // Note that the label asks a measure of its own, so the badge moves to the next line before the label shrinks below it.
  assert.ok(Number.parseFloat(getComputedStyle(label).flexBasis) > 0);
});

test("a badge whose words wrap stands as a rounded box, never a bubble", () => {
  const holder = draw(
    createElement(Badge, { tone: BADGE_TONE.ATTENTION, children: "Needs a long look" }),
  );
  const badge = holder.querySelector(".luke-badge") ?? assert.fail("the badge");
  // Note that jsdom drops a padding shorthand that names a token, so a line's height is its leading and the badge's padding token above and below it.
  const line = pixels(
    badge,
    `calc(${getComputedStyle(badge).getPropertyValue("line-height")} + 2 * var(--luke-space-2))`,
  );
  assert.ok(roundsByHalfALine(badge, line));
});

test("a board card's 1 needs you keeps its words on one line, the maker's name giving way", () => {
  const marks = draw(
    createElement(WaitingBadge, { count: 1 }),
    "tasks-board-card",
    "tasks-board-card-head",
    "tasks-board-card-marks",
  );
  const badge = marks.querySelector(".luke-badge") ?? assert.fail("the badge");
  assert.equal(getComputedStyle(badge).flexShrink, "0");
});

test("a settled form's long value drops under its name rather than squeezing the name a letter a line", () => {
  const values = draw(
    createElement(
      "li",
      { className: "inbox-value" },
      createElement("span", { className: "inbox-value-label" }, "Environment"),
      createElement(
        "div",
        { className: "inbox-value-words" },
        "packages/service/src/agents/coder-host/production.ts",
      ),
    ),
  );
  const row = values.querySelector(".inbox-value") ?? assert.fail("the row");
  const name = values.querySelector(".inbox-value-label") ?? assert.fail("the name");
  assert.equal(getComputedStyle(row).flexWrap, "wrap");
  assert.equal(getComputedStyle(name).flexShrink, "0");
});
