// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { DIFF_SELECTION_SIDE } from "./contract.js";
import { pressedOnCode, selectedLines } from "./text-selection.js";

/**
 * text-selection.test.ts -- code selected as text in a diff Pierre drew is
 * read as the lines it runs over: a changed row on the side it changed, an
 * unchanged one on its column's side, a drag ending at the start of a row
 * on the row before it, and a selection ending outside every row as none.
 */

/** A row as Pierre writes one: its number, its kind, and its words. */
function row(line: number, type: string, words: string): string {
  return `<div data-line="${line}" data-line-type="${type}"><span>${words}</span></div>`;
}

/** Draws `markup` and answers the element it stands in. */
function drawn(markup: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  document.body.append(host);
  return host;
}

/** The words of the row numbered `line` in `scope`, the text node a selection's end stands in. */
function wordsOf(scope: ParentNode, line: number): Text {
  const text = scope.querySelector(`[data-line="${line}"] span`)?.firstChild;
  assert.ok(text instanceof Text, `row ${line} has words`);
  return text;
}

afterEach(() => {
  document.body.replaceChildren();
});

test("a unified diff's selection runs from a removed row on the old side to an added row on the new", () => {
  const host = drawn(
    `<div data-code>${row(11, "context", "four")}${row(12, "change-deletion", "twice")}${row(12, "change-addition", "once")}${row(13, "change-addition", "done")}</div>`,
  );
  const removed = host.querySelector('[data-line-type="change-deletion"] span')?.firstChild;
  assert.ok(removed instanceof Text);

  assert.deepEqual(
    selectedLines({
      startContainer: removed,
      startOffset: 1,
      endContainer: wordsOf(host, 13),
      endOffset: 2,
    }),
    {
      start: 12,
      side: DIFF_SELECTION_SIDE.DELETIONS,
      end: 13,
      endSide: DIFF_SELECTION_SIDE.ADDITIONS,
    },
  );
  assert.deepEqual(
    selectedLines({
      startContainer: wordsOf(host, 11),
      startOffset: 0,
      endContainer: wordsOf(host, 11),
      endOffset: 3,
    }),
    {
      start: 11,
      side: DIFF_SELECTION_SIDE.ADDITIONS,
      end: 11,
      endSide: DIFF_SELECTION_SIDE.ADDITIONS,
    },
    "an unchanged row out of any old column counts on the new side",
  );
});

test("an unchanged row in a split diff's old column counts on the old side", () => {
  const host = drawn(
    `<div data-code data-deletions>${row(9, "context", "two")}${row(10, "context", "three")}</div>`,
  );

  assert.deepEqual(
    selectedLines({
      startContainer: wordsOf(host, 9),
      startOffset: 0,
      endContainer: wordsOf(host, 10),
      endOffset: 1,
    }),
    {
      start: 9,
      side: DIFF_SELECTION_SIDE.DELETIONS,
      end: 10,
      endSide: DIFF_SELECTION_SIDE.DELETIONS,
    },
  );
});

test("a drag ending at the very start of a row ends on the row before it, across a gap", () => {
  const host = drawn(
    `<div data-code>${row(4, "context", "a")}${row(5, "context", "b")}<div data-separator></div>${row(30, "context", "z")}</div>`,
  );

  assert.deepEqual(
    selectedLines({
      startContainer: wordsOf(host, 4),
      startOffset: 0,
      endContainer: wordsOf(host, 30),
      endOffset: 0,
    }),
    {
      start: 4,
      side: DIFF_SELECTION_SIDE.ADDITIONS,
      end: 5,
      endSide: DIFF_SELECTION_SIDE.ADDITIONS,
    },
  );
});

test("a selection ending outside every row, in a note under a line, runs over no lines", () => {
  const host = drawn(`<div data-code>${row(4, "context", "a")}</div><p class="note">A comment</p>`);
  const note = host.querySelector(".note")?.firstChild;
  assert.ok(note instanceof Text);

  assert.equal(
    selectedLines({
      startContainer: wordsOf(host, 4),
      startOffset: 0,
      endContainer: note,
      endOffset: 3,
    }),
    undefined,
  );
});

test("only a press on a file's code begins a drag over it; one on its header or a note does not", () => {
  const host = drawn(
    `<div class="head"><button>Fold</button></div><div data-code>${row(4, "context", "a")}</div>`,
  );
  const words = wordsOf(host, 4);
  const button = host.querySelector("button");
  assert.ok(button !== null);

  // The path a press takes, from where it landed up through its ancestors.
  const pathFrom = (node: Node): Node[] =>
    node.parentNode === null ? [node] : [node, ...pathFrom(node.parentNode)];

  assert.equal(pressedOnCode(pathFrom(words)), true);
  assert.equal(pressedOnCode(pathFrom(button)), false);
});
