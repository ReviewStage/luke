// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * A plan's headings as its document draws them: h1, h2 and h3 three steps
 * down, at the one weight a note's headings carry everywhere else. jsdom
 * lays nothing out and drops `@layer`, so the sheets are laid through
 * `testing/container-width.ts`, and a weight is read as the value its rule
 * names. Synthetic throughout.
 */

const H1 = '<h1 class="luke-markdown-heading" data-level="1">Goal</h1>';
const H2 = '<h2 class="luke-markdown-heading" data-level="2">Approach</h2>';
const H3 = '<h3 class="luke-markdown-heading" data-level="3">Data model</h3>';
const LIST = "<ul><li>Model an invite as a pending membership.</li></ul>";

/** One heading of each of the first three levels, the h3 after a list inside its section. */
const DEFAULT_BLOCKS = [H1, H2, LIST, H3];

/** The room above a heading, in its own `em`. */
function roomAbove(style: CSSStyleDeclaration): number {
  return Number.parseFloat(style.marginTop) / Number.parseFloat(style.fontSize);
}

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

/** A plan document holding `blocks`, the sheets laid, answering its headings. */
function planHeadings(blocks: readonly string[] = DEFAULT_BLOCKS): readonly Element[] {
  layContainersAt(
    {},
    { only: ["@luke/ui/tokens.css", "@luke/ui/styles.css", "./tasks.css", "./desktop.css"] },
  );
  const plan = document.body.appendChild(document.createElement("section"));
  plan.className = "desktop-document";
  plan.innerHTML = [
    '<div class="plan-body"><div class="luke-markdown">',
    ...blocks,
    "</div></div>",
  ].join("");
  return [...plan.querySelectorAll(".luke-markdown-heading")];
}

test("a plan's h1, h2 and h3 each draw a step smaller than the one above, at one weight", () => {
  const [h1, h2, h3] = planHeadings().map((heading) => getComputedStyle(heading));
  assert.ok(h1 !== undefined && h2 !== undefined && h3 !== undefined, "all three headings stand");
  const size = (style: CSSStyleDeclaration) => Number.parseFloat(style.fontSize);

  assert.ok(size(h1) > size(h2), `h1 ${h1.fontSize} over h2 ${h2.fontSize}`);
  assert.ok(size(h2) > size(h3), `h2 ${h2.fontSize} over h3 ${h3.fontSize}`);
  assert.equal(h2.fontWeight, h1.fontWeight);
  assert.equal(h3.fontWeight, h1.fontWeight);
});

test("an h3 after a block inside its section stands the room above it an h2 does", () => {
  const [, h2, h3] = planHeadings().map((heading) => getComputedStyle(heading));
  assert.ok(h2 !== undefined && h3 !== undefined, "both headings stand");

  // Note that the px jsdom resolves each margin to rounds, so the two are equal to a hundredth.
  assert.ok(
    Math.abs(roomAbove(h3) - roomAbove(h2)) < 0.01,
    `h3 ${h3.marginTop} at ${h3.fontSize}, h2 ${h2.marginTop} at ${h2.fontSize}`,
  );
});

test("an h3 straight under an h2 stays close to it", () => {
  const [, h2, h3] = planHeadings([H1, H2, H3]).map((heading) => getComputedStyle(heading));
  assert.ok(h2 !== undefined && h3 !== undefined, "both headings stand");

  assert.ok(roomAbove(h3) < roomAbove(h2), `h3 ${h3.marginTop} under h2 ${h2.marginTop}`);
});
