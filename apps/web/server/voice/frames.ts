import {
  isWireString,
  type UnparsedWireValue,
  VOICE_SERVICE_FRAME,
  VOICE_SERVICE_PATH,
} from "../core.js";
import { decodeLivePayload, LIVE_CLIENT_EVENT, LIVE_SERVER_EVENT } from "../live.js";

/**
 * Which frames cross the service in which direction. The service is a pipe,
 * and the whole of its judgment about a frame is its `type`: it reads that
 * one field to decide, and forwards the bytes it received rather than a
 * re-serialization of them, so nothing here can reword what either side said.
 */

/** Whether a path is the one upgrade the service answers: a signed-in Mac's WebRTC session, whose exchange is the service's. */
export function isVoicePath(path: string): boolean {
  return path === VOICE_SERVICE_PATH.SESSIONS;
}

export const FRAME_DECISION = {
  FORWARD: "forward",
  /**
   * Reflected audio, dropped by type in both directions, so the developer's
   * voice and Luke's never transit the service: the voice travels on the
   * Mac's own WebRTC media and the reflection is for a sideband alone.
   */
  DROP_AUDIO: "drop-audio",
  /** A report in the service's own vocabulary: read by the service, forwarded nowhere. */
  REPORT: "report",
  /** A frame the service does not admit from the device: the socket is closed on it. */
  REFUSE: "refuse",
  /** The device's hang-up, read as an ask for the close the service sends itself and forwarded nowhere. */
  HANG_UP: "hang-up",
} as const;

type FrameDecision = (typeof FRAME_DECISION)[keyof typeof FRAME_DECISION];

const REFLECTED_AUDIO: readonly string[] = [
  LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND,
  LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA,
];

/**
 * What the Mac sends toward OpenAI once the exchange is the service's:
 * nothing. Every append is the exchange's, the stop key's included, and the
 * exchange stands here, so a device sending any append is an older build or
 * a re-wired local exchange, either of which would have every answer heard
 * twice; and no instruction text of the device's choosing reaches the
 * session through this socket. The close is the exchange's too, as the
 * server-controls guide asks one owner per action: the Mac's hang-up is read
 * below as an ask for it, never forwarded.
 */
const SESSIONS_HANG_UP_FRAMES: readonly string[] = [
  VOICE_SERVICE_FRAME.SESSION_HANG_UP,
  LIVE_CLIENT_EVENT.CLOSE,
];
/** The service-vocabulary frames the Mac sends after the handshake, read here and never forwarded: its idle, and the stop key. */
export const SESSIONS_REPORT_FRAMES: readonly string[] = [
  VOICE_SERVICE_FRAME.SESSION_ACTIVITY,
  VOICE_SERVICE_FRAME.SESSION_STOP,
];

/** The `type` of one frame, or nothing when the frame is not a JSON record naming one. */
export function frameType(text: UnparsedWireValue): string | undefined {
  const payload = decodeLivePayload(text);
  if (payload === undefined) return undefined;
  const type = payload.type;
  return isWireString(type) ? type : undefined;
}

/** What to do with a frame OpenAI sent toward the device: the reflected audio dropped, and everything else shown. */
export function upstreamFrameDecision(type: string | undefined): FrameDecision {
  return type !== undefined && REFLECTED_AUDIO.includes(type)
    ? FRAME_DECISION.DROP_AUDIO
    : FRAME_DECISION.FORWARD;
}

/**
 * What to do with a frame the device sent toward OpenAI: the hang-up, the
 * service's own frame or the Live close an older Mac still sends, read alike
 * as an ask for the close the exchange sends itself; the reports read in the
 * service's own vocabulary; and anything else, an unreadable frame included,
 * refused with the close, so an older build is refused where it can be seen
 * and never doubles the exchange standing here.
 */
export function deviceFrameDecision(type: string | undefined): FrameDecision {
  if (type === undefined) return FRAME_DECISION.REFUSE;
  if (SESSIONS_HANG_UP_FRAMES.includes(type)) return FRAME_DECISION.HANG_UP;
  if (SESSIONS_REPORT_FRAMES.includes(type)) return FRAME_DECISION.REPORT;
  return FRAME_DECISION.REFUSE;
}
