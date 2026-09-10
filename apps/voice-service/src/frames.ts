import { VOICE_SERVICE_PATH } from "@sidecar/hosted";
import {
  decodeLivePayload,
  LIVE_SERVER_EVENT,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
} from "@sidecar/live";
import { isWireString, type UnparsedWireValue } from "@sidecar/wire";
import type { RawData } from "ws";

/**
 * Which frames cross the service in which direction. The service is a pipe,
 * and the whole of its judgment about a frame is its `type`: it reads that
 * one field to decide, and forwards the bytes it received rather than a
 * re-serialization of them, so nothing here can reword what either side said.
 */

/** The two upgrades the service answers, by the path each stands on. */
export const VOICE_ROUTE = {
  /** A signed-in desktop's session: the host's sideband at one remove, everything forwarded. */
  SESSIONS: "sessions",
  /** The accountless introduction: the service keeps the sideband, the caller sees captions. */
  INTRODUCTION: "introduction",
} as const;

export type VoiceRoute = (typeof VOICE_ROUTE)[keyof typeof VOICE_ROUTE];

export function routeForPath(path: string): VoiceRoute | undefined {
  if (path === VOICE_SERVICE_PATH.SESSIONS) return VOICE_ROUTE.SESSIONS;
  if (path === VOICE_SERVICE_PATH.INTRODUCTION) return VOICE_ROUTE.INTRODUCTION;
  return undefined;
}

export const FRAME_DECISION = {
  FORWARD: "forward",
  /** Reflected audio: the developer's voice and Luke's never transit the service. */
  DROP_AUDIO: "drop-audio",
  /** A frame the route does not admit in this direction. */
  DROP_UNPERMITTED: "drop-unpermitted",
} as const;

export type FrameDecision = (typeof FRAME_DECISION)[keyof typeof FRAME_DECISION];

const REFLECTED_AUDIO: readonly string[] = [
  LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND,
  LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA,
];

const INTRODUCTION_SERVER_EVENTS: readonly string[] = RENDERER_SERVER_EVENTS.map(
  (selector) => selector.type,
);

const INTRODUCTION_CLIENT_EVENTS: readonly string[] = RENDERER_CLIENT_EVENTS;

/** The text of one socket frame; a binary frame is not a Live event and reads as nothing. */
export function frameText(data: RawData, isBinary: boolean): string | undefined {
  if (isBinary) return undefined;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

/** The `type` of one frame, or nothing when the frame is not a JSON record naming one. */
export function frameType(text: UnparsedWireValue): string | undefined {
  const payload = decodeLivePayload(text);
  if (payload === undefined) return undefined;
  const type = payload.type;
  return isWireString(type) ? type : undefined;
}

/**
 * What to do with a frame OpenAI sent toward the desktop. Reflected audio
 * is dropped on every route. The introduction's caller is shown only what
 * a renderer's own data channel would be shown, since it holds no account
 * and the sideband is the service's, not its own.
 */
export function upstreamFrameDecision(type: string | undefined, route: VoiceRoute): FrameDecision {
  if (type !== undefined && REFLECTED_AUDIO.includes(type)) return FRAME_DECISION.DROP_AUDIO;
  if (route === VOICE_ROUTE.SESSIONS) return FRAME_DECISION.FORWARD;
  return type !== undefined && INTRODUCTION_SERVER_EVENTS.includes(type)
    ? FRAME_DECISION.FORWARD
    : FRAME_DECISION.DROP_UNPERMITTED;
}

/**
 * What to do with a frame the desktop sent toward OpenAI. A signed-in
 * desktop's frames are the host's own sideband commands and pass untouched;
 * an introduction caller may send only what a renderer's data channel may,
 * the microphone switch and the hang-up, so nothing it says can append to a
 * session running on Luke's key.
 */
export function desktopFrameDecision(type: string | undefined, route: VoiceRoute): FrameDecision {
  if (route === VOICE_ROUTE.SESSIONS) return FRAME_DECISION.FORWARD;
  return type !== undefined && INTRODUCTION_CLIENT_EVENTS.includes(type)
    ? FRAME_DECISION.FORWARD
    : FRAME_DECISION.DROP_UNPERMITTED;
}
