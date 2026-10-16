// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, beforeAll, test } from "vitest";
import { layContainersAt } from "#testing/container-width";
import {
  drawChangesTab,
  drawFileNote,
  drawPageTab,
  drawSubagentRow,
  unmountTabs,
} from "#testing/side-panel-tabs";

/**
 * The side panel's tabs at its narrowest, 280px, where no tab has room for
 * a pane beside it or for every word of its bars: a Changes tab draws its
 * tree over the diff only once asked and numbers the diff on one side, a
 * note of Luke's says its age in a pill, a subagent's job takes two lines,
 * and a page's bar counts its versions. jsdom lays nothing out, so the
 * window's stylesheets are laid once for a panel that wide
 * (`#testing/container-width`) and what is drawn is read through them.
 * `side-panel-wide.test.ts` reads the same tabs in a wide panel.
 */

beforeAll(() => {
  layContainersAt({ "side-panel": 280 });
  // The first element read cascades the whole window once, which is left to the setup.
  getComputedStyle(document.documentElement);
  // Note that the setup is given longer than most, because jsdom takes seconds to lay the stylesheets.
}, 30_000);

afterEach(unmountTabs);

/**
 * Whether the stylesheets draw the element itself, which is where every
 * rule read here hides one. Note that its boxes around are not read, as
 * `shown` reads them, because jsdom takes a tenth of a second to cascade
 * each element through the window's stylesheets.
 */
function drawn(element: Element): boolean {
  return getComputedStyle(element).display !== "none";
}

/** The diff's lines as drawn: each the numbers shown in its gutter, then its text. */
function diffLines(tab: HTMLElement): string[][] {
  return [...tab.querySelectorAll(".code-line[data-diff]")].map((line) => [
    ...[...line.querySelectorAll(".code-line-number")]
      .filter(drawn)
      .map((number) => number.textContent ?? ""),
    line.querySelector(".code-line-text")?.textContent ?? "",
  ]);
}

test("a Changes tab draws no tree beside the diff, its count under the diff, until the tree's toggle opens it over the diff for this tab alone", async () => {
  const tab = await drawChangesTab();
  // The tree, where it is drawn at all.
  const treeDrawn = () => {
    const tree = tab.querySelector('[aria-label="Changed files"]');
    return tree !== null && drawn(tree);
  };
  const toggles = () =>
    [...tab.querySelectorAll<HTMLButtonElement>(".file-tree-toggle")].filter(drawn);
  const count = () =>
    [...tab.querySelectorAll(".file-tree-foot")].filter(drawn).map((foot) => foot.textContent);

  assert.ok(!treeDrawn(), "the tree the panel holds open stands nowhere");
  assert.deepEqual(count(), ["1 file changed +2 −1"]);
  assert.deepEqual(
    toggles().map((button) => [
      button.getAttribute("aria-label"),
      button.getAttribute("aria-expanded"),
    ]),
    [["Show files", "false"]],
  );

  await act(async () => toggles()[0]?.click());

  assert.ok(treeDrawn(), "the tree stands over the diff");
  assert.deepEqual(
    toggles().map((button) => button.getAttribute("aria-label")),
    ["Hide files"],
  );

  act(() => {
    tab
      .querySelector(".file-tab")
      ?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  assert.ok(!treeDrawn(), "a press on the diff takes the tree down");
});

test("a Changes tab numbers its diff on the new side alone, a removed line by its tint", async () => {
  const tab = await drawChangesTab();
  assert.deepEqual(diffLines(tab), [
    ["", "@@ -1,2 +1,3 @@"],
    ["1", "const a = 1;"],
    ["", "const b = 2;"],
    ["2", "const b = 3;"],
    ["3", "const c = 4;"],
  ]);
});

test("a note of Luke's says its age in the link's pill, the link drawing its glyph alone and still named, so the header's parts never stand on one another", async () => {
  const note = await drawFileNote();
  const time = note.querySelector(".file-note-time") ?? assert.fail("the note's age is drawn");
  const link =
    note.querySelector<HTMLButtonElement>('button[aria-label="Show in Code"]') ??
    assert.fail("the link to the Code tab stands");

  assert.equal(drawn(time), false);
  assert.deepEqual(
    [...link.children].filter(drawn).map((part) => part.tagName.toLowerCase()),
    ["svg"],
  );
});

test("a subagent's job takes a second line before it is cut", async () => {
  const row = await drawSubagentRow();
  const job = row.querySelector(".subagent-job") ?? assert.fail("the job is drawn");
  assert.equal(getComputedStyle(job).whiteSpace, "normal");
});

test("a page's bar counts its versions without words, leaving its title the room", async () => {
  const tab = await drawPageTab();
  assert.deepEqual(
    [...tab.querySelectorAll(".page-view-version > *")]
      .filter(drawn)
      .map((part) => part.textContent),
    ["3/3"],
  );
});
