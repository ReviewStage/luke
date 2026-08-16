import { isRecord } from "./json";
import { REALTIME_SESSION_TYPE, realtimeInstructions } from "./realtime-protocol";
import { realtimeToolDefinitions } from "./realtime-tools";
import { REALTIME_DEFAULTS } from "./realtime-voice-settings";

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
    audio: {
      input: {
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
  model: string;
  voice: string;
  /** The pace new credentials would be minted for, as a rate multiple. */
  speed: number;
  endpoint: string;
  lastOutcome: RealtimeMintOutcome;
  /** A status code or error name; never a request body or credential. */
  lastDetail?: string;
  lastAttemptAt?: number;
}

const REALTIME_MINT_EXPLANATIONS: Record<RealtimeMintOutcome, string> = {
  [REALTIME_MINT_OUTCOME.NOT_ATTEMPTED]: "No credential has been requested yet.",
  [REALTIME_MINT_OUTCOME.SUCCEEDED]: "A short-lived credential was minted.",
  [REALTIME_MINT_OUTCOME.NO_API_KEY]:
    "No OpenAI key has been given. Connect one in Settings, at the top of the Voice page. Exporting OPENAI_API_KEY in a shell also works, but does not reach an app opened from Finder.",
  [REALTIME_MINT_OUTCOME.DISABLED_BY_FIXTURE]:
    "This is a fixture or evidence run, which never uses credentials.",
  [REALTIME_MINT_OUTCOME.HTTP_ERROR]: "The API rejected the mint request.",
  [REALTIME_MINT_OUTCOME.NETWORK_ERROR]: "The mint request did not complete.",
  [REALTIME_MINT_OUTCOME.MALFORMED_RESPONSE]: "The API answered without a usable client secret.",
  [REALTIME_MINT_OUTCOME.EXPIRED_CREDENTIAL]:
    "The API returned a client secret that had already expired, which usually means the local clock is wrong.",
};

/** Explains a mint outcome in one sentence, for the panel and for logs. */
export function realtimeMintExplanation(outcome: RealtimeMintOutcome): string {
  return REALTIME_MINT_EXPLANATIONS[outcome];
}
