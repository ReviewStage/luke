import assert from "node:assert/strict";
import { test } from "vitest";
import { PAGE_FIT, PAGE_FIT_PENDING, type PageFit, pageFitAfter } from "./page-size.js";

const STAND_IN = 240;
const SCREENFUL = 640;

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
  assert.deepEqual(fitsOver([(frame) => frame, (frame) => frame]), [fills, fills]);
  assert.deepEqual(fitsOver([() => 1900, () => 1900]), [
    { kind: PAGE_FIT.CONTENT, height: 1900 },
    { kind: PAGE_FIT.CONTENT, height: 1900 },
  ]);
  assert.deepEqual(fitsOver([() => STAND_IN, () => STAND_IN, () => STAND_IN]), [
    fills,
    { kind: PAGE_FIT.CONTENT, height: STAND_IN },
    { kind: PAGE_FIT.CONTENT, height: STAND_IN },
  ]);
});
