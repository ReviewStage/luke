import assert from "node:assert/strict";
import test from "node:test";
import {
  frameLevel,
  startVoiceLevelMeter,
  VOICE_ACTIVITY_HANGOVER_MS,
  VOICE_LEVEL_REPORT_INTERVAL_MS,
  voiceActiveAt,
} from "./voice-level-meter";

test("a silent frame reads as the floor and a loud one as the ceiling", () => {
  assert.equal(frameLevel(new Uint8Array(256).fill(128)), 0);
  assert.equal(frameLevel(new Uint8Array(256).fill(255)), 1);
  const soft = new Uint8Array(256).fill(128);
  for (let index = 0; index < soft.length; index += 2) soft[index] = 140;
  const level = frameLevel(soft);
  assert.ok(level > 0 && level < 1);
});

test("a voice stays active for the hangover after its last loud frame", () => {
  assert.equal(voiceActiveAt(1_000, 1_000), true);
  assert.equal(voiceActiveAt(1_000 + VOICE_ACTIVITY_HANGOVER_MS - 1, 1_000), true);
  assert.equal(voiceActiveAt(1_000 + VOICE_ACTIVITY_HANGOVER_MS, 1_000), false);
});

/** An audio graph that answers with whatever samples the test sets next. */
function fakeAudio(samplesNow: () => number) {
  const disconnected: number[] = [];
  const analyser = {
    fftSize: 0,
    smoothingTimeConstant: 0,
    getByteTimeDomainData(target: Uint8Array) {
      target.fill(samplesNow());
    },
  };
  const context = {
    state: "running",
    resume: () => Promise.resolve(),
    createMediaStreamSource: () => ({
      connect: () => undefined,
      disconnect: () => disconnected.push(1),
    }),
    createAnalyser: () => analyser,
  };
  return {
    // SAFETY: The meter reads only the members this fake provides.
    context: context as unknown as AudioContext,
    disconnected,
  };
}

test("the meter reports the voice's edges beside the stream and the level at a bounded rate", () => {
  let sample = 128;
  let now = 0;
  const frames: Array<() => void> = [];
  const activity: boolean[] = [];
  const levels: number[] = [];
  const audio = fakeAudio(() => sample);
  const stop = startVoiceLevelMeter({
    // SAFETY: The fake source never reads the stream.
    stream: {} as MediaStream,
    audioContext: audio.context,
    onActivity: (active) => activity.push(active),
    onLevel: (level) => levels.push(level),
    now: () => now,
    requestFrame: (callback) => frames.push(callback),
    cancelFrame: () => frames.splice(0),
  });
  const tick = (advance: number) => {
    now += advance;
    frames.shift()?.();
  };

  // Silence: one level report, no edge.
  tick(0);
  assert.deepEqual(activity, []);
  assert.equal(levels.length, 1);
  // Loud frames inside one report interval: the voice edge lands at once, the
  // level only once the interval has passed.
  sample = 255;
  tick(10);
  assert.deepEqual(activity, [true]);
  assert.equal(levels.length, 1);
  tick(VOICE_LEVEL_REPORT_INTERVAL_MS);
  assert.equal(levels.length, 2);
  assert.equal(levels.at(-1), 1);
  // Quiet again: the voice holds through the hangover, then drops once.
  sample = 128;
  tick(VOICE_ACTIVITY_HANGOVER_MS - 1);
  assert.deepEqual(activity, [true]);
  tick(2);
  assert.deepEqual(activity, [true, false]);

  // Teardown disconnects the graph and reports the voice gone once more, so a
  // stream that leaves mid-word still ends the turn it was holding.
  stop();
  assert.equal(audio.disconnected.length, 1);
  assert.deepEqual(activity, [true, false, false]);
  assert.equal(frames.length, 0);
});
