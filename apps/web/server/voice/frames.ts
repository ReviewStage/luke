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

type FrameDecision = (typeof FRAME_DECISION)[keyof typeof FRAME_DECISION];

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

/**
 * What each route does with a frame OpenAI sent toward the device: the audio
 * it drops by type, and what it shows — everything, or the events named. On
 * the sessions and introduction routes the reflected audio is both
 * directions of it, since the voice travels on the device's own WebRTC media
 * and the reflection is for a sideband alone; on the audio route Luke's audio
 * is what the socket carries to the device, so only the echo of the device's
 * own appends is dropped. A signed-in WebRTC device is shown every frame; the
 * introduction's caller and the audio route's device hold no sideband of
 * their own and are shown what a renderer's data channel would be.
 */
interface TowardDevicePolicy {
  readonly droppedAudio: readonly string[];
  /** The event types shown, or nothing where every frame is. */
  readonly shown: readonly string[] | undefined;
}

/** The echo of the device's own audio, the one reflection the audio route drops. */
const ECHOED_AUDIO: readonly string[] = [LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND];

const TOWARD_DEVICE = {
  [VOICE_ROUTE.SESSIONS]: { droppedAudio: REFLECTED_AUDIO, shown: undefined },
  [VOICE_ROUTE.INTRODUCTION]: { droppedAudio: REFLECTED_AUDIO, shown: INTRODUCTION_SERVER_EVENTS },
  [VOICE_ROUTE.AUDIO]: { droppedAudio: ECHOED_AUDIO, shown: AUDIO_SERVER_EVENTS },
} satisfies Record<VoiceRoute, TowardDevicePolicy>;

/**
 * What each route does with a frame the device sent toward OpenAI: what it
 * forwards untouched, what it reads as a report in the service's own
 * vocabulary, and what becomes of anything else, an unreadable frame
 * included. A signed-in device, on either of its routes, is refused with the
 * close, so an older build of any platform after the cutover is refused where
 * it can be seen and never doubles the exchange standing here; an
 * introduction caller, who may send only what a renderer's data channel may,
 * has the rest dropped and counted, since nothing it says can append to a
 * session running on Luke's key either way.
 */
interface FromDevicePolicy {
  readonly forwarded: readonly string[];
  readonly reports: readonly string[];
  /** What becomes of any other frame, an unreadable one included. */
  readonly otherwise: FrameDecision;
}

/** The introduction holds no exchange to report to, so it reads no report. */
const NO_REPORTS: readonly string[] = [];

const FROM_DEVICE = {
  [VOICE_ROUTE.SESSIONS]: {
    forwarded: SESSIONS_CLIENT_EVENTS,
    reports: SESSIONS_REPORT_FRAMES,
    otherwise: FRAME_DECISION.REFUSE,
  },
  [VOICE_ROUTE.INTRODUCTION]: {
    forwarded: INTRODUCTION_CLIENT_EVENTS,
    reports: NO_REPORTS,
    otherwise: FRAME_DECISION.DROP_UNPERMITTED,
  },
  [VOICE_ROUTE.AUDIO]: {
    forwarded: AUDIO_CLIENT_EVENTS,
    reports: AUDIO_REPORT_FRAMES,
    otherwise: FRAME_DECISION.REFUSE,
  },
} satisfies Record<VoiceRoute, FromDevicePolicy>;

/** The `type` of one frame, or nothing when the frame is not a JSON record naming one. */
export function frameType(text: UnparsedWireValue): string | undefined {
  const payload = decodeLivePayload(text);
  if (payload === undefined) return undefined;
  const type = payload.type;
  return isWireString(type) ? type : undefined;
}

/** What to do with a frame OpenAI sent toward the device, under the route's own policy above. */
export function upstreamFrameDecision(type: string | undefined, route: VoiceRoute): FrameDecision {
  const policy = TOWARD_DEVICE[route];
  if (type !== undefined && policy.droppedAudio.includes(type)) return FRAME_DECISION.DROP_AUDIO;
  if (policy.shown === undefined) return FRAME_DECISION.FORWARD;
  return type !== undefined && policy.shown.includes(type)
    ? FRAME_DECISION.FORWARD
    : FRAME_DECISION.DROP_UNPERMITTED;
}

/** What to do with a frame the device sent toward OpenAI, under the route's own policy above. */
export function deviceFrameDecision(type: string | undefined, route: VoiceRoute): FrameDecision {
  const policy = FROM_DEVICE[route];
  if (type === undefined) return policy.otherwise;
  if (policy.forwarded.includes(type)) return FRAME_DECISION.FORWARD;
  if (policy.reports.includes(type)) return FRAME_DECISION.REPORT;
  return policy.otherwise;
}
