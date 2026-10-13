/**
 * pcm-chunker.ts -- float samples into the avatar's PCM16 chunks, with no audio graph behind it.
 *
 * LiveAvatar's LITE media socket takes `agent.speak` audio as 24 kHz signed
 * 16-bit little-endian mono, and the tee hands it over in 100 ms chunks: few
 * enough messages that main and the host are not woken every render quantum,
 * short enough that the avatar's lips trail Luke's voice by no more than a
 * chunk. The chunker is what the tee's worklet runs (`avatar-tee-worklet.ts`),
 * kept free of the worklet's globals so it reads and tests as a function.
 */

/** The format the avatar's media socket takes. */
export const AVATAR_PCM = {
  SAMPLE_RATE: 24_000,
  /** 100 ms at the sample rate. */
  CHUNK_SAMPLES: 2_400,
  BYTES_PER_SAMPLE: 2,
} as const;

/** The name the tee's processor is registered under, shared by the worklet and the node that runs it. */
export const AVATAR_TEE_PROCESSOR = "luke-avatar-tee";

const INT16_NEGATIVE_SCALE = 0x8000;
const INT16_POSITIVE_SCALE = 0x7fff;

export interface PcmChunker {
  /** Takes the next run of samples and answers every chunk they completed, oldest first. */
  push(samples: Float32Array): Uint8Array[];
}

/**
 * One sample as PCM16. Note that we clamp before scaling, because a WebRTC
 * decode can overshoot the unit interval and an Int16 store wraps rather than
 * saturates; NaN, which no clamp orders, is silence.
 */
function int16Of(sample: number): number {
  if (Number.isNaN(sample)) return 0;
  const clamped = Math.max(-1, Math.min(1, sample));
  return Math.round(clamped < 0 ? clamped * INT16_NEGATIVE_SCALE : clamped * INT16_POSITIVE_SCALE);
}

/**
 * A chunker that batches samples into chunks of `chunkSamples`. A chunk is
 * emitted the moment its last sample arrives, each over a buffer of its own so
 * the caller may transfer it; a partial chunk waits for the next push.
 */
export function createPcmChunker(chunkSamples: number = AVATAR_PCM.CHUNK_SAMPLES): PcmChunker {
  if (!Number.isInteger(chunkSamples) || chunkSamples <= 0) {
    throw new RangeError(`a chunk holds a positive whole number of samples, not ${chunkSamples}`);
  }
  const chunkBytes = chunkSamples * AVATAR_PCM.BYTES_PER_SAMPLE;
  let chunk = new Uint8Array(chunkBytes);
  let view = new DataView(chunk.buffer);
  let filled = 0;
  return {
    push: (samples) => {
      const completed: Uint8Array[] = [];
      for (const sample of samples) {
        view.setInt16(filled * AVATAR_PCM.BYTES_PER_SAMPLE, int16Of(sample), true);
        filled += 1;
        if (filled < chunkSamples) continue;
        completed.push(chunk);
        chunk = new Uint8Array(chunkBytes);
        view = new DataView(chunk.buffer);
        filled = 0;
      }
      return completed;
    },
  };
}
