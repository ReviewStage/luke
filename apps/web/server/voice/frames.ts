import {
  isWireString,
  type UnparsedWireValue,
  VOICE_SERVICE_FRAME,
  VOICE_SERVICE_PATH,
} from "../core.js";
import {
  decodeLivePayload,
  LIVE_CLIENT_EVENT,
  LIVE_INPUT_AUDIO_APPEND,
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

/** The three upgrades the service answers, by the path each stands on. */
export const VOICE_ROUTE = {
  /** A signed-in device's WebRTC session, a Mac's or a phone's: the exchange is the service's, and the device sends the stop, the hang-up, and its idle. */
  SESSIONS: "sessions",
  /** The accountless introduction: the service keeps the sideband, the caller sees captions. */
  INTRODUCTION: "introduction",
  /**
   * A signed-in device with no WebRTC of its own: the service holds the
   * session's primary socket to OpenAI itself and pipes the device's audio up
   * and Luke's down, so on this route alone the developer's voice and Luke's
   * transit the service, in both directions. The exchange is the service's
   * here as on the sessions route, and the device sends its audio, the stop,
   * the hang-up, and its idle.
   */
  AUDIO: "audio",
} as const;

export type VoiceRoute = (typeof VOICE_ROUTE)[keyof typeof VOICE_ROUTE];

/** The two routes a signed-in device opens under its account bearer, whichever transport carries its voice. */
export type SignedInRoute = Exclude<VoiceRoute, typeof VOICE_ROUTE.INTRODUCTION>;

export function routeForPath(path: string): VoiceRoute | undefined {
  if (path === VOICE_SERVICE_PATH.SESSIONS) return VOICE_ROUTE.SESSIONS;
  if (path === VOICE_SERVICE_PATH.INTRODUCTION) return VOICE_ROUTE.INTRODUCTION;
  if (path === VOICE_SERVICE_PATH.AUDIO) return VOICE_ROUTE.AUDIO;
  return undefined;
}

export const FRAME_DECISION = {
  FORWARD: "forward",
  /**
   * Reflected audio, dropped by type. On the sessions and introduction routes
   * that is both directions of it, so the developer's voice and Luke's never
   * transit the service on a Mac's or a phone's call; on the audio route it
   * is the echo of the device's own appends alone, since Luke's audio is
   * what that device is listening for.
   */
  DROP_AUDIO: "drop-audio",
  /** A frame the route does not admit in this direction, dropped and counted. */
  DROP_UNPERMITTED: "drop-unpermitted",
  /** A report in the service's own vocabulary: read by the service, forwarded nowhere. */
  REPORT: "report",
  /** A frame the route does not admit from the device: the socket is closed on it. */
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
 * The one Live event a signed-in device still sends once the exchange is
 * the service's: the graceful hang-up. Every append is the exchange's, the
 * stop key's included, and the exchange stands here, so a device sending
 * any append is an older build or a re-wired local exchange, either of which
 * would have every answer heard twice; and no instruction text of the
 * device's choosing reaches the session through this route. A Mac and a
 * phone send the same four frames — this hang-up and the three reports
 * below — and the route reads them the same way, whichever sent them.
 */
export const SESSIONS_CLIENT_EVENTS: readonly string[] = [LIVE_CLIENT_EVENT.CLOSE];

/** The service-vocabulary frames a signed-in device sends after the handshake, read here and never forwarded: its idle, and the stop key. */
export const SESSIONS_REPORT_FRAMES: readonly string[] = [
  VOICE_SERVICE_FRAME.SESSION_ACTIVITY,
  VOICE_SERVICE_FRAME.SESSION_STOP,
  VOICE_SERVICE_FRAME.SESSION_BEAT,
];

/**
 * What a device on the audio route may send toward the session: its own
 * audio, forwarded as the bytes it arrived as, and the hang-up. The audio is
 * the one thing this route admits that the sessions route does not, and it
 * is the only thing: every append is still the exchange's, so no instruction
 * text of the device's choosing reaches the session here either.
 */
export const AUDIO_CLIENT_EVENTS: readonly string[] = [
  LIVE_INPUT_AUDIO_APPEND,
  LIVE_CLIENT_EVENT.CLOSE,
];

/**
 * The reports the audio route reads, as the sessions route reads them: the
 * device's idle and its stop. Not the beat, which is the desktop's alone: a
 * wrist decides no onboarding and greets no launch.
 */
export const AUDIO_REPORT_FRAMES: readonly string[] = [
  VOICE_SERVICE_FRAME.SESSION_ACTIVITY,
  VOICE_SERVICE_FRAME.SESSION_STOP,
];

/**
 * What a device on the audio route is shown: Luke's audio, and what a
 * renderer's own data channel would be shown, since a device with no
 * exchange of its own reads the captions and the lifecycle and nothing of
 * the delegations and acknowledgments that are the service's exchange's
 * business.
 */
const AUDIO_SERVER_EVENTS: readonly string[] = [
  LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA,
  ...INTRODUCTION_SERVER_EVENTS,
];

/** The `type` of one frame, or nothing when the frame is not a JSON record naming one. */
export function frameType(text: UnparsedWireValue): string | undefined {
  const payload = decodeLivePayload(text);
  if (payload === undefined) return undefined;
  const type = payload.type;
  return isWireString(type) ? type : undefined;
}

/**
 * What to do with a frame OpenAI sent toward the device. On the sessions and
 * introduction routes reflected audio is dropped, since the voice travels on
 * the device's own WebRTC media and the reflection is for a sideband alone.
 * On the audio route Luke's audio is forwarded, since the socket is what
 * carries it to the device, and only the echo of the device's own appends is
 * dropped. The introduction's caller and the audio route's device are shown
 * only what a renderer's own data channel would be shown, since neither holds
 * a sideband of its own; a signed-in WebRTC device is shown every frame.
 */
export function upstreamFrameDecision(type: string | undefined, route: VoiceRoute): FrameDecision {
  if (route === VOICE_ROUTE.AUDIO) {
    if (type === LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND) return FRAME_DECISION.DROP_AUDIO;
    return type !== undefined && AUDIO_SERVER_EVENTS.includes(type)
      ? FRAME_DECISION.FORWARD
      : FRAME_DECISION.DROP_UNPERMITTED;
  }
  if (type !== undefined && REFLECTED_AUDIO.includes(type)) return FRAME_DECISION.DROP_AUDIO;
  if (route === VOICE_ROUTE.SESSIONS) return FRAME_DECISION.FORWARD;
  return type !== undefined && INTRODUCTION_SERVER_EVENTS.includes(type)
    ? FRAME_DECISION.FORWARD
    : FRAME_DECISION.DROP_UNPERMITTED;
}

/**
 * What to do with a frame the device sent toward OpenAI. A signed-in device
 * may send the hang-up, which passes untouched, and its idle report and its
 * stop, which the service reads for the exchange it holds; on the audio route
 * it may also send its own audio, which passes untouched; anything else, an
 * unreadable frame included, closes the socket rather than being dropped, so
 * an older build of any platform after the cutover is refused where it can be
 * seen and never doubles the exchange standing here. An introduction caller
 * may send only what a renderer's data channel may, the microphone switch and
 * the hang-up, so nothing it says can append to a session running on Luke's
 * key; what it sends beside those is dropped and counted.
 */
export function deviceFrameDecision(type: string | undefined, route: VoiceRoute): FrameDecision {
  if (route === VOICE_ROUTE.SESSIONS) {
    if (type === undefined) return FRAME_DECISION.REFUSE;
    if (SESSIONS_CLIENT_EVENTS.includes(type)) return FRAME_DECISION.FORWARD;
    if (SESSIONS_REPORT_FRAMES.includes(type)) return FRAME_DECISION.REPORT;
    return FRAME_DECISION.REFUSE;
  }
  if (route === VOICE_ROUTE.AUDIO) {
    if (type === undefined) return FRAME_DECISION.REFUSE;
    if (AUDIO_CLIENT_EVENTS.includes(type)) return FRAME_DECISION.FORWARD;
    if (AUDIO_REPORT_FRAMES.includes(type)) return FRAME_DECISION.REPORT;
    return FRAME_DECISION.REFUSE;
  }
  return type !== undefined && INTRODUCTION_CLIENT_EVENTS.includes(type)
    ? FRAME_DECISION.FORWARD
    : FRAME_DECISION.DROP_UNPERMITTED;
}
