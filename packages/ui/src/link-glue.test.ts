import assert from "node:assert/strict";
import { test } from "vitest";
import { gluedRun } from "./link-glue.js";

/**
 * link-glue.test.ts -- a run of words with each chip held in one box with the punctuation written against it: the closing punctuation that starts the text after it and the opening that ends the text before it, split off that text, and nothing held where nothing is written against it. Synthetic words.
 */

type Node = { readonly type: string; readonly value?: string; readonly inside?: readonly Node[] };

const chip = (name: string): Node => ({ type: "chip", value: name });
const text = (value: string): Node => ({ type: "text", value });

/** The run as words: a box drawn as [what it holds]. */
function said(run: readonly Node[]): string {
  return run
    .map((node) => (node.inside === undefined ? (node.value ?? "") : `[${said(node.inside)}]`))
    .join("");
}

function glued(run: readonly Node[]): string {
  return said(
    gluedRun(
      run,
      (node) => node.type === "chip",
      text,
      (inside) => ({ type: "box", inside }),
    ),
  );
}

test("a chip is held with the comma after it, the text after the comma left as words", () => {
  assert.equal(
    glued([text("opened as "), chip("#4823"), text(", after "), chip("#4790"), text(" merged.")]),
    "opened as [#4823,] after [#4790] merged.",
  );
});

test("a chip in brackets is held with both, and a chip ending its sentence with its full stop", () => {
  assert.equal(
    glued([text("which ("), chip("IAM-482"), text(") tracks "), chip("the plan"), text(".")]),
    "which [(IAM-482)] tracks [the plan.]",
  );
});

test("a chip with nothing written against it is held alone, and words with no chip are left as they are", () => {
  assert.equal(
    glued([text("see "), chip("the store"), text(" and more")]),
    "see [the store] and more",
  );
  assert.equal(glued([text("no chips, here.")]), "no chips, here.");
});

test("words full of opening brackets before a chip are read in one pass, only the run touching the chip held with it", () => {
  const brackets = "(".repeat(50_000);
  // Note that a read retried from every bracket would take billions of steps here, past the test's own timeout.
  assert.equal(
    glued([text(`${brackets}x((`), chip("IAM-482"), text(")")]),
    `${brackets}x[((IAM-482)]`,
  );
});
