// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * task-issue-links-narrow.test.ts -- on a phone a linked issue's row stands
 * its controls, its state, its Closes / Part of switch, and its Unlink ×, on
 * a line of their own under its mark, key, and title, so the title alone
 * gives way, cut short, and no control is pushed past the box's edge, as one
 * line of them all was at 390px and 360px. A wide room keeps the one line.
 *
 * jsdom lays nothing out, so the window's stylesheets are laid for a touch
 * screen (`testing/container-width.ts`) under a shell in the room given, and
 * the row, as `task-issue-links.tsx` draws it, is read through them: which
 * line of the row's grid each part stands on, and whether the title's track
 * may shrink to nothing.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.innerHTML = "";
});

/** Each part of a row, by the class it wears after `task-issue-link-`. */
const PARTS = ["mark", "key", "title", "state", "relation", "unlink"] as const;

/** The parts that are presses or words that must stay whole. */
const CONTROLS = ["state", "relation", "unlink"] as const;

/** A linked issue's row drawn in a shell standing in `room`, the sheets laid for a touch screen. */
function rowIn(room: "narrow" | "wide"): HTMLElement {
  laid = layContainersAt({}, { touch: true });
  document.body.innerHTML = [
    `<div class="desktop-shell" data-room="${room}">`,
    '<section class="task-issue-links"><ul class="task-issue-links-rows">',
    '<li class="task-issue-link" data-provider="github">',
    ...PARTS.map((part) => `<span class="task-issue-link-${part}"></span>`),
    "</li></ul></section></div>",
  ].join("");
  return document.querySelector<HTMLElement>(".task-issue-link") ?? assert.fail("the row stands");
}

/** The row's grid lines, each a list of the areas standing on it, left to right. */
function lines(row: HTMLElement): string[][] {
  const areas = getComputedStyle(row).getPropertyValue("grid-template-areas");
  return [...areas.matchAll(/"([^"]*)"/g)].map(([, line = ""]) => line.trim().split(/\s+/));
}

/** The grid line `part` stands on, by its area; none where it stands in no area of the row. */
function lineOf(row: HTMLElement, part: string): number | undefined {
  const element = row.querySelector(`.task-issue-link-${part}`) ?? assert.fail(`${part} stands`);
  const area = getComputedStyle(element).getPropertyValue("grid-area");
  const at = lines(row).findIndex((line) => line.includes(area));
  return at === -1 ? undefined : at;
}

test("on a phone a linked issue's controls stand on a line of their own, under a title that gives way", () => {
  const row = rowIn("narrow");
  assert.equal(getComputedStyle(row).display, "grid");
  const title = lineOf(row, "title");
  assert.notEqual(title, undefined, "the title stands in the row");
  for (const control of CONTROLS) {
    const line = lineOf(row, control);
    assert.notEqual(line, undefined, `${control} stands in the row`);
    assert.notEqual(line, title, `${control} is not on the title's line`);
  }
  const tracks = getComputedStyle(row).getPropertyValue("grid-template-columns");
  assert.match(tracks, /minmax\(0,\s*1fr\)/, "the title's track may shrink to nothing");
  for (const line of lines(row)) {
    assert.equal(
      line.length,
      tracks.match(/minmax\([^)]*\)|\S+/g)?.length,
      "every line spans the tracks",
    );
  }
});

test("in a wide room a linked issue keeps its one line", () => {
  const row = rowIn("wide");
  assert.equal(getComputedStyle(row).display, "flex");
  assert.deepEqual(lines(row), []);
});
