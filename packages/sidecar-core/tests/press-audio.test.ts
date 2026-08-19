import assert from "node:assert/strict";
import test from "node:test";
import { MAXIMUM_PRESS_AUDIO_MS, PRESS_AUDIO_SAMPLE_RATE, PressAudioBuffer } from "../src";

/** A chunk whose samples are all one value, so provenance survives a trim. */
function chunk(samples: number, value: number): Int16Array {
  return new Int16Array(samples).fill(value);
}

test("chunks drain in capture order and draining empties the buffer", () => {
  const buffer = new PressAudioBuffer();
  buffer.push(chunk(3, 1));
  buffer.push(chunk(2, 2));

  const drained = buffer.drain();
  assert.deepEqual(
    drained.map((piece) => [...piece]),
    [
      [1, 1, 1],
      [2, 2],
    ],
  );
  assert.equal(buffer.isEmpty, true);
  assert.deepEqual(buffer.drain(), []);
});

test("the buffered duration is counted at the capture rate", () => {
  const buffer = new PressAudioBuffer();
  buffer.push(chunk(PRESS_AUDIO_SAMPLE_RATE, 0));
  assert.equal(buffer.bufferedMs, 1_000);

  buffer.push(chunk(PRESS_AUDIO_SAMPLE_RATE / 2, 0));
  assert.equal(buffer.bufferedMs, 1_500);
});

test("an empty chunk is not a chunk", () => {
  const buffer = new PressAudioBuffer();
  buffer.push(new Int16Array(0));
  assert.equal(buffer.isEmpty, true);
});

test("overflow drops the oldest audio, so what survives ends at the newest word", () => {
  // A press held into a stuck connect must not grow memory without bound —
  // the mint ahead of the handshake has no deadline of its own — so the
  // ceiling is hard, and it is the oldest audio that goes: what survives is
  // one continuous stretch that flows into the live turn at the seam, and the
  // opening of a sentence spoken into a thirty-second stall is the least
  // recoverable part of it.
  const buffer = new PressAudioBuffer({ maximumMs: 1_000 });
  const second = PRESS_AUDIO_SAMPLE_RATE;
  buffer.push(chunk(second / 2, 1));
  buffer.push(chunk(second / 2, 2));
  buffer.push(chunk(second / 2, 3));

  assert.equal(buffer.bufferedMs, 1_000);
  assert.equal(buffer.droppedMs, 500);
  assert.deepEqual(
    buffer.drain().map((piece) => piece[0]),
    [2, 3],
  );
});

test("the ceiling is exact even when it falls inside a chunk", () => {
  const buffer = new PressAudioBuffer({ maximumMs: 1_000 });
  const second = PRESS_AUDIO_SAMPLE_RATE;
  const numbered = new Int16Array(second);
  for (let index = 0; index < second; index += 1) numbered[index] = index % 32_000;
  buffer.push(numbered);
  buffer.push(chunk(second / 4, 9));

  assert.equal(buffer.bufferedMs, 1_000);
  assert.equal(buffer.droppedMs, 250);
  const drained = buffer.drain();
  // The oldest chunk lost exactly its first quarter — the trim is within the
  // chunk, not of it — and the newer chunk is untouched.
  assert.equal(drained[0]?.length, (second * 3) / 4);
  assert.equal(drained[0]?.[0], (second / 4) % 32_000);
  assert.equal(drained[1]?.length, second / 4);
});

test("a chunk larger than the whole ceiling keeps only its newest samples", () => {
  const buffer = new PressAudioBuffer({ maximumMs: 100 });
  const ceiling = (PRESS_AUDIO_SAMPLE_RATE * 100) / 1_000;
  buffer.push(chunk(ceiling * 3, 7));

  assert.equal(buffer.bufferedMs, 100);
  assert.equal(buffer.droppedMs, 200);
  assert.equal(buffer.drain()[0]?.length, ceiling);
});

test("the default ceiling outlasts the connect deadline it exists to survive", () => {
  // Thirty seconds: twice the handshake's own deadline, because the mint
  // ahead of the handshake answers to no deadline at all.
  assert.equal(MAXIMUM_PRESS_AUDIO_MS, 30_000);
  const buffer = new PressAudioBuffer();
  buffer.push(chunk(PRESS_AUDIO_SAMPLE_RATE * 31, 0));
  assert.equal(buffer.bufferedMs, 30_000);
  assert.equal(buffer.droppedMs, 1_000);
});
