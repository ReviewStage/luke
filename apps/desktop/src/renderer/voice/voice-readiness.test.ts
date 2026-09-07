import assert from "node:assert/strict";
import test from "node:test";
import { VOICE_READINESS_PART, VoiceReadiness } from "./voice-readiness";

const EVERY_PART = Object.values(VOICE_READINESS_PART);

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
