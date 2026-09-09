import assert from "node:assert/strict";
import test from "node:test";
import type { ScheduledTimer } from "@sidecar/runtime/vocabulary";
import { NoticeStrip, VOICE_ERROR_NOTICE_MS } from "./notice-strip.js";

function strip() {
  const expiries: { at: number; fire: () => void }[] = [];
  const cancelled: ScheduledTimer[] = [];
  let changes = 0;
  const subject = new NoticeStrip({
    onChanged: () => {
      changes += 1;
    },
    schedule: (fire, at) => {
      expiries.push({ at, fire });
      return expiries.length;
    },
    cancel: (timer) => cancelled.push(timer),
  });
  return { subject, expiries, cancelled, changes: () => changes };
}

test("the strip takes no pointer, so time is what dismisses a fault", () => {
  const { subject, expiries } = strip();
  subject.showError("The talk key needs the microphone.");
  assert.equal(expiries.length, 1);
  assert.equal(expiries[0]?.at, VOICE_ERROR_NOTICE_MS);
  expiries[0]?.fire();
  assert.equal(subject.error, undefined);
});

test("a new message is a new thing to read, so it re-arms the clock", () => {
  const { subject, expiries, cancelled } = strip();
  subject.showError("First.");
  subject.showError("Second.");
  assert.equal(subject.error, "Second.");
  assert.deepEqual(cancelled, [1]);
  assert.equal(expiries.length, 2);
});

test("the two lines share the strip but not each other's clock", () => {
  const { subject, expiries } = strip();
  subject.showError("A fault.");
  subject.showNotice("Temporarily unavailable.");
  // The error's clock ends the error alone.
  expiries[0]?.fire();
  assert.equal(subject.error, undefined);
  assert.equal(subject.notice, "Temporarily unavailable.");
});

test("an exchange going live outranks whichever clock either line was on", () => {
  const { subject, cancelled } = strip();
  subject.showError("A fault.");
  subject.showNotice("Temporarily unavailable.");
  subject.clear();
  assert.equal(subject.error, undefined);
  assert.equal(subject.notice, undefined);
  assert.deepEqual(cancelled, [1, 2]);
});
