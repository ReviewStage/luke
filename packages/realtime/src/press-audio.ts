/**
 * The audio a talk-key press captures while its call is still connecting.
 *
 * The microphone device opens at key-down, but on a WebRTC call nothing the
 * developer says can reach the service until the data channel opens — so the
 * words spoken into the handshake are captured locally, held here, and flushed
 * as `input_audio_buffer.append` events the moment the channel is up. The
 * buffer belongs to one connect attempt and dies with it: a failed attempt
 * discards it, so no press can leave words behind for a later connection.
 */

/**
 * The sample rate the held audio is captured at. It is the input format the
 * session is minted with — the API's default of 16-bit PCM at 24kHz mono,
 * which `realtimeSessionConfig` leaves in place — so an append needs no
 * conversion the capture did not already do.
 */
export const PRESS_AUDIO_SAMPLE_RATE = 24_000;

/**
 * How much held audio a press may accumulate before the oldest of it goes.
 *
 * The bound exists because the wait it covers is not itself bounded: the SDP
 * exchange and the channel opening share a deadline, but the credential mint
 * ahead of them has none — on the hosted path it transits Luke's service — so
 * a stuck mint under a held key would otherwise grow memory for as long as
 * the key was down. Thirty seconds is twice the connect deadline and longer
 * than anything worth saying into a call that has not opened.
 */
export const MAXIMUM_PRESS_AUDIO_MS = 30_000;

/**
 * Holds the chunks one press captured, in capture order, under a hard ceiling.
 *
 * Overflow drops the oldest audio first, trimming within a chunk when it must,
 * so the ceiling is exact and what survives is one continuous stretch ending
 * at the newest sample — the words that flow straight into the live turn. The
 * beginning of a sentence spoken into a thirty-second stall is the least
 * recoverable part of it, and a gap in the middle would garble more than the
 * loss of either end.
 */
export class PressAudioBuffer {
  readonly #maximumSamples: number;
  readonly #sampleRate: number;
  #chunks: Int16Array[] = [];
  #bufferedSamples = 0;
  #droppedSamples = 0;

  constructor(options: { maximumMs?: number; sampleRate?: number } = {}) {
    this.#sampleRate = options.sampleRate ?? PRESS_AUDIO_SAMPLE_RATE;
    const maximumMs = options.maximumMs ?? MAXIMUM_PRESS_AUDIO_MS;
    this.#maximumSamples = Math.max(1, Math.floor((maximumMs * this.#sampleRate) / 1_000));
  }

  push(chunk: Int16Array): void {
    if (chunk.length === 0) return;
    this.#chunks.push(chunk);
    this.#bufferedSamples += chunk.length;
    while (this.#bufferedSamples > this.#maximumSamples) {
      const oldest = this.#chunks[0];
      if (!oldest) break;
      const excess = this.#bufferedSamples - this.#maximumSamples;
      if (oldest.length <= excess) {
        this.#chunks.shift();
        this.#bufferedSamples -= oldest.length;
        this.#droppedSamples += oldest.length;
      } else {
        this.#chunks[0] = oldest.subarray(excess);
        this.#bufferedSamples -= excess;
        this.#droppedSamples += excess;
      }
    }
  }

  /** The chunks in capture order. The buffer is empty afterwards. */
  drain(): readonly Int16Array[] {
    const chunks = this.#chunks;
    this.#chunks = [];
    this.#bufferedSamples = 0;
    return chunks;
  }

  get isEmpty(): boolean {
    return this.#bufferedSamples === 0;
  }

  get bufferedMs(): number {
    return (this.#bufferedSamples * 1_000) / this.#sampleRate;
  }

  /** How much the ceiling has cost so far, oldest-first, across the press. */
  get droppedMs(): number {
    return (this.#droppedSamples * 1_000) / this.#sampleRate;
  }
}
