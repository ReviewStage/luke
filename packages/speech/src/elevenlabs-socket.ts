import { isRecord, isWireString, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";
import { ELEVENLABS_API_ORIGIN } from "./elevenlabs-voices.js";

/**
 * The streaming speech socket, as frames rather than as a connection: what to
 * send, and how to read what comes back. The socket itself and the audio graph
 * it feeds belong to the renderer; everything here is the wire vocabulary, so
 * the ordering and the decoding can be tested without one.
 */

const SPEECH_PATH_PREFIX = "/v1/text-to-speech/";
const SPEECH_PATH_SUFFIX = "/stream-input";

/**
 * The one model Luke speaks through, fixed by the build. Chosen over the
 * expressive v3 models for what this use costs and how fast it answers: half
 * the credits per character, and speech beginning in about a quarter of the
 * time. Luke speaks unprompted all day, so both compound.
 *
 * The voice's own server-side defaults do the rest: ElevenLabs documents no
 * rate control that maps onto Luke's speed steps, and inventing one would be a
 * control that changes nothing.
 */
export const ELEVENLABS_MODEL_ID = "eleven_flash_v2_5";

/**
 * Raw PCM rather than a streaming codec: a codec may interleave bytes across a
 * frame boundary, and what is scheduled has to be whole samples for the drain
 * to know when the reply has actually been heard.
 */
export const ELEVENLABS_OUTPUT_FORMAT = "pcm_24000";

/** The sample rate `pcm_24000` names, mono, signed 16-bit little-endian. */
export const ELEVENLABS_SAMPLE_RATE = 24_000;

/**
 * Builds the exact address one reply's speech socket opens on. The voice rides
 * in the path here rather than in a frame, so it is encoded: a voice id is
 * carried from a provider's answer through the renderer, and a path segment is
 * the one place a stray separator would address something else entirely.
 */
export function elevenlabsSpeechUrl(voiceId: string, singleUseToken: string): string {
  const path = `${SPEECH_PATH_PREFIX}${encodeURIComponent(voiceId)}${SPEECH_PATH_SUFFIX}`;
  const url = new URL(path, ELEVENLABS_API_ORIGIN);
  url.protocol = "wss:";
  url.searchParams.set("model_id", ELEVENLABS_MODEL_ID);
  url.searchParams.set("output_format", ELEVENLABS_OUTPUT_FORMAT);
  url.searchParams.set("single_use_token", singleUseToken);
  return url.toString();
}

/**
 * The opening frame, which is a single space and nothing else. The socket
 * requires one before any real text; the voice is already in the address, the
 * credential is already in the query, and every setting this frame could carry
 * is one Luke deliberately leaves at the voice's own default.
 */
export function speechOpeningFrame(): WireRecord {
  return { text: " " };
}

/** One delta of the reply, in the order it was generated. */
export function speechTextFrame(delta: string): WireRecord {
  return { text: delta };
}

/**
 * Sent once OpenAI has finished the response. An empty text is how this socket
 * is closed, and it flushes whatever is still buffered on the way out — which
 * is why no separate flush is ever sent: the reply's last words and the close
 * are the same event, so there is nothing left to force.
 */
export function speechCloseFrame(): WireRecord {
  return { text: "" };
}

/**
 * What one server frame says. Only the documented fields are read: audio to
 * play, the ending, and an error to report. Anything else the server sends
 * alongside them is ignored rather than guessed at.
 */
export interface SpeechServerFrame {
  /** Base64 `pcm_24000` samples, absent on a frame that carries none. */
  audio?: string;
  /** The socket has said everything it will say. */
  final: boolean;
  /**
   * The server's own account of a failure, bounded, never echoed back to it.
   * An error frame carries a sentence in `message` and a machine identifier in
   * `error`, and either may be absent, so both are read and the sentence is
   * preferred: a frame naming its failure only in prose is still a failure, and
   * dropping it leaves the turn to end on the socket's silent close instead.
   */
  error?: string;
}

/**
 * What an error message may be worth keeping. Long enough for the sentences
 * ElevenLabs actually sends, short enough that a hostile frame cannot become
 * an unbounded diagnostic line.
 */
export const MAXIMUM_SPEECH_ERROR_LENGTH = 300;

function boundedError(value: UnparsedWireValue): string | undefined {
  if (!isWireString(value)) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAXIMUM_SPEECH_ERROR_LENGTH);
}

/** Reads one server frame, or nothing at all if it is not JSON Luke understands. */
export function parseSpeechFrame(payload: string): SpeechServerFrame | undefined {
  let parsed: UnparsedWireValue;
  try {
    // SAFETY: A socket frame is unparsed wire until the field reads below narrow it.
    parsed = JSON.parse(payload) as UnparsedWireValue;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  // This socket answers in camelCase where the account reads answer in snake,
  // which is the service's own inconsistency and not a choice available here.
  const frame: SpeechServerFrame = { final: parsed.isFinal === true };
  // An empty audio field is no audio, not a frame of silence to schedule.
  if (isWireString(parsed.audio) && parsed.audio !== "") frame.audio = parsed.audio;
  const error = boundedError(parsed.message) ?? boundedError(parsed.error);
  if (error) frame.error = error;
  return frame;
}

/** How far a signed 16-bit sample is from the ±1 range the audio graph reads. */
const PCM16_SCALE = 0x8000;

/**
 * Decodes one base64 `pcm_24000` frame into the samples an audio buffer takes.
 * A trailing odd byte is a truncated sample rather than a sample: it is
 * dropped, because half of one is not a quieter sound, it is a click.
 */
export function decodeSpeechAudio(base64: string): Float32Array {
  const binary = atob(base64);
  const sampleCount = Math.floor(binary.length / 2);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const low = binary.charCodeAt(index * 2);
    const high = binary.charCodeAt(index * 2 + 1);
    const unsigned = (high << 8) | low;
    const signed = unsigned >= PCM16_SCALE ? unsigned - 0x10000 : unsigned;
    samples[index] = signed / PCM16_SCALE;
  }
  return samples;
}
