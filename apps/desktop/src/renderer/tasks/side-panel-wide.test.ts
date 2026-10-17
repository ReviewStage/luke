// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, beforeAll, test, vi } from "vitest";
import { layContainersAt } from "#testing/container-width";
import {
  drawChangesTab,
  drawFileNote,
  drawPageTab,
  drawSubagentRow,
  unmountTabs,
} from "#testing/side-panel-tabs";
import { SIDE_PANEL_WIDTH } from "./use-side-panel";

/**
 * The side panel's tabs at its default width, as it opens, which holds a
 * tab and its pane side by side: the same tabs `side-panel-narrow.test.ts` reads at the panel's
 * narrowest keep their wide layout here, the tree beside the diff and its
 * count under it, a note's age and link in
 * words, a subagent's job on one line, and a page's versions in words.
 */

beforeAll(() => {
  layContainersAt({ "side-panel": SIDE_PANEL_WIDTH.DEFAULT });
  // The first element read cascades the whole window once, which is left to the setup.
  getComputedStyle(document.documentElement);
  // Note that the setup is given longer than most, because jsdom takes seconds to lay the stylesheets.
}, 30_000);

afterEach(() => {
  unmountTabs();
  vi.restoreAllMocks();
});

/**
 * Whether the stylesheets draw the element itself, which is where every
 * rule read here hides one. Note that its boxes around are not read, as
 * `shown` reads them, because jsdom takes a tenth of a second to cascade
 * each element through the window's stylesheets.
 */
function drawn(element: Element): boolean {
  return getComputedStyle(element).display !== "none";
}

test("a Changes tab stands its tree beside the diff as the panel holds it, the count under the tree", async () => {
  const tab = await drawChangesTab();
  const tree =
    tab.querySelector('[aria-label="Changed files"]') ?? assert.fail("the tree is drawn");

  assert.equal(drawn(tree), true);
  assert.deepEqual(
    [...tab.querySelectorAll(".file-tree-foot")]
      .filter(drawn)
      .map((foot) => foot.closest("aside") === tree),
    [true],
  );
  assert.deepEqual(
    [...tab.querySelectorAll<HTMLButtonElement>(".file-tree-toggle")]
      .filter(drawn)
      .map((button) => button.getAttribute("aria-label")),
    ["Hide files"],
  );
});

test("the tab's right edge floats nothing while the tree has room beside the diff", async () => {
  const tab = await drawChangesTab();
  const body = tab.querySelector(".file-view-body") ?? assert.fail("the diff's body is drawn");
  const diff = body.firstElementChild ?? assert.fail("the diff is drawn");
  vi.spyOn(body, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, SIDE_PANEL_WIDTH.DEFAULT, 400),
  );
  act(() => {
    diff.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: SIDE_PANEL_WIDTH.DEFAULT - 2 }),
    );
  });
  assert.equal(tab.querySelector(".file-view")?.getAttribute("data-pane-over"), "closed");
});

test("a note of Luke's says its age and its link in words", async () => {
  const note = await drawFileNote();
  assert.equal(
    drawn(note.querySelector(".file-note-time") ?? assert.fail("the age is drawn")),
    true,
  );
  assert.equal(
    drawn(note.querySelector(".file-note-show-words") ?? assert.fail("the link's words are drawn")),
    true,
  );
});

test("a subagent's job keeps to one line", async () => {
  const row = await drawSubagentRow();
  assert.equal(
    getComputedStyle(row.querySelector(".subagent-job") ?? assert.fail("the job is drawn"))
      .whiteSpace,
    "nowrap",
  );
});

test("a page's bar says its versions in words", async () => {
  const tab = await drawPageTab();
  assert.deepEqual(
    [...tab.querySelectorAll(".page-view-version > *")]
      .filter(drawn)
      .map((part) => part.textContent),
    ["Version 3 of 3"],
  );
});
