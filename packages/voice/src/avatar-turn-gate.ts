/**
 * avatar-turn-gate.ts -- splits Luke's PCM chunks into avatar turns on loudness alone, counting samples rather than arming timers.
 *
 * GPT Live emits no turn or done events, so a turn is read off the audio the
 * way LiveKit's GPT Live plugin reads one: a 10 ms frame whose RMS reaches
 * the threshold opens a turn at the chunk it falls in, the quiet chunks just
 * before it ride along as pre-roll so a soft onset is not clipped, and enough
 * quiet frames in a row close it with `turn_end` after the chunk the quiet
 * completes in. Time is the samples themselves, so the gate is a pure
 * function over chunks and a test needs no clock.
 */

import { Base64 } from "effect/encoding";
import { AVATAR_FEED_KIND, type AvatarFeed } from "./avatar.js";
import { PCM_SAMPLE_RATE } from "./avatar-pcm.js";

/**
 * Spike 0 measured these on TTS through a Chrome Opus loopback, not on GPT
 * Live, and they are to be re-checked on a real GPT Live capture on a Mac.
 * The noise floor after Opus was -109 dBFS (DTX off) or -99 dBFS (DTX on),
 * an Opus tail fell under 1e-4 within 40 ms, and the 10th percentile of a
 * speech frame's RMS was 2.1e-3, so -60 dBFS sits between the two with room
 * either side. The quiet is LiveKit's 0.8 s: the avatar renders in 1 s
 * blocks, so a quiet up to 1 s adds no lag the block would not add anyway,
 * and a pause longer than it splits a reply into two avatar turns, which the
 * SDK takes in its stride. The pre-roll is the plan's 200 ms.
 */
export const TURN_GATE = {
  FRAME_SAMPLES: (PCM_SAMPLE_RATE * 10) / 1_000,
  RMS_THRESHOLD: 0.001,
  PRE_ROLL_SAMPLES: (PCM_SAMPLE_RATE * 200) / 1_000,
  QUIET_SAMPLES: (PCM_SAMPLE_RATE * 800) / 1_000,
} as const;

const INT16_FULL_SCALE = 0x8000;

export interface TurnGate {
  /** Whether a turn is open, so every chunk goes out until the quiet closes it. */
  readonly open: boolean;
  /** The latest quiet chunks while no turn is open, no more than the pre-roll. */
  readonly preRoll: readonly Int16Array[];
  /** Quiet samples in a row since the last loud frame, at the end of the last chunk. */
  readonly quietSamples: number;
}

export interface TurnGateStep {
  readonly gate: TurnGate;
  readonly feeds: readonly AvatarFeed[];
}

export const TURN_GATE_IDLE: TurnGate = { open: false, preRoll: [], quietSamples: 0 };

/** One frame's RMS on the unit scale a Float32 sample was on. */
function frameRms(frame: Int16Array): number {
  let energy = 0;
  for (const sample of frame) energy += (sample / INT16_FULL_SCALE) ** 2;
  return Math.sqrt(energy / frame.length);
}

interface ChunkQuiet {
  /** The quiet run at the chunk's end. */
  readonly quietSamples: number;
  /** Whether the run reached the whole quiet at some frame, though a later one may have broken it. */
  readonly reachedQuiet: boolean;
}

/** The quiet run through a chunk, given the run it began on, frame by frame. */
function quietThrough(quietSamples: number, chunk: Int16Array): ChunkQuiet {
  let quiet = quietSamples;
  let reachedQuiet = false;
  for (let start = 0; start < chunk.length; start += TURN_GATE.FRAME_SAMPLES) {
    const frame = chunk.subarray(start, start + TURN_GATE.FRAME_SAMPLES);
    quiet = frameRms(frame) >= TURN_GATE.RMS_THRESHOLD ? 0 : quiet + frame.length;
    reachedQuiet ||= quiet >= TURN_GATE.QUIET_SAMPLES;
  }
  return { quietSamples: quiet, reachedQuiet };
}

/** One chunk as an `audio` feed: its PCM16 samples, little-endian, in base64. */
function audioFeed(chunk: Int16Array): AvatarFeed {
  const bytes = new DataView(new ArrayBuffer(chunk.length * 2));
  for (const [index, sample] of chunk.entries()) bytes.setInt16(index * 2, sample, true);
  return { kind: AVATAR_FEED_KIND.AUDIO, pcm: Base64.encode(new Uint8Array(bytes.buffer)) };
}

/** Keeps the latest chunks that fit the pre-roll, dropping the oldest first. */
function keepPreRoll(chunks: readonly Int16Array[]): readonly Int16Array[] {
  let samples = 0;
  let from = chunks.length;
  for (const chunk of chunks.toReversed()) {
    if (samples + chunk.length > TURN_GATE.PRE_ROLL_SAMPLES) break;
    samples += chunk.length;
    from -= 1;
  }
  return chunks.slice(from);
}

/**
 * Feeds one chunk through the gate, answering the gate after it and what goes
 * out. Note that a quiet reached inside a chunk whose last frames speak again
 * ends the turn before that chunk rather than after it, because the chunk
 * goes out whole and its speech belongs to the turn it starts; the old turn
 * loses no more than 30 ms of its trailing quiet.
 */
export function stepTurnGate(gate: TurnGate, chunk: Int16Array): TurnGateStep {
  const { quietSamples, reachedQuiet } = quietThrough(gate.open ? gate.quietSamples : 0, chunk);
  const heardVoice = quietSamples < chunk.length;
  if (!gate.open && !heardVoice) {
    return { gate: { ...gate, preRoll: keepPreRoll([...gate.preRoll, chunk]) }, feeds: [] };
  }
  const audio = [...gate.preRoll, chunk].map(audioFeed);
  if (quietSamples >= TURN_GATE.QUIET_SAMPLES) {
    return { gate: TURN_GATE_IDLE, feeds: [...audio, { kind: AVATAR_FEED_KIND.TURN_END }] };
  }
  const opened: TurnGate = { open: true, preRoll: [], quietSamples };
  if (!reachedQuiet) return { gate: opened, feeds: audio };
  return { gate: opened, feeds: [{ kind: AVATAR_FEED_KIND.TURN_END }, ...audio] };
}

/**
 * What the gate owes when the feed stops: a `turn_end` for a turn still open,
 * so the avatar is not left holding one that never ends.
 */
export function closeTurnGate(gate: TurnGate): readonly AvatarFeed[] {
  return gate.open ? [{ kind: AVATAR_FEED_KIND.TURN_END }] : [];
}
