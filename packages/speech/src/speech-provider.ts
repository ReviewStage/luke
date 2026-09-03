import { isWireString, type UnparsedWireValue } from "@sidecar/wire";

/**
 * Which service says Luke's words out loud. It is the whole of what this
 * choice decides: the conversation, its transcription, its tools, and the
 * review of a session all stay with OpenAI whichever is selected, because
 * only synthesis moves.
 *
 * OpenAI is the default and the fallback both. A speech provider the user
 * has not connected, or has disconnected, is not a state Luke can speak in,
 * so every path that loses one lands back here rather than going quiet.
 */
export const SPEECH_PROVIDER = {
  OPENAI: "openai",
  ELEVENLABS: "elevenlabs",
} as const;

export type SpeechProvider = (typeof SPEECH_PROVIDER)[keyof typeof SPEECH_PROVIDER];

/** Guards a provider arriving from storage or IPC. */
export function isSpeechProvider(value: UnparsedWireValue): value is SpeechProvider {
  return value === SPEECH_PROVIDER.OPENAI || value === SPEECH_PROVIDER.ELEVENLABS;
}

/**
 * How one call to ElevenLabs ended, shared by the voice list and the token
 * mint because the two fail in exactly the same ways.
 */
export const ELEVENLABS_OUTCOME = {
  OK: "ok",
  /** The key was refused: revoked, or missing the permission the call needs. */
  UNAUTHORIZED: "unauthorized",
  HTTP_ERROR: "http-error",
  NETWORK_ERROR: "network-error",
  MALFORMED_RESPONSE: "malformed-response",
} as const;

export type ElevenlabsOutcome = (typeof ELEVENLABS_OUTCOME)[keyof typeof ELEVENLABS_OUTCOME];

/** The outcomes that need a sentence on the page; `ok` draws the result instead. */
export type ElevenlabsFailure = Exclude<ElevenlabsOutcome, typeof ELEVENLABS_OUTCOME.OK>;

/**
 * A voice as the panel draws it: the three bounded fields the list read keeps
 * and nothing else. No preview address travels, because the renderer would
 * have to fetch it to use it, and a voice list is metadata rather than audio.
 */
export interface SpeechVoice {
  id: string;
  name: string;
  /** ElevenLabs' own word for where the voice came from ("cloned", "generated"). */
  category?: string;
}

/** Guards a voice id arriving from the renderer against the shape ElevenLabs issues. */
export function isSpeechVoiceId(value: UnparsedWireValue): value is string {
  return isWireString(value) && value.length > 0 && value.length <= MAXIMUM_VOICE_FIELD_LENGTH;
}

/**
 * What a single voice field may be worth keeping. ElevenLabs documents no
 * ceiling for either, and a name is user-written, so the bound is Luke's own:
 * long enough for any name a person types, short enough that a malformed
 * answer cannot become a row of arbitrary length.
 */
export const MAXIMUM_VOICE_FIELD_LENGTH = 200;
