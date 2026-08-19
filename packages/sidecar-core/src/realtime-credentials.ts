import { isRecord } from "./json.js";
import { PRESS_AUDIO_SAMPLE_RATE } from "./press-audio.js";
import { REALTIME_SESSION_TYPE, realtimeInstructions } from "./realtime-protocol.js";
import { realtimeToolDefinitions } from "./realtime-tools.js";
import { REALTIME_DEFAULTS } from "./realtime-voice-settings.js";

/**
 * Minting an ephemeral Realtime credential and diagnosing why voice is or is
 * not available. The main process is the only consumer: a secret never belongs
 * in the renderer except as the already-minted value.
 */

/** The endpoints that mint a client secret and open a call. */
export const REALTIME_CLIENT_SECRETS_PATH = "/realtime/client_secrets";
export const REALTIME_CALLS_PATH = "/realtime/calls";

/** An ephemeral Realtime credential, safe to hand to a sandboxed renderer. */
export interface RealtimeCredential {
  value: string;
  /** Milliseconds since the epoch, normalized from the API's seconds. */
  expiresAt: number;
  model: string;
}

/**
 * Everything a renderer needs to open a call, and nothing more. The endpoint
 * travels with the credential so the renderer never has to know how the main
 * process was configured.
 */
export interface RealtimeConnection extends RealtimeCredential {
  callsUrl: string;
}

export interface RealtimeSessionOptions {
  model?: string;
  voice?: string;
  /** A multiple of the voice's natural rate, within the API's 0.25–1.5. */
  speed?: number;
  instructions?: string;
}

function trimmedText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

/**
 * How the conversation gives way at the edge of the model's window.
 *
 * Eviction happens either way; the only question is whether the build chose
 * it. Left unset, the service trims the least it can get away with, which
 * means a conversation sitting at the ceiling trims again on every single turn
 * and moves the cached prefix every time it does. Trimming a fifth of the
 * window in one go instead is one cache miss rather than a run of them.
 *
 * What is evicted is the oldest of what remains, and the oldest of what remains
 * is the developer's own earlier turns — which is the argument for the context
 * items superseding themselves rather than piling up beside those turns.
 */
export const REALTIME_TRUNCATION = {
  TYPE: "retention_ratio",
  RETENTION_RATIO: 0.8,
} as const;

/**
 * Builds the session a client secret is minted against. Turn detection is
 * disabled outright so the developer, not a voice-activity heuristic, decides
 * when Luke is listening — an always-open microphone is exactly what a sidecar
 * that sits on someone's desk all day must not have.
 */
export function realtimeSessionConfig(options: RealtimeSessionOptions = {}) {
  return {
    type: REALTIME_SESSION_TYPE,
    model: trimmedText(options.model) ?? REALTIME_DEFAULTS.MODEL,
    instructions: trimmedText(options.instructions) ?? realtimeInstructions(),
    tools: realtimeToolDefinitions(),
    // Auto for the conversation; each proactive readout narrows itself to none.
    tool_choice: "auto",
    truncation: {
      type: REALTIME_TRUNCATION.TYPE,
      retention_ratio: REALTIME_TRUNCATION.RETENTION_RATIO,
    },
    audio: {
      input: {
        // What base64 audio over the data channel means, pinned rather than
        // assumed: the words a press captures during the handshake travel as
        // appends, and PCM read at any rate but its own is not heard wrong,
        // it is not heard at all. The track's own Opus is negotiated by the
        // call and never reads this.
        format: { type: "audio/pcm", rate: PRESS_AUDIO_SAMPLE_RATE },
        turn_detection: null,
      },
      output: {
        voice: trimmedText(options.voice) ?? REALTIME_DEFAULTS.VOICE,
        // A pace that is not a usable number falls back rather than minting a
        // session the API would refuse, the same posture as an unknown voice.
        speed:
          options.speed !== undefined && Number.isFinite(options.speed) && options.speed > 0
            ? options.speed
            : REALTIME_DEFAULTS.SPEED,
      },
    },
  };
}

/** Builds the request body that mints an ephemeral client secret. */
export function realtimeClientSecretRequest(options: RealtimeSessionOptions = {}) {
  return { session: realtimeSessionConfig(options) };
}

/**
 * Validates an untrusted mint response. Anything that does not carry a usable
 * secret and expiry is discarded rather than repaired, so a malformed response
 * leaves the voice experience unavailable instead of half-configured.
 */
export function realtimeCredentialFromResponse(
  payload: unknown,
  fallbackModel: string = REALTIME_DEFAULTS.MODEL,
): RealtimeCredential | undefined {
  if (!isRecord(payload)) return undefined;

  const value = typeof payload.value === "string" ? payload.value.trim() : "";
  if (!value) return undefined;

  const expiresAtSeconds = payload.expires_at;
  if (typeof expiresAtSeconds !== "number" || !Number.isFinite(expiresAtSeconds)) {
    return undefined;
  }
  if (expiresAtSeconds <= 0) return undefined;

  const session = isRecord(payload.session) ? payload.session : undefined;
  const model = typeof session?.model === "string" ? trimmedText(session.model) : undefined;

  return {
    value,
    expiresAt: Math.floor(expiresAtSeconds * 1000),
    model: model ?? fallbackModel,
  };
}

/** Reports whether a credential is still usable at a given moment. */
export function realtimeCredentialIsUsable(credential: RealtimeCredential, now: number): boolean {
  return credential.expiresAt > now;
}

/**
 * Why the last attempt to mint a Realtime credential ended the way it did.
 *
 * "Voice is off" has several distinct causes that look identical from the
 * panel, and the one diagnosis that matters most — the API key never reached
 * the process — is invisible from inside the app without this.
 */
export const REALTIME_MINT_OUTCOME = {
  NOT_ATTEMPTED: "not-attempted",
  SUCCEEDED: "succeeded",
  NO_API_KEY: "no-api-key",
  DISABLED_BY_FIXTURE: "disabled-by-fixture",
  HTTP_ERROR: "http-error",
  NETWORK_ERROR: "network-error",
  MALFORMED_RESPONSE: "malformed-response",
  EXPIRED_CREDENTIAL: "expired-credential",
  /** The hosted service found no signed-in account behind the request. */
  NOT_SIGNED_IN: "not-signed-in",
  /** Today's included voice is spent; the diagnostics carry the quota that says when it returns. */
  QUOTA_EXHAUSTED: "quota-exhausted",
  /** The hosted tier is switched off service-side. */
  HOSTED_UNAVAILABLE: "hosted-unavailable",
} as const;

export type RealtimeMintOutcome =
  (typeof REALTIME_MINT_OUTCOME)[keyof typeof REALTIME_MINT_OUTCOME];

/**
 * What the main process knows about why voice is or is not available. It
 * carries no credential material: whether a key was found, never the key, and
 * never any part of a minted secret.
 */
export interface RealtimeDiagnostics {
  /** Whether the main process resolved an OpenAI key, from either place one can come from. */
  apiKeyConfigured: boolean;
  /** A fixture or evidence run never mints, regardless of credentials. */
  fixtureMode: boolean;
  /** Whether voice runs on the hosted service rather than the developer's own key. */
  hosted?: boolean;
  model: string;
  voice: string;
  /** The pace new credentials would be minted for, as a rate multiple. */
  speed: number;
  endpoint: string;
  lastOutcome: RealtimeMintOutcome;
  /** A status code or error name; never a request body or credential. */
  lastDetail?: string;
  lastAttemptAt?: number;
  /** The hosted allowance as the service last reported it; absent on a keyed run. */
  quota?: {
    used: number;
    limit: number;
    remaining: number;
    resetsAt: number;
  };
}

const REALTIME_MINT_EXPLANATIONS: Record<RealtimeMintOutcome, string> = {
  [REALTIME_MINT_OUTCOME.NOT_ATTEMPTED]: "No credential has been requested yet.",
  [REALTIME_MINT_OUTCOME.SUCCEEDED]: "A short-lived credential was minted.",
  [REALTIME_MINT_OUTCOME.NO_API_KEY]:
    "Voice has nothing to run on: no signed-in Luke account, and no OpenAI key. Signing in turns voice on with its included allowance; a key connected under What Luke runs on, at the top of the Settings tab, also works.",
  [REALTIME_MINT_OUTCOME.DISABLED_BY_FIXTURE]:
    "This is a fixture or evidence run, which never uses credentials.",
  [REALTIME_MINT_OUTCOME.HTTP_ERROR]: "The API rejected the mint request.",
  [REALTIME_MINT_OUTCOME.NETWORK_ERROR]: "The mint request did not complete.",
  [REALTIME_MINT_OUTCOME.MALFORMED_RESPONSE]: "The API answered without a usable client secret.",
  [REALTIME_MINT_OUTCOME.EXPIRED_CREDENTIAL]:
    "The API returned a client secret that had already expired, which usually means the local clock is wrong.",
  [REALTIME_MINT_OUTCOME.NOT_SIGNED_IN]:
    "The Luke account behind hosted voice did not authenticate. Signing out and back in usually repairs it.",
  [REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED]:
    "Today's included voice is used up. It returns at midnight UTC, and a personal OpenAI key in Settings removes the daily allowance.",
  [REALTIME_MINT_OUTCOME.HOSTED_UNAVAILABLE]:
    "Luke's hosted voice service is not answering right now. A personal OpenAI key in Settings works independently of it.",
};

/** Explains a mint outcome in one sentence, for the panel and for logs. */
export function realtimeMintExplanation(outcome: RealtimeMintOutcome): string {
  return REALTIME_MINT_EXPLANATIONS[outcome];
}
