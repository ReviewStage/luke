import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPTION_LINE_HEIGHT,
  CAPTION_LINE_READ_MS,
  captionHoldMs,
  captionReadingMs,
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

test("reading time covers every line, part-lines included", () => {
  // A partial line is a line: it still has to be read.
  assert.equal(captionReadingMs(CAPTION_LINE_HEIGHT * 4), CAPTION_LINE_READ_MS * 4);
  assert.equal(captionReadingMs(CAPTION_LINE_HEIGHT * 4 + 1), CAPTION_LINE_READ_MS * 5);
});

test("a reply that outlived the reading owes no hold", () => {
  // The common case: speech is slower than reading, so by the time the reply
  // ends the clock has already run out and the words leave as they always did.
  const height = CAPTION_LINE_HEIGHT * 4;
  const hold = captionHoldMs({
    outputSilent: true,
    interrupted: false,
    textHeight: height,
    elapsedMs: captionReadingMs(height),
  });
  assert.equal(hold, 0);
});

test("a reply ending mid-read is held for exactly the remainder", () => {
  const height = CAPTION_LINE_HEIGHT * 6;
  const elapsed = CAPTION_LINE_READ_MS * 2;
  const hold = captionHoldMs({
    outputSilent: true,
    interrupted: false,
    textHeight: height,
    elapsedMs: elapsed,
  });
  assert.equal(hold, captionReadingMs(height) - elapsed);
});

test("an audible output, an interruption, or an unmeasured caption owes nothing", () => {
  const unread = { textHeight: CAPTION_LINE_HEIGHT * 6, elapsedMs: 0 };
  // Heard words were already delivered by the voice.
  assert.equal(captionHoldMs({ outputSilent: false, interrupted: false, ...unread }), 0);
  // Stop means stop — a reply the user cut is not owed a hold.
  assert.equal(captionHoldMs({ outputSilent: true, interrupted: true, ...unread }), 0);
  // The hold covers lines the clock knows about; it never guesses.
  assert.equal(
    captionHoldMs({ outputSilent: true, interrupted: false, textHeight: undefined, elapsedMs: 0 }),
    0,
  );
});
