// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { ANNOTATION_BAND_ATTRIBUTE, markAnnotationBands } from "./annotation-bands.js";

/**
 * annotation-bands.test.ts -- a note under an added or removed line is
 * marked with that line's band, its row and its buffer in the numbers'
 * column alike; a note under an unchanged line is not, and a diff drawn
 * with no backgrounds marks none, taking off any mark it wore before.
 *
 * The markup is Pierre's as it draws a unified diff with two notes, one
 * under an unchanged line and one under an added line (`@pierre/diffs`
 * 1.5.2's `pushLineWithAnnotation`).
 */

afterEach(() => {
  document.body.replaceChildren();
});

/** A file's shadow root as Pierre draws it, with backgrounds on or off. */
function drawn(backgrounds: boolean): ShadowRoot {
  const host = document.body.appendChild(document.createElement("div"));
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = [
    `<pre data-diff ${backgrounds ? "data-background" : ""} data-indicators="bars"><code data-code>`,
    "<div data-gutter>",
    '<div data-line-type="context" data-column-number="9"></div>',
    '<div data-gutter-buffer="annotation"></div>',
    '<div data-line-type="change-deletion" data-column-number="10"></div>',
    '<div data-gutter-buffer="annotation"></div>',
    '<div data-line-type="change-addition" data-column-number="10"></div>',
    '<div data-gutter-buffer="annotation"></div>',
    "</div>",
    "<div data-content>",
    '<div data-line="9" data-line-type="context"></div>',
    '<div data-line-annotation="0,8"><div data-annotation-content><slot name="annotation-additions-9"></slot></div></div>',
    '<div data-line="10" data-line-type="change-deletion"></div>',
    '<div data-line-annotation="0,9"><div data-annotation-content><slot name="annotation-deletions-10"></slot></div></div>',
    '<div data-line="10" data-line-type="change-addition"></div>',
    '<div data-line-annotation="0,10"><div data-annotation-content><slot name="annotation-additions-10"></slot></div></div>',
    "</div>",
    "</code></pre>",
  ].join("");
  return root;
}

/** The band each note's row and its numbers' buffer wear, in order. */
function bands(root: ShadowRoot) {
  const of = (selector: string) =>
    [...root.querySelectorAll(selector)].map((each) =>
      each.getAttribute(ANNOTATION_BAND_ATTRIBUTE),
    );
  return { rows: of("[data-line-annotation]"), buffers: of('[data-gutter-buffer="annotation"]') };
}

test("a note under a changed line continues its band, its row and its numbers alike, and one under an unchanged line does not", () => {
  const root = drawn(true);
  markAnnotationBands(root);
  assert.deepEqual(bands(root), {
    rows: [null, "deletion", "addition"],
    buffers: [null, "deletion", "addition"],
  });
});

test("with backgrounds off no note continues a band, and a mark worn before is taken off", () => {
  const root = drawn(true);
  markAnnotationBands(root);
  root.querySelector("pre")?.removeAttribute("data-background");
  markAnnotationBands(root);
  assert.deepEqual(bands(root), { rows: [null, null, null], buffers: [null, null, null] });
});
