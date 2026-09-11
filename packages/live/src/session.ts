import { RECORD_EXTRA_KEYS, s, TEXT_ENDS } from "@sidecar/wire";
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

export const LIVE_DELEGATION_TYPE = "client";

export interface LiveSessionOptions {
  scene: LiveScene;
  /** The model, where a deployment pins one; `LIVE_DEFAULTS.MODEL` otherwise. */
  model?: string | undefined;
  /** Chosen at creation and immutable after startup. */
  voice?: LiveVoice;
  /** The startup history; `conversationSeedItems` bounds it. */
  input?: readonly InitialItem[];
  /** What the renderer's data channel may send; `RENDERER_CLIENT_EVENTS` by default. */
  clientEvents?: readonly LiveClientEventType[];
  /** What the renderer's data channel is shown; `RENDERER_SERVER_EVENTS` by default. */
  serverEvents?: readonly LiveServerEventSelector[];
}

/**
 * The session document a WebRTC session is created with. The delegation is the
 * client's, because Luke's brain is the backend and nothing else may act; the
 * session is not stored; the renderer's data channel is restricted to the
 * events named, so an untrusted window cannot append to the model or start
 * anything. Nothing else is set: WebRTC negotiates the audio format, this
 * model has no tools, no speed, and no truncation, and a field the API does
 * not document is refused at creation.
 */
export function liveSessionConfig(options: LiveSessionOptions) {
  const input = options.input ?? [];
  return {
    model: options.model ?? LIVE_DEFAULTS.MODEL,
    instructions: sessionInstructions(options.scene),
    ...(input.length > 0 ? { input: [...input] } : undefined),
    audio: { output: { voice: options.voice ?? LIVE_DEFAULTS.VOICE } },
    delegation: { type: LIVE_DELEGATION_TYPE },
    store: false,
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

/** The body `POST /v1/live/sessions` takes: the session and the renderer's SDP offer. */
export function liveCreateRequest(session: LiveSessionConfig, sdpOffer: string) {
  return { session, transport: { type: LIVE_TRANSPORT_TYPE, sdp: sdpOffer } };
}

/**
 * The creation answer: the session's id, kept opaque, and the SDP answer the
 * renderer applies as its remote description. Anything else the service adds
 * is ignored; an answer without both is refused whole.
 */
export const liveCreateAnswerSchema = s.record(
  {
    session: s.record(
      { id: s.text({ ends: TEXT_ENDS.KEEP }) },
      {
        extraKeys: RECORD_EXTRA_KEYS.IGNORE,
      },
    ),
    transport: s.record(
      {
        type: s.literal(LIVE_TRANSPORT_TYPE),
        sdp: s.text({ ends: TEXT_ENDS.KEEP }),
      },
      { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
    ),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

export type LiveCreateAnswer = NonNullable<ReturnType<typeof liveCreateAnswerSchema.parse>>;

/**
 * Why the last attempt to open a session ended the way it did. "Voice is
 * off" has several distinct causes that look identical from the panel, and
 * the one that matters most, the key never reaching the process, is invisible
 * from inside the app without this.
 */
export const LIVE_SESSION_OUTCOME = {
  NOT_ATTEMPTED: "not-attempted",
  SUCCEEDED: "succeeded",
  NO_API_KEY: "no-api-key",
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
 * credential material: whether a key was found, never the key, and never a
 * session's SDP.
 */
export interface LiveDiagnostics {
  /** Whether the host resolved an OpenAI key, from either place one can come from. */
  apiKeyConfigured: boolean;
  /** A fixture or evidence run never opens a session, regardless of credentials. */
  fixtureMode: boolean;
  /** Whether voice runs on the hosted service rather than the developer's own key. */
  hosted?: boolean;
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
  /** The hosted counter as the service last reported it; absent on a keyed run. */
  quota?: {
    used: number;
    limit: number;
    resetsAt: number;
  };
}
