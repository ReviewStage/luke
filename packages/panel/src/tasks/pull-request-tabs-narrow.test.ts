// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * pull-request-tabs-narrow.test.ts -- the Pull request tab's row of tabs gives way in steps as the tab narrows: Review's word first, then the tabs' room, and only on the narrowest tab every tab's name at once.
 *
 * jsdom lays nothing out and answers no container query, so the window's
 * stylesheets are laid for a tab of each width (`testing/container-width.ts`)
 * and the row, as the tab draws it, is read through them.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.innerHTML = "";
});

/** The tab's row of tabs, Review at its end, in a tab as wide as given. */
function rowAt(width: number) {
  laid = layContainersAt({ "pull-request-tab": width });
  document.body.innerHTML = [
    '<div class="file-view pull-request-tab">',
    '<div class="pull-request-tabs">',
    '<div class="luke-choice-bar" role="tablist" data-look="fill" data-fold="toolbar"></div>',
    '<div class="pull-request-review"><button class="luke-button">',
    '<span class="pull-request-review-words">Review</span>',
    "</button></div>",
    "</div></div>",
  ].join("");
  const row = document.querySelector(".pull-request-tabs") ?? assert.fail("the row stands");
  const words =
    document.querySelector(".pull-request-review-words") ?? assert.fail("Review's word");
  return {
    fold: getComputedStyle(row).getPropertyValue("--luke-fold").trim(),
    reviewWord: getComputedStyle(words).display !== "none",
  };
}

test("a roomy tab names Review and folds nothing", () => {
  assert.deepEqual(rowAt(700), { fold: "", reviewWord: true });
}, 30_000);

test("at 600px Review draws its glyph alone and the tabs keep their names and their room", () => {
  assert.deepEqual(rowAt(600), { fold: "", reviewWord: false });
}, 30_000);

test("down to 480px the tabs take their room in, still named", () => {
  assert.deepEqual(rowAt(520), { fold: "tight", reviewWord: false });
  laid?.remove();
  assert.deepEqual(rowAt(480), { fold: "tight", reviewWord: false });
}, 60_000);

test("only below 480px do the tabs fold, every one at once", () => {
  assert.deepEqual(rowAt(470), { fold: "folded", reviewWord: false });
}, 30_000);
