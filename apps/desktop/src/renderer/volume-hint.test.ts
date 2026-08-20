import assert from "node:assert/strict";
import test from "node:test";
import {
  outputSilent,
  VOLUME_HINT_REARM_MS,
  volumeHintDismissed,
  volumeHintText,
} from "./volume-hint";

test("an output nobody can read is audible, never silent", () => {
  // The hint explains a silence the helper has actually seen; a machine with
  // no helper, no device, or no controls must never be nagged from a guess.
  assert.equal(outputSilent(undefined), false);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("mute and a volume at nothing both read as silent", () => {
  assert.equal(outputSilent({ muted: true, volume: 0.6 }), true);
  assert.equal(outputSilent({ muted: false, volume: 0 }), true);
  // The margin catches a device landing a rounding error above zero.
  assert.equal(outputSilent({ muted: false, volume: 0.005 }), true);
  assert.equal(outputSilent({ muted: false, volume: 0.02 }), false);
  assert.equal(outputSilent({ muted: false, volume: 0.6 }), false);
});

test("the hint names the switch that is actually in the way", () => {
  // Telling someone to unmute a Mac whose volume is merely at zero is advice
  // that fixes nothing, so the words follow the reading.
  assert.match(volumeHintText({ muted: true, volume: 0.6 }), /unmute/i);
  assert.match(volumeHintText({ muted: false, volume: 0 }), /turn up the volume/i);
  // The fixture profile draws the hint with no reading at all; it shows the
  // mute wording, the commoner case.
  assert.match(volumeHintText(undefined), /unmute/i);
});

test("a dismissal holds for the whole stretch of silence it answered", () => {
  const dismissal = { at: 1_000, stretch: 3 };
  // All afternoon: an acknowledged mute stays acknowledged however long it
  // lasts, so time inside the same stretch never re-arms the hint.
  assert.equal(volumeHintDismissed(dismissal, 3, 1_000 + VOLUME_HINT_REARM_MS * 10), true);
});

test("a new stretch soon after is still covered, one much later is not", () => {
  const dismissal = { at: 1_000, stretch: 3 };
  // Unmuting to hear one reply and muting again is one decision, not two.
  assert.equal(volumeHintDismissed(dismissal, 4, 1_000 + VOLUME_HINT_REARM_MS - 1), true);
  // A mute taken up fresh after the rearm window is a new moment.
  assert.equal(volumeHintDismissed(dismissal, 4, 1_000 + VOLUME_HINT_REARM_MS), false);
});

test("no dismissal hides nothing", () => {
  assert.equal(volumeHintDismissed(undefined, 1, 1_000), false);
});
