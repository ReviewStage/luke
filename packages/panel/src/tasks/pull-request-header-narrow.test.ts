// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * pull-request-header-narrow.test.ts -- the Pull request tab's header gives a narrow tab's title a line of its own, over the pill and the controls, rather than a word to a line beside them, drawn in the markup's order, title first; a roomy one keeps the three in one row, the pill drawn ahead of the title that leads the markup.
 *
 * jsdom lays nothing out and answers no container query, so the window's
 * stylesheets are laid for a header of each width
 * (`testing/container-width.ts`) and the title row, as the tab draws it,
 * is read through them.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.innerHTML = "";
});

/** How the header's title row lays its title out, in a header as wide as given, on the device given. */
function titleRowAt(width: number, touch = false) {
  laid?.remove();
  laid = layContainersAt({ "pull-request-header": width }, { touch });
  document.body.innerHTML = [
    '<div class="file-view pull-request-tab">',
    '<header class="pull-request-header"><div class="pull-request-title-row">',
    '<h2 class="pull-request-title pull-request-title-editable">A long title <span class="pull-request-number">#1</span></h2>',
    '<button class="luke-chip">Open</button>',
    '<div class="pull-request-title-actions"><button class="luke-button">Merge</button></div>',
    "</div></header></div>",
  ].join("");
  const row = document.querySelector(".pull-request-title-row") ?? assert.fail("the row stands");
  const title = document.querySelector(".pull-request-title") ?? assert.fail("the title stands");
  const pill = document.querySelector(".luke-chip") ?? assert.fail("the pill stands");
  const style = getComputedStyle(title);
  // Note that flex items of one order are drawn in the markup's, which puts the title first.
  const order = (element: Element) => Number(getComputedStyle(element).order || "0");
  return {
    wraps: getComputedStyle(row).flexWrap === "wrap",
    titleFirst: order(title) <= order(pill),
    titleFullWidth: style.flexBasis === "100%",
  };
}

const OWN_LINE = {
  wraps: true,
  titleFirst: true,
  titleFullWidth: true,
} as const;

test("a phone's header stands the title on its own line, ahead of the pill and the controls", () => {
  assert.deepEqual(titleRowAt(342, true), OWN_LINE);
  assert.deepEqual(titleRowAt(312, true), OWN_LINE);
}, 60_000);

test("a desktop side panel at its least width does the same, under a mouse", () => {
  assert.deepEqual(titleRowAt(400), OWN_LINE);
  assert.deepEqual(titleRowAt(520), OWN_LINE);
}, 60_000);

test("a header wider than 520px keeps the pill, the title, and the controls in one row", () => {
  const style = titleRowAt(521);
  assert.equal(style.wraps, false);
  assert.equal(style.titleFirst, false, "the pill is drawn ahead of the title");
  assert.equal(style.titleFullWidth, false);
}, 30_000);

/** How a header folded as its view scrolled is drawn in the room given, on a phone's touch screen. */
function foldedAt(room: "narrow" | "wide") {
  laid?.remove();
  laid = layContainersAt({ "pull-request-header": 342 }, { touch: true });
  document.body.innerHTML = [
    `<div class="desktop-shell" data-room="${room}"><div class="file-view pull-request-tab">`,
    '<header class="pull-request-header" data-folded=""><div class="pull-request-title-row">',
    '<h2 class="pull-request-title pull-request-title-editable">A long title <span class="pull-request-number">#1</span></h2>',
    '<button class="luke-chip">Open</button>',
    '<div class="pull-request-title-actions"><button class="luke-button">Merge</button></div>',
    '</div><div class="changes-people pull-request-people">main ← topic</div></header>',
    "</div></div>",
  ].join("");
  const shown = (selector: string) =>
    getComputedStyle(document.querySelector(selector) ?? assert.fail(`${selector} stands`))
      .display !== "none";
  const title = document.querySelector(".pull-request-title") ?? assert.fail("the title stands");
  return {
    people: shown(".pull-request-people"),
    pill: shown(".luke-chip"),
    actions: shown(".pull-request-title-actions"),
    titleOneLine: getComputedStyle(title).whiteSpace === "nowrap",
  };
}

test("a phone's header folded as its view scrolls keeps only its title, on one line", () => {
  assert.deepEqual(foldedAt("narrow"), {
    people: false,
    pill: false,
    actions: false,
    titleOneLine: true,
  });
}, 30_000);

test("the desktop's header stays whole however its view scrolls", () => {
  assert.deepEqual(foldedAt("wide"), {
    people: true,
    pill: true,
    actions: true,
    titleOneLine: false,
  });
}, 30_000);

/** Whether the title's pencil is seen at rest, the pointer nowhere near it, on the device given. */
function pencilAtRest(touch: boolean): boolean {
  laid?.remove();
  laid = layContainersAt({ "pull-request-header": 600 }, { touch });
  document.body.innerHTML = [
    '<h2 class="pull-request-title pull-request-title-editable">A title ',
    '<span class="pull-request-title-end"><span class="pull-request-number">#1</span>',
    '<span class="pull-request-title-edit"><button aria-label="Edit title"></button></span>',
    "</span></h2>",
  ].join("");
  const pencil =
    document.querySelector(".pull-request-title-edit") ?? assert.fail("the pencil stands");
  return getComputedStyle(pencil).opacity !== "0";
}

test("a touch screen shows the title's pencil at rest, where a tap would otherwise find an unseen one; a mouse brings it by hovering", () => {
  assert.equal(pencilAtRest(true), true);
  assert.equal(pencilAtRest(false), false);
}, 60_000);
