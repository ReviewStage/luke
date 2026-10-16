/**
 * avatar-pcm-chunker.ts -- Float32 render quanta to PCM16 chunks of one Keyframe frame each, for the worklet.
 *
 * Imports nothing but the contract, because the worklet's bundle is parsed on
 * the audio thread and carries whatever this file reaches.
 */

import { PCM_CHUNK_SAMPLES } from "./avatar-pcm.js";

const INT16_NEGATIVE_FULL_SCALE = 0x8000;
const INT16_POSITIVE_FULL_SCALE = 0x7fff;

/**
 * One sample to PCM16, clamped to full scale. Note that a sample past ±1 is
 * clipped rather than wrapped, because a wrapped sample is a full-scale click
 * of the opposite sign; a NaN reads as silence.
 */
function pcm16Sample(sample: number): number {
  if (Number.isNaN(sample)) return 0;
  const clamped = Math.max(-1, Math.min(1, sample));
  return Math.round(
    clamped < 0 ? clamped * INT16_NEGATIVE_FULL_SCALE : clamped * INT16_POSITIVE_FULL_SCALE,
  );
}

/**
 * A chunker that takes render quanta of any length (128 samples in Chromium,
 * which 960 is no multiple of) and answers every whole chunk they complete,
 * in order, holding the remainder for the next quantum.
 */
export function createPcmChunker(): (quantum: Float32Array) => Int16Array[] {
  let pending = new Int16Array(PCM_CHUNK_SAMPLES);
  let filled = 0;
  return (quantum) => {
    const chunks: Int16Array[] = [];
    for (const sample of quantum) {
      pending[filled] = pcm16Sample(sample);
      filled += 1;
      if (filled === PCM_CHUNK_SAMPLES) {
        chunks.push(pending);
        pending = new Int16Array(PCM_CHUNK_SAMPLES);
        filled = 0;
      }
    }
    return chunks;
  };
}
