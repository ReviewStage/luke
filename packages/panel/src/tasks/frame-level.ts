/**
 * frame-level.ts -- how loud one frame of a capture is, which the dictation strip's meter draws.
 */

/**
 * One frame's loudness from the analyser's time-domain samples, in the unit
 * interval, scaled so ordinary speech fills the meter.
 */
export function frameLevel(samples: Uint8Array): number {
  let energy = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    energy += normalized * normalized;
  }
  return Math.min(1, Math.sqrt(energy / samples.length) * 4.5);
}
