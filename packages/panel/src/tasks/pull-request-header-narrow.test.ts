// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * pull-request-header-narrow.test.ts -- the Pull request tab's header gives a narrow tab's title a line of its own, over the pill and the controls, rather than a word to a line beside them; a roomy one keeps the three in one row.
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
    '<button class="luke-chip">Open</button>',
    '<h2 class="pull-request-title pull-request-title-editable">A long title <span class="pull-request-number">#1</span></h2>',
    '<div class="pull-request-title-actions"><button class="luke-button">Merge</button></div>',
    "</div></header></div>",
  ].join("");
  const row = document.querySelector(".pull-request-title-row") ?? assert.fail("the row stands");
  const title = document.querySelector(".pull-request-title") ?? assert.fail("the title stands");
  const style = getComputedStyle(title);
  return {
    wraps: getComputedStyle(row).flexWrap === "wrap",
    titleFirst: style.order === "-1",
    titleFullWidth: style.flexBasis === "100%",
  };
}

const OWN_LINE = { wraps: true, titleFirst: true, titleFullWidth: true } as const;

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
  assert.equal(style.titleFirst, false);
  assert.equal(style.titleFullWidth, false);
}, 30_000);
