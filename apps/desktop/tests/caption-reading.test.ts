import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPTION_LINE_HEIGHT,
  CAPTION_LINE_READ_MS,
  pacedCaptionScroll,
} from "../src/renderer/caption-reading";

// Four lines of overflow: the shape a long announcement leaves once the block
// is full.
const FOUR_LINES = CAPTION_LINE_HEIGHT * 4;

test("a silent caption scrolls one line per reading interval", () => {
  // The first line may leave only once a reader could have finished it; until
  // then the words hold, however fast the text behind them streamed in.
  assert.equal(pacedCaptionScroll(FOUR_LINES, 0), 0);
  assert.equal(pacedCaptionScroll(FOUR_LINES, CAPTION_LINE_READ_MS - 1), 0);
  assert.equal(pacedCaptionScroll(FOUR_LINES, CAPTION_LINE_READ_MS), CAPTION_LINE_HEIGHT);
  assert.equal(pacedCaptionScroll(FOUR_LINES, CAPTION_LINE_READ_MS * 3), CAPTION_LINE_HEIGHT * 3);
});

test("the reading pace never scrolls past the overflow the block has", () => {
  // The clock keeps counting after the last line has scrolled into place; the
  // scroll must not follow it off the end of the text.
  assert.equal(pacedCaptionScroll(FOUR_LINES, CAPTION_LINE_READ_MS * 100), FOUR_LINES);
  // A caption that fits its block has nothing to scroll at any elapsed time.
  assert.equal(pacedCaptionScroll(0, CAPTION_LINE_READ_MS * 100), 0);
});
