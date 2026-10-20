// @vitest-environment jsdom

/**
 * gap-controls.test.ts -- every gap between a file's hunks opens alike, as
 * Pierre draws it in Files changed: its words open all of it, short or long,
 * at the file's top, between two hunks, or at its foot, and its arrows the
 * next twenty lines; the trailing gap's words read the file first and open
 * it to its end; the keyboard presses each control as a click does; and a
 * gap that cannot open marks nothing. What a gap opens is read as the view
 * reads it to move a review thread onto its line (`./drawn-lines.ts`).
 * Synthetic files only.
 */

import assert from "node:assert/strict";
import {
  FileDiff,
  type FileDiffMetadata,
  type FileDiffOptions,
  getSharedHighlighter,
  parseDiffFromFile,
  parsePatchFiles,
} from "@pierre/diffs";
import { beforeAll, test } from "vitest";
import { GAP_CONTROL, GAP_CONTROL_ATTRIBUTE } from "./contract.js";
import { drawnAmong } from "./drawn-lines.js";
import { watchGapControls } from "./gap-controls.js";

/** A file of `length` lines, those numbered in `changed` changed. */
function texts(length: number, changed: readonly number[]) {
  const lines = Array.from({ length }, (_line, at) => `const line${at + 1} = ${at + 1};`);
  const after = lines.map((line, at) => (changed.includes(at + 1) ? `${line} // changed` : line));
  return { before: `${lines.join("\n")}\n`, after: `${after.join("\n")}\n` };
}

/** `length` lines, `changed` changed, read whole, as a file Files changed has read for its gaps. */
function changedFile(length: number, changed: readonly number[]): FileDiffMetadata {
  const { before, after } = texts(length, changed);
  return parseDiffFromFile({ name: "a.ts", contents: before }, { name: "a.ts", contents: after });
}

/**
 * A hundred and twenty lines, the thirtieth and the ninetieth changed: a
 * long gap at the top (1 to 25), one of two arrows between the hunks (35 to
 * 85), and a long one at the foot (95 to 120), each hunk holding four lines
 * around its change.
 */
const LONG = { length: 120, changed: [30, 90] } as const;

/**
 * Fifty lines, the fifteenth and the thirty-fifth changed: a short gap at
 * the top (1 to 10), one of one arrow between the hunks (20 to 30), and a
 * short one at the foot (40 to 50).
 */
const SHORT = { length: 50, changed: [15, 35] } as const;

/** Every line from `first` to `last`. */
function run(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_line, at) => first + at);
}

/** The file drawn by Pierre as Files changed draws it, twenty lines a press, its gaps' controls marked. */
function drawn(
  fileDiff: FileDiffMetadata,
  more: Pick<FileDiffOptions<string, undefined>, "loadDiffFiles"> = {},
) {
  const view = new FileDiff<string, undefined>({
    theme: { dark: "github-dark", light: "github-light" },
    preferredHighlighter: "shiki-js",
    hunkSeparators: "line-info-basic",
    expansionLineCount: 20,
    ...more,
  });
  const container = document.body.appendChild(document.createElement("div"));
  view.render({ fileDiff, fileContainer: container });
  const root = container.shadowRoot ?? assert.fail("Pierre draws in a shadow root");
  watchGapControls(root);
  return { view, root };
}

/** The control of the gap before hunk `index` drawn in the gutter, where it is seen: its words, or its arrow opening `way`. */
function control(root: ShadowRoot, index: number, which: "words" | "up" | "down" | "both") {
  const gap = `[data-gutter] [data-separator][data-expand-index="${index}"]`;
  const inner = which === "words" ? "[data-unmodified-lines]" : `[data-expand-${which}]`;
  return (
    root.querySelector<HTMLElement>(`${gap} ${inner}`) ?? assert.fail(`no ${which} on gap ${index}`)
  );
}

/** Clicks `element` as the pointer does. */
function click(element: HTMLElement, shiftKey = false) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, shiftKey }));
}

/** Lets the marks catch up with Pierre's drawing, which they follow as its rows change. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(async () => {
  // Note that the highlighter is loaded first, so Pierre draws each file at once.
  await getSharedHighlighter({
    themes: ["github-dark", "github-light"],
    langs: ["typescript"],
    preferredHighlighter: "shiki-js",
  });
});

test("a gap's words open all of it, short or long, at the top, between two hunks, and at the foot", async () => {
  for (const [file, gaps] of [
    [LONG, [run(1, 25), run(35, 85), run(95, 120)]],
    [SHORT, [run(1, 10), run(20, 30), run(40, 50)]],
  ] as const) {
    for (const [index, lines] of gaps.entries()) {
      const { view, root } = drawn(changedFile(file.length, file.changed));
      assert.deepEqual(drawnAmong(view, lines), [], "the gap stands closed");
      click(control(root, index, "words"));
      assert.deepEqual(
        drawnAmong(view, lines),
        lines,
        `gap ${index} of ${file.length} lines opens whole`,
      );
    }
  }
});

test("a long gap's arrows open twenty lines their way, and a short gap's arrow all of it", async () => {
  const top = drawn(changedFile(LONG.length, LONG.changed));
  click(control(top.root, 0, "down"));
  assert.deepEqual(drawnAmong(top.view, run(1, 25)), run(6, 25), "the twenty lines over the hunk");

  const between = drawn(changedFile(LONG.length, LONG.changed));
  click(control(between.root, 1, "up"));
  assert.deepEqual(
    drawnAmong(between.view, run(35, 85)),
    run(35, 54),
    "the twenty lines under the hunk above",
  );
  await settle();
  click(control(between.root, 1, "down"));
  assert.deepEqual(drawnAmong(between.view, run(35, 85)), [...run(35, 54), ...run(66, 85)]);

  const foot = drawn(changedFile(LONG.length, LONG.changed));
  click(control(foot.root, 2, "up"));
  assert.deepEqual(drawnAmong(foot.view, run(95, 120)), run(95, 114));

  const short = drawn(changedFile(SHORT.length, SHORT.changed));
  click(control(short.root, 1, "both"));
  assert.deepEqual(drawnAmong(short.view, run(20, 30)), run(20, 30));
});

test("every gap's controls are marked alike, the words as all of the gap and each arrow as the next lines, each a named button in the tab order", () => {
  const long = drawn(changedFile(LONG.length, LONG.changed)).root;
  const short = drawn(changedFile(SHORT.length, SHORT.changed)).root;
  const marks = (element: HTMLElement) => [
    element.getAttribute(GAP_CONTROL_ATTRIBUTE),
    element.getAttribute("role"),
    element.getAttribute("tabindex"),
  ];
  for (const root of [long, short]) {
    for (const index of [0, 1, 2]) {
      assert.deepEqual(marks(control(root, index, "words")), [GAP_CONTROL.ALL, "button", "0"]);
    }
  }
  for (const arrow of [
    control(long, 0, "down"),
    control(long, 1, "up"),
    control(long, 1, "down"),
    control(long, 2, "up"),
    control(short, 0, "down"),
    control(short, 1, "both"),
    control(short, 2, "up"),
  ]) {
    assert.deepEqual(marks(arrow), [GAP_CONTROL.MORE, "button", "0"]);
  }
  assert.equal(control(long, 1, "words").getAttribute("aria-label"), "Show all 51 lines");
  assert.equal(control(long, 1, "up").getAttribute("aria-label"), "Show 20 more lines");
  assert.equal(control(short, 1, "both").getAttribute("aria-label"), "Show all 11 lines");
});

test("a gap opened part way keeps its controls marked as Pierre draws it again", async () => {
  const { root } = drawn(changedFile(LONG.length, LONG.changed));
  click(control(root, 1, "up"));
  await settle();
  assert.equal(control(root, 1, "words").getAttribute(GAP_CONTROL_ATTRIBUTE), GAP_CONTROL.ALL);
  assert.equal(control(root, 1, "words").getAttribute("aria-label"), "Show all 31 lines");
  assert.equal(control(root, 1, "down").getAttribute(GAP_CONTROL_ATTRIBUTE), GAP_CONTROL.MORE);
});

test("Enter or Space presses a control as a click does, and the focus stays on it where its gap still stands", async () => {
  const { view, root } = drawn(changedFile(LONG.length, LONG.changed));
  const up = control(root, 1, "up");
  up.focus();
  up.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  assert.deepEqual(drawnAmong(view, run(35, 85)), run(35, 54));
  await settle();
  assert.equal(root.activeElement, control(root, 1, "up"), "the arrow drawn anew holds the focus");

  const words = control(root, 1, "words");
  words.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, composed: true }));
  assert.deepEqual(drawnAmong(view, run(35, 85)), run(35, 85));
});

/** The long file's patch alone, its first hunk, as Files changed reads it before a gap opens. */
function patchOnly(): FileDiffMetadata {
  const patch = [
    "diff --git a/a.ts b/a.ts",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -27,7 +27,7 @@",
    ...run(27, 33).map((line) =>
      line === 30
        ? "-const line30 = 30;\n+const line30 = 30; // changed"
        : ` const line${line} = ${line};`,
    ),
    "",
  ].join("\n");
  return parsePatchFiles(patch)[0]?.files[0] ?? assert.fail("the patch reads");
}

test("a long gap pressed from both ends by the keyboard keeps its two arrows, and the focus on the one pressed, until it opens whole", async () => {
  const { view, root } = drawn(changedFile(LONG.length, LONG.changed));
  const enter = (element: HTMLElement) =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
  enter(control(root, 1, "up"));
  await settle();
  const down = control(root, 1, "down");
  down.focus();
  enter(down);
  await settle();
  assert.deepEqual(drawnAmong(view, run(35, 85)), [...run(35, 54), ...run(66, 85)]);
  assert.equal(control(root, 1, "words").textContent, "11 unmodified lines");
  assert.equal(
    root.activeElement,
    control(root, 1, "down"),
    "Pierre still draws the gap's two arrows",
  );
  enter(control(root, 1, "down"));
  await settle();
  assert.deepEqual(drawnAmong(view, run(35, 85)), run(35, 85));
});

test("the trailing gap's words read the file first, then open it to its end", async () => {
  const { before, after } = texts(LONG.length, LONG.changed);
  let reads = 0;
  const { view, root } = drawn(patchOnly(), {
    loadDiffFiles: async () => {
      reads += 1;
      return {
        oldFile: { name: "a.ts", contents: before },
        newFile: { name: "a.ts", contents: after },
      };
    },
  });
  const trailing = control(root, 1, "words");
  assert.equal(trailing.getAttribute("aria-label"), "Show the rest of the file");
  click(trailing);
  await settle();
  await settle();
  assert.equal(reads, 1, "the file is read once");
  assert.deepEqual(drawnAmong(view, run(34, 120)), run(34, 120));
});

test("a gap of a file whose gaps cannot open, told it only moved as the list tells it, marks none of its controls", () => {
  const { cacheKey: _none, ...read } = patchOnly();
  const { root } = drawn(
    { ...read, type: "rename-pure" },
    { loadDiffFiles: async () => assert.fail("nothing is read") },
  );
  assert.ok(
    root.querySelector("[data-unmodified-lines]") !== null,
    "the gap says how many lines it leaves out",
  );
  assert.equal(root.querySelector(`[${GAP_CONTROL_ATTRIBUTE}]`), null);
  assert.equal(root.querySelector("[tabindex]"), null);
});
