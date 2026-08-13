import assert from "node:assert/strict";
import test from "node:test";
import { microphoneAccessRow } from "../src/renderer/microphone-access";

test("access is offered only where it can be used", () => {
  const offered = microphoneAccessRow({
    voiceAvailable: true,
    allowed: true,
    status: "not-determined",
  });
  assert.equal(offered.offerAccess, true);
  assert.match(offered.detail, /talk key/);

  // The macOS prompt is where someone agrees to their voice reaching OpenAI.
  // Raising it for a feature that cannot run asks for that consent under a
  // premise that is not true, and leaves the permission granted for a use that
  // never happens.
  const unavailable = microphoneAccessRow({
    voiceAvailable: false,
    allowed: true,
    status: "not-determined",
  });
  assert.equal(unavailable.offerAccess, false);
  assert.ok(!unavailable.detail.includes("macOS will ask"));
});

test("a permission already granted is not a microphone in use", () => {
  assert.equal(
    microphoneAccessRow({ voiceAvailable: true, allowed: true, status: "granted" }).ready,
    true,
  );
  // Granted before the key went away. Luke still cannot talk, so the row must
  // not report itself ready to listen.
  assert.equal(
    microphoneAccessRow({ voiceAvailable: false, allowed: true, status: "granted" }).ready,
    false,
  );
});

test("every permission state says something of its own", () => {
  const states = ["not-determined", "granted", "denied", "restricted", "unknown"] as const;
  const details = new Set<string>();
  for (const status of states) {
    const row = microphoneAccessRow({ voiceAvailable: true, allowed: true, status });
    details.add(row.detail);
    // Only the two states someone can act on offer anything to press.
    assert.equal(row.offerAccess, status === "not-determined");
  }
  assert.equal(details.size, states.length, "no two states read the same");
});

test("taking the microphone back offers a way to give it again", () => {
  const held = microphoneAccessRow({ voiceAvailable: true, allowed: true, status: "granted" });
  assert.equal(held.ready, true);
  assert.equal(held.offerRevoke, true, "something held can be given back");
  assert.equal(held.offerAccess, false);

  const taken = microphoneAccessRow({ voiceAvailable: true, allowed: false, status: "granted" });
  // Revoking is not a dead end: the row returns to asking, the way it read
  // before anything was granted.
  assert.equal(taken.offerAccess, true);
  assert.equal(taken.offerRevoke, false);
  assert.equal(taken.ready, false, "held by the system is not held by Luke");
});

test("a permission Luke does not hold is not one it can hand back", () => {
  for (const status of ["not-determined", "denied", "restricted", "unknown"] as const) {
    const row = microphoneAccessRow({ voiceAvailable: true, allowed: true, status });
    assert.equal(row.offerRevoke, false, `${status} has nothing to revoke`);
    assert.equal(row.ready, false);
  }
});

test("what Luke withholds is said as its own doing, not the system's", () => {
  const taken = microphoneAccessRow({ voiceAvailable: true, allowed: false, status: "granted" });

  // macOS grants the device to the app and only the user can take that back in
  // System Settings. A row that claimed otherwise would describe something that
  // did not happen, and leave a grant standing that the reader thought was gone.
  assert.match(taken.detail, /macOS still lists/i);
});
