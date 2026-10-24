// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHOICE_BAR_FOLD, CHOICE_BAR_LOOK, ChoiceBar, PaneBar } from "@luke/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * pull-request-tabs-narrow.test.ts -- the Pull request tab's row of tabs gives way in steps as the tab narrows: Review folding to its glyph first, then the tabs' room; the tabs fold only once their names no longer fit (`choice-bar.test.ts`).
 *
 * jsdom lays nothing out and answers no container query, so the window's
 * stylesheets are laid for a tab of each width (`testing/container-width.ts`)
 * and the row, as the tab draws it, is read through them.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let laid: HTMLStyleElement | undefined;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  laid?.remove();
  laid = undefined;
  document.body.innerHTML = "";
  delete document.documentElement.dataset.lukeRoom;
});

/** The tab's row of tabs, Review at its end, in a tab as wide as given. */
function rowAt(width: number) {
  laid?.remove();
  laid = layContainersAt({ "pull-request-tab": width });
  document.body.innerHTML = [
    '<div class="file-view pull-request-tab">',
    '<div class="luke-pane-bar">',
    '<div class="luke-choice-bar" role="tablist" data-look="fill" data-fold="together"></div>',
    '<div class="pull-request-review"><span class="luke-folding-button"><button class="luke-button">',
    '<span class="luke-button-words">Review</span>',
    "</button></span></div>",
    "</div></div>",
  ].join("");
  const row = document.querySelector(".luke-pane-bar") ?? assert.fail("the row stands");
  const review =
    document.querySelector(".luke-folding-button") ?? assert.fail("Review's press stands");
  return {
    fold: getComputedStyle(row).getPropertyValue("--luke-fold").trim(),
    reviewWord: getComputedStyle(review).getPropertyValue("--luke-fold").trim() !== "folded",
  };
}

test("a roomy tab names Review and keeps the tabs' room", () => {
  assert.deepEqual(rowAt(700), { fold: "", reviewWord: true });
}, 30_000);

test("at 600px Review folds to a square around its glyph, as every folding button does, and the tabs keep their room", () => {
  assert.deepEqual(rowAt(600), { fold: "", reviewWord: false });
}, 30_000);

test("below 560px the tabs take their room in", () => {
  assert.deepEqual(rowAt(520), { fold: "tight", reviewWord: false });
  assert.deepEqual(rowAt(470), { fold: "tight", reviewWord: false });
}, 60_000);

/**
 * The row's tabs as the tab draws them in the room given at a phone's width
 * and too short for their names: in a narrow room named in words alone
 * (`CHOICE_BAR_FOLD.WORDS`), which draws no glyph; elsewhere folded together.
 */
function phoneRowAt(room: "narrow" | "wide") {
  laid?.remove();
  laid = layContainersAt({ "pull-request-tab": 390 }, { touch: true });
  const bar =
    room === "narrow"
      ? '<div class="luke-choice-bar" role="tablist" data-look="fill" data-fold="words">'
      : '<div class="luke-choice-bar" role="tablist" data-look="fill" data-fold="together" data-folded="true">';
  const glyph = room === "narrow" ? "" : '<span class="luke-choice-bar-icon"><svg></svg></span>';
  document.documentElement.dataset.lukeRoom = room;
  document.body.innerHTML = [
    '<div class="desktop-shell"><div class="file-view pull-request-tab">',
    '<div class="luke-pane-bar"><div class="luke-pane-bar-middle">',
    bar,
    '<button class="luke-choice-bar-option" role="tab" aria-selected="true">',
    `${glyph}<span class="luke-choice-bar-label">Conversation</span>`,
    "</button></div></div></div>",
    "</div></div>",
  ].join("");
  const label = getComputedStyle(
    document.querySelector(".luke-choice-bar-label") ?? assert.fail("the name stands"),
  );
  const icon = document.querySelector(".luke-choice-bar-icon");
  return {
    named: label.position !== "absolute" && label.clipPath !== "inset(50%)",
    glyph: icon !== null && getComputedStyle(icon).display !== "none",
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

/**
 * The tabs as the tab draws them, a fill bar folding together in the
 * PaneBar's middle. Note that the bar is a size container, which counts
 * none of its options toward its own width, so a bar that only hugs them
 * stands 0px wide and shows none of them: it must grow into the middle.
 */
test("the tabs take the bar's middle rather than hugging options their container does not count", () => {
  laid = layContainersAt({ "pull-request-tab": 700 });
  const tab = document.body.appendChild(document.createElement("div"));
  tab.className = "file-view pull-request-tab";
  const root = createRoot(tab);
  roots.push(root);
  act(() =>
    root.render(
      createElement(PaneBar, {
        middle: createElement(ChoiceBar<"conversation" | "files">, {
          label: "Pull request",
          items: [
            { value: "conversation", label: "Conversation" },
            { value: "files", label: "Files changed" },
          ],
          value: "conversation",
          onChange: () => {},
          look: CHOICE_BAR_LOOK.FILL,
          fold: CHOICE_BAR_FOLD.TOGETHER,
        }),
      }),
    ),
  );
  const bar = tab.querySelector(".luke-choice-bar") ?? assert.fail("the tabs stand");
  assert.equal(bar.parentElement?.className, "luke-pane-bar-middle");
  const drawn = getComputedStyle(bar);
  assert.equal(drawn.containerType, "inline-size");
  assert.equal(drawn.flexGrow, "1");
}, 30_000);
