import assert from "node:assert/strict";
import test from "node:test";
import { VoiceReceiver } from "./voice-receiver";

test("a receiver begins unready and becomes ready only on the current epoch's report", () => {
  const receiver = new VoiceReceiver();
  const readyEpochs: number[] = [];
  receiver.onReady((epoch) => readyEpochs.push(epoch));
  assert.equal(receiver.isReady(), false);
  // A report before any load names an epoch that never was.
  assert.equal(receiver.markReady(0), false);
  const epoch = receiver.begin();
  assert.equal(receiver.isReady(), false);
  // A stale or future epoch readies nothing.
  assert.equal(receiver.markReady(epoch - 1), false);
  assert.equal(receiver.markReady(epoch + 1), false);
  assert.equal(receiver.isReady(), false);
  assert.equal(receiver.markReady(epoch), true);
  assert.equal(receiver.isReady(), true);
  // A repeat of the same report changes nothing and fires nothing again.
  assert.equal(receiver.markReady(epoch), false);
  assert.deepEqual(readyEpochs, [epoch]);
});

test("every reload, replacement, or close ends the epoch and makes the receiver unready", () => {
  const receiver = new VoiceReceiver();
  const resets: number[] = [];
  receiver.onReset((epoch) => resets.push(epoch));
  const first = receiver.begin();
  receiver.markReady(first);
  // A navigation begins a new epoch: the old renderer's readiness dies with it.
  const second = receiver.begin();
  assert.notEqual(second, first);
  assert.equal(receiver.isReady(), false);
  // The old renderer's late report is refused.
  assert.equal(receiver.markReady(first), false);
  assert.equal(receiver.markReady(second), true);
  // A close ends the epoch without beginning a renderer.
  receiver.reset();
  assert.equal(receiver.isReady(), false);
  assert.equal(receiver.markReady(second), false);
  // Every ending was announced with the epoch that ended.
  assert.deepEqual(resets, [0, first, second]);
});

test("a ready listener removed hears nothing more", () => {
  const receiver = new VoiceReceiver();
  const heard: number[] = [];
  const stop = receiver.onReady((epoch) => heard.push(epoch));
  const epoch = receiver.begin();
  stop();
  receiver.markReady(epoch);
  assert.deepEqual(heard, []);
});
