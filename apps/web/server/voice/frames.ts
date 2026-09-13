import {
  isWireString,
  type UnparsedWireValue,
  VOICE_SERVICE_FRAME,
  VOICE_SERVICE_PATH,
} from "../core.js";
import {
  decodeLivePayload,
  LIVE_CLIENT_EVENT,
  LIVE_SERVER_EVENT,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
} from "../live.js";

/**
 * Which frames cross the service in which direction. The service is a pipe,
 * and the whole of its judgment about a frame is its `type`: it reads that
 * one field to decide, and forwards the bytes it received rather than a
 * re-serialization of them, so nothing here can reword what either side said.
 */

/** The two upgrades the service answers, by the path each stands on. */
export const VOICE_ROUTE = {
  /** A signed-in desktop's session: the exchange is the service's, and the desktop sends the stop, the hang-up, and its idle. */
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
  /** A frame the route does not admit in this direction, dropped and counted. */
  DROP_UNPERMITTED: "drop-unpermitted",
  /** A report in the service's own vocabulary: read by the service, forwarded nowhere. */
  REPORT: "report",
  /** A frame the route does not admit from the desktop: the socket is closed on it. */
  REFUSE: "refuse",
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

/**
 * The Live events a signed-in desktop still sends once the exchange is the
 * service's: the stop key's one instruction append, and the graceful
 * hang-up. Every other append is the exchange's, and the exchange stands
 * here, so a desktop sending one is an older build or a re-wired local
 * exchange, either of which would have every answer heard twice.
 */
export const SESSIONS_CLIENT_EVENTS: readonly string[] = [
  LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND,
  LIVE_CLIENT_EVENT.CLOSE,
];

/** The service-vocabulary frames a signed-in desktop sends after the handshake, read here and never forwarded. */
export const SESSIONS_REPORT_FRAMES: readonly string[] = [VOICE_SERVICE_FRAME.SESSION_ACTIVITY];

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
 * desktop may send the stop and the hang-up, which pass untouched, and its
 * idle report, which the service reads for the exchange it holds; anything
 * else, an unreadable frame included, closes the socket rather than being
 * dropped, so an older desktop build after the cutover is refused where it
 * can be seen and never doubles the exchange standing here. An introduction
 * caller may send only what a renderer's data channel may, the microphone
 * switch and the hang-up, so nothing it says can append to a session
 * running on Luke's key; what it sends beside those is dropped and counted.
 */
export function desktopFrameDecision(type: string | undefined, route: VoiceRoute): FrameDecision {
  if (route === VOICE_ROUTE.SESSIONS) {
    if (type === undefined) return FRAME_DECISION.REFUSE;
    if (SESSIONS_CLIENT_EVENTS.includes(type)) return FRAME_DECISION.FORWARD;
    if (SESSIONS_REPORT_FRAMES.includes(type)) return FRAME_DECISION.REPORT;
    return FRAME_DECISION.REFUSE;
  }
  return type !== undefined && INTRODUCTION_CLIENT_EVENTS.includes(type)
    ? FRAME_DECISION.FORWARD
    : FRAME_DECISION.DROP_UNPERMITTED;
}
