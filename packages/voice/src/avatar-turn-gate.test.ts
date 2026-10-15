import { describe, expect, it } from "vitest";
import { AVATAR_FEED_KIND, type AvatarFeed } from "./avatar.js";
import { PCM_CHUNK_SAMPLES } from "./avatar-pcm.js";
import {
  closeTurnGate,
  stepTurnGate,
  TURN_GATE,
  TURN_GATE_IDLE,
  type TurnGate,
} from "./avatar-turn-gate.js";

/** Samples of a 10 ms frame, from Spike 0's measurements of TTS through Opus. */
const SPEECH_P10 = 69; // 2.1e-3 RMS, the quietest tenth of speech frames
const ABOVE_NOISE_FLOOR = 1; // -90 dBFS, louder than Opus's -99 dBFS floor with DTX on

/**
 * A 40 ms chunk at one constant level, with the chunk's tag in its first
 * sample so a test can tell chunks apart. A tag's own energy is under the
 * threshold over a 10 ms frame, so it opens nothing.
 */
function chunkAt(level: number, tag: number): Int16Array {
  const chunk = new Int16Array(PCM_CHUNK_SAMPLES).fill(level);
  chunk[0] = tag;
  return chunk;
}

const loud = (tag: number) => chunkAt(4_000, tag);
const quiet = (tag: number) => chunkAt(0, tag);

/** Runs chunks through the gate from idle, answering every feed and the gate at the end. */
function run(chunks: readonly Int16Array[], from: TurnGate = TURN_GATE_IDLE) {
  let gate = from;
  const feeds: AvatarFeed[] = [];
  for (const chunk of chunks) {
    const step = stepTurnGate(gate, chunk);
    gate = step.gate;
    feeds.push(...step.feeds);
  }
  return { gate, feeds };
}

/** An `audio` feed's samples, read back as little-endian PCM16 independently of the encoder. */
function samplesOf(feed: AvatarFeed | undefined): number[] {
  if (feed?.kind !== AVATAR_FEED_KIND.AUDIO) throw new Error(`expected audio, got ${feed?.kind}`);
  const bytes = Buffer.from(feed.pcm, "base64");
  return Array.from({ length: bytes.length / 2 }, (_, index) => bytes.readInt16LE(index * 2));
}

/** What a run sent, one entry per feed: an audio chunk's tag, or the feed's kind. */
function sent(feeds: readonly AvatarFeed[]): (number | string)[] {
  return feeds.map((feed) =>
    feed.kind === AVATAR_FEED_KIND.AUDIO ? (samplesOf(feed)[0] ?? Number.NaN) : feed.kind,
  );
}

const QUIET_CHUNKS = TURN_GATE.QUIET_SAMPLES / PCM_CHUNK_SAMPLES;

describe("the turn gate", () => {
  it("sends nothing over the Opus noise floor", () => {
    const floor = Array.from({ length: 50 }, (_, index) => chunkAt(ABOVE_NOISE_FLOOR, index % 20));
    expect(run(floor).feeds).toEqual([]);
  });

  it("opens a turn on the quietest speech frames", () => {
    expect(sent(run([chunkAt(SPEECH_P10, 9)]).feeds)).toEqual([9]);
  });

  it("opens a turn on one loud 10 ms frame, its whole chunk sent", () => {
    const chunk = quiet(3);
    chunk.fill(4_000, 3 * TURN_GATE.FRAME_SAMPLES);
    expect(sent(run([chunk]).feeds)).toEqual([3]);
  });

  it("opens a turn with 200 ms of the quiet just before it, oldest first", () => {
    const before = Array.from({ length: 8 }, (_, index) => quiet(index + 1));
    // 200 ms is five 40 ms chunks: the three oldest quiet chunks fell out of the pre-roll.
    expect(sent(run([...before, loud(100)]).feeds)).toEqual([4, 5, 6, 7, 8, 100]);
  });

  it("sends a turn's whole chunk, samples intact, as PCM16LE", () => {
    const samples = samplesOf(run([loud(-7)]).feeds[0]);
    expect(samples).toHaveLength(960);
    expect(samples[0]).toBe(-7);
    expect(samples[959]).toBe(4_000);
  });

  it("ends the turn after the quiet, the quiet chunks sent along the way", () => {
    const pause = Array.from({ length: QUIET_CHUNKS }, (_, index) => quiet(200 + index));
    const { gate, feeds } = run([loud(1), ...pause]);
    expect(sent(feeds)).toEqual([1, ...pause.map((chunk) => chunk[0]), AVATAR_FEED_KIND.TURN_END]);
    expect(gate.open).toBe(false);
  });

  it("keeps the turn through a pause one chunk shorter than the quiet", () => {
    const pause = Array.from({ length: QUIET_CHUNKS - 1 }, (_, index) => quiet(200 + index));
    const { gate, feeds } = run([loud(1), ...pause, loud(2)]);
    expect(sent(feeds)).not.toContain(AVATAR_FEED_KIND.TURN_END);
    expect(sent(feeds).at(-1)).toBe(2);
    expect(gate.open).toBe(true);
  });

  it("ends the turn before a chunk whose early frames finish the quiet and whose last frame speaks", () => {
    // The tail's last three frames, 19 quiet chunks, and this chunk's first frame make the whole quiet.
    const tail = loud(1);
    tail.fill(0, TURN_GATE.FRAME_SAMPLES);
    const pause = Array.from({ length: QUIET_CHUNKS - 1 }, (_, index) => quiet(200 + index));
    const resumed = quiet(300);
    resumed.fill(4_000, 3 * TURN_GATE.FRAME_SAMPLES);
    const { gate, feeds } = run([tail, ...pause, resumed]);
    expect(sent(feeds).slice(-2)).toEqual([AVATAR_FEED_KIND.TURN_END, 300]);
    expect(gate.open).toBe(true);
  });

  it("owes a turn_end for a turn still open when the feed stops, and nothing otherwise", () => {
    expect(closeTurnGate(run([loud(1)]).gate)).toEqual([{ kind: AVATAR_FEED_KIND.TURN_END }]);
    expect(closeTurnGate(run([quiet(1)]).gate)).toEqual([]);
  });
});
