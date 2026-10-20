// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * pull-request-tabs-narrow.test.ts -- the Pull request tab's row of tabs gives way in steps as the tab narrows: Review's word first, then the tabs' room; the tabs fold only once their names no longer fit (`choice-bar.test.ts`).
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
  laid?.remove();
  laid = layContainersAt({ "pull-request-tab": width });
  document.body.innerHTML = [
    '<div class="file-view pull-request-tab">',
    '<div class="pull-request-tabs">',
    '<div class="luke-choice-bar" role="tablist" data-look="fill" data-fold="together"></div>',
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

test("a roomy tab names Review and keeps the tabs' room", () => {
  assert.deepEqual(rowAt(700), { fold: "", reviewWord: true });
}, 30_000);

test("at 600px Review draws its glyph alone and the tabs keep their room", () => {
  assert.deepEqual(rowAt(600), { fold: "", reviewWord: false });
}, 30_000);

test("below 560px the tabs take their room in", () => {
  assert.deepEqual(rowAt(520), { fold: "tight", reviewWord: false });
  assert.deepEqual(rowAt(470), { fold: "tight", reviewWord: false });
}, 60_000);

/** The row's tabs as drawn in the room given at a phone's width, folded together as a row too short for their names folds them. */
function phoneRowAt(room: "narrow" | "wide") {
  laid?.remove();
  laid = layContainersAt({ "pull-request-tab": 390 }, { touch: true });
  document.body.innerHTML = [
    `<div class="desktop-shell" data-room="${room}"><div class="file-view pull-request-tab">`,
    '<div class="pull-request-tabs">',
    '<div class="luke-choice-bar" role="tablist" data-look="fill" data-fold="together" data-folded="true">',
    '<button class="luke-choice-bar-option" role="tab" aria-selected="true">',
    '<span class="luke-choice-bar-icon"><svg></svg></span><span class="luke-choice-bar-label">Conversation</span>',
    "</button></div></div>",
    "</div></div>",
  ].join("");
  const read = (selector: string) =>
    getComputedStyle(document.querySelector(selector) ?? assert.fail(`${selector} stands`));
  const label = read(".luke-choice-bar-label");
  return {
    named: label.position !== "absolute" && label.clipPath !== "inset(50%)",
    glyph: read(".luke-choice-bar-icon").display !== "none",
  };
}

test("on a phone the tabs are named in words, their glyphs giving way", () => {
  const phone = phoneRowAt("narrow");
  assert.equal(phone.named, true);
  assert.equal(phone.glyph, false);
}, 30_000);

test("the desktop's tabs at that width fold to their glyphs as before", () => {
  const desktop = phoneRowAt("wide");
  assert.equal(desktop.named, false);
  assert.equal(desktop.glyph, true);
}, 30_000);
