import assert from "node:assert/strict";
import { test } from "vitest";
import { WAVEFORM_VOICE, waveformLive } from "./waveform";

test("a meter follows a voice frame by frame only when it is live and not a fixture", () => {
  assert.equal(waveformLive({ voice: WAVEFORM_VOICE.LUKE, speaking: false }), true);
  assert.equal(waveformLive({ voice: WAVEFORM_VOICE.DEVELOPER, speaking: false }), true);
  // A fixture meter is drawn as a speaker, coloured as one, and still static.
  assert.equal(waveformLive({ voice: WAVEFORM_VOICE.LUKE, speaking: true }), false);
  assert.equal(waveformLive({ voice: WAVEFORM_VOICE.DEVELOPER, speaking: true }), false);
  assert.equal(waveformLive({ voice: undefined, speaking: false }), false);
});
