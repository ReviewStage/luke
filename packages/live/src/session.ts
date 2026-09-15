import { Schema } from "effect";
import {
  type LiveClientEventType,
  type LiveServerEventSelector,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
} from "./events.js";
import { type LiveScene, sessionInstructions } from "./instructions.js";
import type { InitialItem } from "./seed.js";
import { LIVE_DEFAULTS, type LiveVoice } from "./voices.js";

/**
 * Creating a session and diagnosing why voice is or is not available. The
 * trusted side is the only consumer: a session is created with the project
 * key, on the host with the developer's own or on the voice service with
 * Luke's, and what reaches the renderer is the session's id and an SDP
 * answer, never a credential.
 */

/** Where a WebRTC session is created, under the API's `/v1` base. */
export const LIVE_SESSIONS_PATH = "/live/sessions";

/**
 * The quiet after which a session is considered idle: five minutes with no
 * speech energy on the microphone, or the microphone muted. The peer decides
 * it from its own local signals and never from a missing transcript event,
 * which the guide forbids reading as silence, and reports it once; the host
 * closes only when it too has appended nothing in the same window. Ours to
 * tune against recorded conversations, as the guide says.
 */
export const LIVE_IDLE_WINDOW_MS = 5 * 60_000;

/**
 * Where a trusted server attaches its sideband to a running session, under
 * the API's `wss` base. The id is the one the creation response named, kept
 * unchanged, prefix included.
 */
export function liveAttachPath(sessionId: string): string {
  return `${LIVE_SESSIONS_PATH}/${encodeURIComponent(sessionId)}/attach`;
}

export const LIVE_TRANSPORT_TYPE = "webrtc";

export const LiveTransportTypeSchema = Schema.Literal(LIVE_TRANSPORT_TYPE);

export const LIVE_DELEGATION_TYPE = "client";

export const LiveDelegationTypeSchema = Schema.Literal(LIVE_DELEGATION_TYPE);

/**
 * Every audio encoding a primary WebSocket session may be started under, as
 * the WebSockets guide names them and the SDK's `AudioFormat` declares them.
 * Nothing compressed beyond G.711 is offered, so no Opus.
 */
export const LIVE_AUDIO_ENCODING = {
  PCM16: "audio/pcm",
  G711_ULAW: "audio/pcmu",
  G711_ALAW: "audio/pcma",
} as const;

/**
 * The four formats the guide names, each encoding with the rate it is spoken
 * at: PCM16 at either 24 or 16 kHz, and G.711 at 8 kHz in both companding
 * laws. One of these applies to the session's input and its output alike, is
 * fixed at startup, and cannot change while the session stands, so choosing
 * one for what a device sends chooses it for Luke's own voice too.
 */
export const LIVE_AUDIO_FORMAT = {
  PCM16_24K: { type: LIVE_AUDIO_ENCODING.PCM16, rate: 24_000 },
  PCM16_16K: { type: LIVE_AUDIO_ENCODING.PCM16, rate: 16_000 },
  G711_ULAW_8K: { type: LIVE_AUDIO_ENCODING.G711_ULAW, rate: 8_000 },
  G711_ALAW_8K: { type: LIVE_AUDIO_ENCODING.G711_ALAW, rate: 8_000 },
} as const;

export type LiveAudioFormat = (typeof LIVE_AUDIO_FORMAT)[keyof typeof LIVE_AUDIO_FORMAT];

/**
 * The format a primary WebSocket session is started under when the caller
 * names none. PCM16 at 16 kHz is the compromise ruled on 2026-09-14 between
 * the bytes a wrist streams through the service and Luke's own voice, which
 * the same format carries back. The API's own default is 24 kHz, so this is a
 * choice rather than an omission, and changing it is a product decision.
 */
export const LIVE_DEFAULT_AUDIO_FORMAT = LIVE_AUDIO_FORMAT.PCM16_16K;

/** One format as a schema: its encoding at the one rate the guide pairs it with, and no other pairing. */
function audioFormatSchema<Encoding extends string, Rate extends number>(format: {
  readonly type: Encoding;
  readonly rate: Rate;
}) {
  return Schema.Struct({ type: Schema.Literal(format.type), rate: Schema.Literal(format.rate) });
}

/**
 * The format a device names when it asks the service for a session the
 * service streams its audio through, read as one of the four above and
 * nothing else: an encoding at a rate the guide does not pair it with is
 * refused here, since the session would refuse it at startup.
 */
export const LiveAudioFormatSchema = Schema.Union([
  audioFormatSchema(LIVE_AUDIO_FORMAT.PCM16_24K),
  audioFormatSchema(LIVE_AUDIO_FORMAT.PCM16_16K),
  audioFormatSchema(LIVE_AUDIO_FORMAT.G711_ULAW_8K),
  audioFormatSchema(LIVE_AUDIO_FORMAT.G711_ALAW_8K),
]);

/**
 * The one client event that starts a session, sent as the first message on a
 * primary WebSocket. It stands here beside the creation request rather than
 * among `LIVE_CLIENT_EVENT`'s events because it is a startup message and not
 * one a standing session takes: a WebRTC session is started by the request
 * that created it and must never be sent this on its data channel, and that
 * set is what a renderer's channel and the service's frame decisions are
 * stated over.
 */
export const LIVE_SESSION_START = "session.start";

/**
 * The one client event that carries audio into a session: base64 of raw
 * bytes in the format the session was started under, sent on a primary
 * WebSocket alone, since a WebRTC session's voice travels on its media track
 * and its data channel must never carry this. It stands here beside
 * `session.start` rather than in `LIVE_CLIENT_EVENT` for the same reason
 * that one does: that set is what a renderer's channel may send, and a
 * renderer appends no audio. The API names the reflection a sideband hears
 * by the same string, `LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND`, so a frame of
 * this type is the device's own audio in one direction and its echo in the
 * other.
 */
export const LIVE_INPUT_AUDIO_APPEND = "session.input_audio.append";

interface LiveStartupOptions {
  scene: LiveScene;
  /** The model, where a deployment pins one; `LIVE_DEFAULTS.MODEL` otherwise. */
  model?: string | undefined;
  /** Chosen at creation and immutable after startup. */
  voice?: LiveVoice;
  /** The startup history; `conversationSeedItems` bounds it. */
  input?: readonly InitialItem[];
}

interface LiveSessionOptions extends LiveStartupOptions {
  /** What the renderer's data channel may send; `RENDERER_CLIENT_EVENTS` by default. */
  clientEvents?: readonly LiveClientEventType[];
  /** What the renderer's data channel is shown; `RENDERER_SERVER_EVENTS` by default. */
  serverEvents?: readonly LiveServerEventSelector[];
}

interface LivePrimarySessionOptions extends LiveStartupOptions {
  /** One format for both directions; `LIVE_DEFAULT_AUDIO_FORMAT` otherwise. */
  format?: LiveAudioFormat;
}

/**
 * What both documents name whatever transport carries the session: the model,
 * the scene's instructions, the startup history where there is one, the
 * client's delegation, because Luke's brain is the backend and nothing else
 * may act, and no storage. This model has no tools, no speed, and no
 * truncation, and a field the API does not document is refused at startup.
 */
function startupDocument(options: LiveStartupOptions) {
  const input = options.input ?? [];
  return {
    model: options.model ?? LIVE_DEFAULTS.MODEL,
    instructions: sessionInstructions(options.scene),
    ...(input.length > 0 ? { input: [...input] } : undefined),
    delegation: { type: LIVE_DELEGATION_TYPE },
    store: false,
  };
}

/**
 * The session document a WebRTC session is created with: the startup document
 * with the voice, and the renderer's data channel restricted to the events
 * named, so an untrusted window cannot append to the model or start anything.
 * No `audio.format`, because WebRTC negotiates its own and only a primary
 * WebSocket is given one.
 */
export function liveSessionConfig(options: LiveSessionOptions) {
  return {
    ...startupDocument(options),
    audio: { output: { voice: options.voice ?? LIVE_DEFAULTS.VOICE } },
    client: {
      data_channel: {
        allowed_client_events: [...(options.clientEvents ?? RENDERER_CLIENT_EVENTS)],
        allowed_server_events: (options.serverEvents ?? RENDERER_SERVER_EVENTS).map((selector) => ({
          ...selector,
        })),
      },
    },
  };
}

export type LiveSessionConfig = ReturnType<typeof liveSessionConfig>;

/**
 * The session document a primary WebSocket is started with: the same startup
 * document and the same voice, with the audio format the socket carries in
 * both directions. No `transport`, since the socket is the transport and the
 * document travels over it rather than in a creation request; and no
 * `client.data_channel`, since a primary WebSocket has no data channel and
 * the trusted server holding it is the only thing reading the session, so what
 * a device is shown is that server's decision and not an allowlist the API
 * enforces.
 */
export function livePrimarySessionConfig(options: LivePrimarySessionOptions) {
  return {
    ...startupDocument(options),
    audio: {
      format: { ...(options.format ?? LIVE_DEFAULT_AUDIO_FORMAT) },
      output: { voice: options.voice ?? LIVE_DEFAULTS.VOICE },
    },
  };
}

export type LivePrimarySessionConfig = ReturnType<typeof livePrimarySessionConfig>;

/** The body `POST /v1/live/sessions` takes: the session and the renderer's SDP offer. */
export function liveCreateRequest(session: LiveSessionConfig, sdpOffer: string) {
  return { session, transport: { type: LIVE_TRANSPORT_TYPE, sdp: sdpOffer } };
}

/**
 * The first message a primary WebSocket sends, and the whole of what starts
 * that session. It names no `event_id`: the only answer waited on is
 * `session.started`, and an `error` arriving in its place is a refusal
 * whichever command it says it is about.
 */
export function liveStartRequest(session: LivePrimarySessionConfig) {
  return { type: LIVE_SESSION_START, session };
}

/**
 * The creation answer: the session's id, kept opaque, and the SDP answer the
 * renderer applies as its remote description. An answer without both is
 * refused whole. Anything else the service adds is ignored by the read rather
 * than by the declaration — `readEither(liveCreateAnswerSchema, { excess:
 * EXCESS_KEYS.DROP })` — since which keys a read tolerates is the read's to
 * decide.
 */
const keptText = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.makeFilter<string>((value) => value.trim().length > 0),
);

export const liveCreateAnswerSchema = Schema.Struct({
  session: Schema.Struct({ id: keptText }),
  transport: Schema.Struct({
    type: Schema.Literal(LIVE_TRANSPORT_TYPE),
    sdp: keptText,
  }),
});

export type LiveCreateAnswer = typeof liveCreateAnswerSchema.Type;

/**
 * Why the last attempt to open a session ended the way it did. "Voice is
 * off" has several distinct causes that look identical from the panel, and
 * the one that matters most, no signed-in account for the service to open a
 * session on, is invisible from inside the app without this.
 */
export const LIVE_SESSION_OUTCOME = {
  NOT_ATTEMPTED: "not-attempted",
  SUCCEEDED: "succeeded",
  /** No signed-in account to open a session on; nothing was attempted. */
  NO_ACCOUNT: "no-account",
  DISABLED_BY_FIXTURE: "disabled-by-fixture",
  HTTP_ERROR: "http-error",
  NETWORK_ERROR: "network-error",
  MALFORMED_RESPONSE: "malformed-response",
  /** The session was created but the host's sideband could not attach to it. */
  SIDEBAND_FAILED: "sideband-failed",
  /** The hosted service found no signed-in account behind the request. */
  NOT_SIGNED_IN: "not-signed-in",
  /** The hosted service's ceiling refused the request. */
  QUOTA_EXHAUSTED: "quota-exhausted",
  /** The hosted tier is switched off service-side or not answering. */
  HOSTED_UNAVAILABLE: "hosted-unavailable",
} as const;

export type LiveSessionOutcome = (typeof LIVE_SESSION_OUTCOME)[keyof typeof LIVE_SESSION_OUTCOME];

/**
 * What the host knows about why voice is or is not available. It carries no
 * credential material: never the account's token, and never a session's SDP.
 */
export interface LiveDiagnostics {
  /** A fixture or evidence run never opens a session, regardless of credentials. */
  fixtureMode: boolean;
  model: string;
  voice: LiveVoice;
  lastOutcome: LiveSessionOutcome;
  /** A status code or error name; never a request body or credential. */
  lastDetail?: string;
  lastAttemptAt?: number;
  /** The billed seconds `session.closed` reported for the last session, once confirmed. */
  lastSessionSeconds?: number;
  /** Whether the host's sideband stands on the current session. */
  sidebandAttached: boolean;
  /** The hosted counter as the service last reported it; absent until a session has been created. */
  quota?: {
    used: number;
    limit: number;
    resetsAt: number;
  };
}
