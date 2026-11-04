import assert from "node:assert/strict";
import { test } from "vitest";
import { PAGE_FIT, PAGE_FIT_PENDING, type PageFit, pageFitAfter } from "./page-size.js";

/**
 * page-size.test.ts -- a page drawn in words is drawn as tall as its content,
 * and a page that only ever fills its frame is drawn at a screenful rather
 * than at the stand-in it was first framed at, without swinging between them.
 */

const STAND_IN = 240;
const SCREENFUL = 640;

/** The fit after each report, the frame standing at the height the fit before it drew. */
function fitsOver(reports: ReadonlyArray<(frame: number) => number>): PageFit[] {
  const fits: PageFit[] = [];
  let fit = PAGE_FIT_PENDING;
  let frame = STAND_IN;
  for (const report of reports) {
    fit = pageFitAfter(fit, report(frame), frame);
    fits.push(fit);
    frame =
      fit.kind === PAGE_FIT.CONTENT
        ? fit.height
        : fit.kind === PAGE_FIT.FILLS
          ? SCREENFUL
          : STAND_IN;
  }
  return fits;
}

test("a page fills a screenful when it only ever reports its frame's height, and its content's height otherwise", () => {
  const fills = { kind: PAGE_FIT.FILLS };
  // A `100vh` page answers whatever frame it stands in.
  assert.deepEqual(fitsOver([(frame) => frame, (frame) => frame]), [fills, fills]);
  // A tall page is as tall as its words, however its frame stood.
  assert.deepEqual(fitsOver([() => 1900, () => 1900]), [
    { kind: PAGE_FIT.CONTENT, height: 1900 },
    { kind: PAGE_FIT.CONTENT, height: 1900 },
  ]);
  // A page whose words match the stand-in by chance settles at its own height, never back at a screenful.
  assert.deepEqual(fitsOver([() => STAND_IN, () => STAND_IN, () => STAND_IN]), [
    fills,
    { kind: PAGE_FIT.CONTENT, height: STAND_IN },
    { kind: PAGE_FIT.CONTENT, height: STAND_IN },
  ]);
});
