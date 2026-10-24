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

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

/** A plan document holding one heading of each of the first three levels, the sheets laid. */
function planHeadings(): readonly Element[] {
  layContainersAt(
    {},
    { only: ["@luke/ui/tokens.css", "@luke/ui/styles.css", "./tasks.css", "./desktop.css"] },
  );
  const plan = document.body.appendChild(document.createElement("section"));
  plan.className = "desktop-document";
  plan.innerHTML = [
    '<div class="plan-body"><div class="luke-markdown">',
    '<h1 class="luke-markdown-heading" data-level="1">Goal</h1>',
    '<h2 class="luke-markdown-heading" data-level="2">Approach</h2>',
    '<h3 class="luke-markdown-heading" data-level="3">Open questions</h3>',
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
