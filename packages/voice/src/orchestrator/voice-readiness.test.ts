import assert from "node:assert/strict";
import test from "node:test";
import { VOICE_READINESS_PART, VoiceReadiness } from "./voice-readiness.js";

const EVERY_PART = Object.values(VOICE_READINESS_PART);

test("the readiness report names the epoch the document gave this load, whichever raced first", () => {
  const reported: number[] = [];
  const readiness = new VoiceReadiness((epoch) => reported.push(epoch));
  // Every subscription stood before the document was adopted, as when a
  // version of it lands first: nothing is reported until the epoch lands.
  for (const part of EVERY_PART) readiness.installed(part);
  assert.deepEqual(reported, []);
  readiness.bootstrapped(3);
  assert.deepEqual(reported, [3]);

  // The other order — the document adopted first, subscriptions after —
  // reports once too, under the same epoch, and a later epoch cannot
  // re-report a settled window.
  const late: number[] = [];
  const lateReadiness = new VoiceReadiness((epoch) => late.push(epoch));
  lateReadiness.bootstrapped(3);
  assert.deepEqual(late, []);
  for (const part of EVERY_PART) lateReadiness.installed(part);
  assert.deepEqual(late, [3]);
  lateReadiness.bootstrapped(4);
  assert.deepEqual(late, [3]);
});

test("readiness is reported once, only when every subscription stands and the bootstrap has named the epoch", () => {
  const reported: number[] = [];
  const readiness = new VoiceReadiness((epoch) => reported.push(epoch));
  // Subscriptions in whatever order React installs them, the bootstrap last.
  for (const part of EVERY_PART) readiness.installed(part);
  assert.equal(readiness.complete, false);
  assert.deepEqual(reported, []);
  readiness.bootstrapped(7);
  assert.equal(readiness.complete, true);
  assert.deepEqual(reported, [7]);
  // Nothing re-reports: not a repeated install, not a repeated bootstrap.
  readiness.installed(VOICE_READINESS_PART.COMMANDS);
  readiness.bootstrapped(7);
  assert.deepEqual(reported, [7]);
});

test("a bootstrap that lands before the last subscription waits for it", () => {
  const reported: number[] = [];
  const readiness = new VoiceReadiness((epoch) => reported.push(epoch));
  readiness.bootstrapped(3);
  for (const part of EVERY_PART.slice(1)) readiness.installed(part);
  assert.equal(reported.length, 0);
  readiness.installed(VOICE_READINESS_PART.COMMANDS);
  assert.deepEqual(reported, [3]);
});

test("a bootstrap naming no epoch — a panel's — never readies a voice receiver", () => {
  const reported: number[] = [];
  const readiness = new VoiceReadiness((epoch) => reported.push(epoch));
  for (const part of EVERY_PART) readiness.installed(part);
  readiness.bootstrapped(undefined);
  assert.equal(readiness.complete, false);
  assert.deepEqual(reported, []);
});

test("a subscription torn down after the report is not re-reported when it comes back", () => {
  const reported: number[] = [];
  const readiness = new VoiceReadiness((epoch) => reported.push(epoch));
  for (const part of EVERY_PART) readiness.installed(part);
  readiness.bootstrapped(1);
  readiness.uninstalled(VOICE_READINESS_PART.SPEECH_OFFERS);
  assert.equal(readiness.complete, false);
  readiness.installed(VOICE_READINESS_PART.SPEECH_OFFERS);
  assert.deepEqual(reported, [1]);
});
