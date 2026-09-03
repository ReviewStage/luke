import type { ElevenlabsOutcome, SpeechVoice } from "@sidecar/speech";

/**
 * What the renderer may learn about the speech service. When something went
 * wrong, one sentence to draw — never a response body, and never the
 * long-lived key, which stays in the main process and authenticates nothing
 * the renderer can see.
 */

export interface SpeechVoicesAnswer {
  /** The account's own voices, empty when the read failed. */
  voices: readonly SpeechVoice[];
  /** Said on the page when the read failed; absent when it did not. */
  explanation?: string;
}

/**
 * One credential for one reply's socket. It expires fifteen minutes after
 * ElevenLabs issues it and is spent by the socket that opens on it, so the
 * renderer asks again for the next reply rather than holding this one.
 */
export interface SpeechTokenAnswer {
  outcome: ElevenlabsOutcome;
  token?: string;
  explanation?: string;
}
