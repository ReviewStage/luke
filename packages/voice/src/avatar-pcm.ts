/**
 * avatar-pcm.ts -- what the avatar feed and its worklet say to each other: the file the worklet is, the name it registers, and the one chunk it posts.
 *
 * The worklet (`apps/desktop/src/renderer/avatar-feed/pcm-tee-worklet.ts`) runs on the audio rendering thread,
 * in a scope that loads a module by URL rather than sharing the window's
 * bundle, so it ships as a bundle of its own (`pcm-tee-worklet.js`) served
 * from beside `voice.html`: worklet modules fall under `script-src`, which
 * admits `'self'` alone. Nothing here imports a value, so neither side
 * carries the other.
 */

/** The worklet's bundle beside `voice.html`, and the processor it registers. */
export const PCM_TEE = {
  SCRIPT: "pcm-tee-worklet.js",
  PROCESSOR: "luke-pcm-tee",
} as const;

/**
 * Keyframe's `sendAudio` takes PCM16LE mono at this rate, the rate GPT Live
 * speaks at, so the context the tee runs in is opened at it.
 */
export const PCM_SAMPLE_RATE = 24_000;

/**
 * One chunk is 40 ms, one Keyframe video frame at 25 fps: what the worklet
 * posts, what the gate counts, and what one `audio` feed carries.
 */
export const PCM_CHUNK_SAMPLES = (PCM_SAMPLE_RATE * 40) / 1_000;
