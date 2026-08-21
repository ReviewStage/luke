import assert from "node:assert/strict";
import test from "node:test";
import { REPLAY_BLOCK_CLASS, REPLAY_MASKING } from "./session-replay-masking";

/**
 * A recording has no allowlist behind it the way a counted event does: what it
 * shows is decided entirely by this configuration, so these assertions are the
 * privacy boundary written down. A change that fails one of them is a change
 * to what `PRIVACY.md` promises.
 */

test("text is masked everywhere, with nothing able to opt out", () => {
  // `"*"` is what makes a component added later silent without anyone
  // remembering to mark it. A narrower selector here would turn the posture
  // into a blocklist, where forgetting is the failure mode.
  assert.equal(REPLAY_MASKING.maskTextSelector, "*");
  assert.equal(REPLAY_MASKING.maskAllInputs, true);
});

test("credentials are blocked rather than masked, so no length travels", () => {
  assert.equal(REPLAY_MASKING.blockSelector, `.${REPLAY_BLOCK_CLASS}`);
});

test("the attributes that can carry a session's own words are emptied", () => {
  const { maskAttributeFn } = REPLAY_MASKING;
  // Text masking does not reach attributes, and these are where a row's own
  // title survives being drawn as blocks.
  for (const name of ["aria-label", "title", "placeholder", "alt", "value"]) {
    assert.equal(maskAttributeFn(name, "codex — luke on feature/x"), "", name);
    assert.equal(maskAttributeFn(name.toUpperCase(), "a recap"), "", name);
  }
});

test("the attributes a recording needs to be readable at all survive", () => {
  const { maskAttributeFn } = REPLAY_MASKING;
  // `maskAllElementAttributes` would take these too, which is why it is not
  // used: without them a recording is not masked, it is unwatchable.
  for (const name of ["class", "style", "id", "type", "role"]) {
    assert.equal(maskAttributeFn(name, "settings-row"), "settings-row", name);
  }
});

test("no canvas is recorded, because no text rule reaches pixels", () => {
  assert.equal(REPLAY_MASKING.captureCanvas.recordCanvas, false);
});
