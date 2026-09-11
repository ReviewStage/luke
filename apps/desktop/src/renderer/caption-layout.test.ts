import assert from "node:assert/strict";
import { VOICE_CAPTION_MAX_HEIGHT } from "@sidecar/surface";
import { test } from "vitest";
import { captionBlockSize, captionSegments, captionStackOverflow } from "./caption-layout";
import { VOLUME_HINT_BAND_HEIGHT } from "./volume-hint";

const PADDING = 12;

test("the block grows to the words until it meets the room the window reserved", () => {
  assert.equal(captionBlockSize(40, false, PADDING), 40 + PADDING);
  assert.equal(
    captionBlockSize(VOICE_CAPTION_MAX_HEIGHT, false, PADDING),
    VOICE_CAPTION_MAX_HEIGHT,
  );
  assert.equal(captionBlockSize(1000, false, PADDING), VOICE_CAPTION_MAX_HEIGHT);
});

test("the volume hint's band comes off the block's maximum, never off the words", () => {
  const room = VOICE_CAPTION_MAX_HEIGHT - VOLUME_HINT_BAND_HEIGHT;
  assert.equal(captionBlockSize(40, true, PADDING), 40 + PADDING);
  assert.equal(captionBlockSize(1000, true, PADDING), room);
});

test("a stack that fits rolls nowhere", () => {
  assert.equal(captionStackOverflow(40, false, PADDING), 0);
  // Exactly filling the room is still fitting: the bound is inclusive.
  assert.equal(captionStackOverflow(VOICE_CAPTION_MAX_HEIGHT - PADDING, false, PADDING), 0);
});

test("a stack past the room rolls up by exactly what will not fit", () => {
  // The padding above the words is spent before any line is, so the overflow
  // is the words' excess alone: the newest line ends at the block's foot.
  const words = VOICE_CAPTION_MAX_HEIGHT - PADDING + 28;
  assert.equal(captionStackOverflow(words, false, PADDING), 28);
  // Every line arriving past the bound rolls the stack one line further; the
  // block itself has stopped growing.
  assert.equal(captionStackOverflow(words + 14, false, PADDING), 42);
  assert.equal(captionBlockSize(words + 14, false, PADDING), VOICE_CAPTION_MAX_HEIGHT);
});

test("the hint's band brings the roll forward by its own height", () => {
  const words = VOICE_CAPTION_MAX_HEIGHT - PADDING + 28;
  assert.equal(captionStackOverflow(words, true, PADDING), 28 + VOLUME_HINT_BAND_HEIGHT);
});

test("the newest segment is the live one whatever the count", () => {
  assert.deepEqual(captionSegments(undefined), { settled: [], live: undefined });
  assert.deepEqual(captionSegments([]), { settled: [], live: undefined });
  assert.deepEqual(captionSegments(["Only one."]), { settled: [], live: "Only one." });
  assert.deepEqual(captionSegments(["First.", "Second."]), {
    settled: ["First."],
    live: "Second.",
  });
  assert.deepEqual(captionSegments(["First.", "Second.", "Third.", "Fourth."]), {
    settled: ["First.", "Second.", "Third."],
    live: "Fourth.",
  });
});
