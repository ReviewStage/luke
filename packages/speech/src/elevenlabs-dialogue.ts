import { isRecord, isWireString, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";
import { ELEVENLABS_API_ORIGIN } from "./elevenlabs-voices.js";

/**
 * The Text-to-Dialogue socket, as frames rather than as a connection: what to
 * send, and how to read what comes back. The socket itself and the audio graph
 * it feeds belong to the renderer; everything here is the wire vocabulary, so
 * the ordering, the keepalive, and the decoding can be tested without one.
 */

const DIALOGUE_PATH = "/v1/text-to-dialogue/stream-input";

/**
 * The one model Luke speaks through, fixed by the build. The voice's own
 * server-side defaults do the rest: ElevenLabs documents no rate control that
 * maps onto Luke's speed steps, and inventing one would be a control that
 * changes nothing.
 */
export const ELEVENLABS_MODEL_ID = "eleven_v3_conversational";

/**
 * Raw PCM rather than a streaming codec, on ElevenLabs' own advice: a codec
 * may interleave bytes across a turn boundary, and the turn boundary is what
 * says a reply has finished being spoken.
 */
export const ELEVENLABS_OUTPUT_FORMAT = "pcm_24000";

/** The sample rate `pcm_24000` names, mono, signed 16-bit little-endian. */
export const ELEVENLABS_SAMPLE_RATE = 24_000;

/**
 * ElevenLabs closes a socket idle for 20 seconds. Luke pings well inside that,
 * because the gap being covered is a model still thinking between two deltas,
 * and a socket closed underneath one loses the reply rather than delaying it.
 */
export const ELEVENLABS_KEEP_ALIVE_MS = 15_000;

/** Builds the exact address one reply's speech socket opens on. */
export function elevenlabsDialogueUrl(singleUseToken: string): string {
  const url = new URL(DIALOGUE_PATH, ELEVENLABS_API_ORIGIN);
  url.protocol = "wss:";
  url.searchParams.set("model_id", ELEVENLABS_MODEL_ID);
  url.searchParams.set("output_format", ELEVENLABS_OUTPUT_FORMAT);
  url.searchParams.set("single_use_token", singleUseToken);
  return url.toString();
}

/** The opening frame, which names the one voice every input of this turn uses. */
export function dialogueVoicesFrame(voiceId: string): WireRecord {
  return { voices: [voiceId] };
}

/**
 * One delta of the reply. `new_turn` stays false for every delta: the whole
 * reply is one turn spoken by one voice, and a new turn mid-sentence would
 * put a boundary where the model put a comma.
 */
export function dialogueInputFrame(voiceId: string, delta: string): WireRecord {
  return { inputs: [{ text: delta, voice_id: voiceId, new_turn: false }] };
}

export function dialogueKeepAliveFrame(): WireRecord {
  return { keep_alive: true };
}

/** Sent once OpenAI has finished the response, which is what flushes the turn. */
export function dialogueCloseFrame(): WireRecord {
  return { close_socket: true };
}

/**
 * What one server frame says. Only the documented fields are read: audio to
 * play, the two endings, and an error to report. Anything else the server
 * sends alongside them is ignored rather than guessed at.
 */
export interface DialogueServerFrame {
  /** Base64 `pcm_24000` samples, absent on a frame that carries none. */
  audio?: string;
  /** The turn this voice was speaking has finished. */
  finalForTurn: boolean;
  /** The socket has said everything it will say. */
  final: boolean;
  /** The server's own message, bounded, never echoed back to it. */
  error?: string;
}

/**
 * What an error message may be worth keeping. Long enough for the sentences
 * ElevenLabs actually sends, short enough that a hostile frame cannot become
 * an unbounded diagnostic line.
 */
export const MAXIMUM_DIALOGUE_ERROR_LENGTH = 300;

function boundedError(value: UnparsedWireValue): string | undefined {
  if (!isWireString(value)) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAXIMUM_DIALOGUE_ERROR_LENGTH);
}

/** Reads one server frame, or nothing at all if it is not JSON Luke understands. */
export function parseDialogueFrame(payload: string): DialogueServerFrame | undefined {
  let parsed: UnparsedWireValue;
  try {
    parsed = JSON.parse(payload) as UnparsedWireValue;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const audio = isWireString(parsed.audio) && parsed.audio !== "" ? parsed.audio : undefined;
  return {
    ...(audio ? { audio } : {}),
    finalForTurn: parsed.is_final_audio_for_turn === true,
    final: parsed.is_final === true,
    ...(boundedError(parsed.error) ? { error: boundedError(parsed.error) } : {}),
  };
}

/** How far a signed 16-bit sample is from the ±1 range the audio graph reads. */
const PCM16_SCALE = 0x8000;

/**
 * Decodes one base64 `pcm_24000` frame into the samples an audio buffer takes.
 * A trailing odd byte is a truncated sample rather than a sample: it is
 * dropped, because half of one is not a quieter sound, it is a click.
 */
export function decodeDialogueAudio(base64: string): Float32Array {
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
