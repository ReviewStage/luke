import {
  ATTENTION_REVIEW_OUTCOME,
  type AttentionReview,
  maximumAttentionSummaryLength,
} from "./attention";
import {
  ATTENTION_DISPOSITION,
  type AttentionDisposition,
  type NormalizedSession,
  type SessionIdentity,
} from "./session";

export const REALTIME_DEFAULTS = {
  MODEL: "gpt-realtime-2.1",
  VOICE: "cedar",
} as const;

/** The Realtime session shape and the endpoints that mint and open a call. */
export const REALTIME_SESSION_TYPE = "realtime";
export const REALTIME_CLIENT_SECRETS_PATH = "/realtime/client_secrets";
export const REALTIME_CALLS_PATH = "/realtime/calls";
/** Both directions of the Realtime protocol travel over this one data channel. */
export const REALTIME_DATA_CHANNEL = "oai-events";

/** How far the voice loop has progressed, as the main process and UI both read it. */
export const REALTIME_STATUS = {
  /** No credentials are configured, so the voice experience is off. */
  UNAVAILABLE: "unavailable",
  IDLE: "idle",
  CONNECTING: "connecting",
  /** Connected with the microphone held closed until push-to-talk is pressed. */
  READY: "ready",
  LISTENING: "listening",
  RESPONDING: "responding",
  FAILED: "failed",
} as const;

export type RealtimeStatus = (typeof REALTIME_STATUS)[keyof typeof REALTIME_STATUS];

export const REALTIME_CLIENT_EVENT = {
  INPUT_AUDIO_BUFFER_COMMIT: "input_audio_buffer.commit",
  INPUT_AUDIO_BUFFER_CLEAR: "input_audio_buffer.clear",
  CONVERSATION_ITEM_CREATE: "conversation.item.create",
  RESPONSE_CREATE: "response.create",
  RESPONSE_CANCEL: "response.cancel",
} as const;

export const REALTIME_SERVER_EVENT = {
  RESPONSE_CREATED: "response.created",
  RESPONSE_DONE: "response.done",
  ERROR: "error",
} as const;

/** A proactive sentence the attention layer decided is worth voicing. */
export interface AttentionSpeech extends SessionIdentity {
  disposition: AttentionDisposition;
  summary: string;
  decidedAt: number;
}

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
  instructions?: string;
}

const REALTIME_INSTRUCTION_LINES: readonly string[] = [
  "You are Luke, a spoken companion for a developer who is running coding agents.",
  "You watch their sessions from the side; you do not run commands and cannot act on their behalf.",
  "",
  "How to speak:",
  "- Keep replies to one or two short sentences. The developer is working and listening, not reading.",
  "- Answer the question asked. Do not summarize everything you know about their sessions.",
  "- Name the provider and the workspace when you refer to a session, so it is unambiguous out loud.",
  "- When you do not know something, say so plainly rather than guessing.",
  "",
  "What you can see:",
  "- Only a session's provider, title, status, and a redacted summary.",
  "- You never receive transcripts, file contents, or command output, so never imply you read any.",
  "- You cannot start, stop, answer, or steer a coding-agent session. Say so if asked to.",
];

function trimmedText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The standing instructions that give Luke its spoken voice and its limits. */
export function realtimeInstructions(): string {
  return REALTIME_INSTRUCTION_LINES.join("\n");
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
    audio: {
      input: {
        turn_detection: null,
      },
      output: {
        voice: trimmedText(options.voice) ?? REALTIME_DEFAULTS.VOICE,
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
  /** Whether the main process found a non-empty `OPENAI_API_KEY`. */
  apiKeyConfigured: boolean;
  /** A fixture or evidence run never mints, regardless of credentials. */
  fixtureMode: boolean;
  model: string;
  voice: string;
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
    "OPENAI_API_KEY was empty or unset in the process Luke was launched with. Exporting it in a shell does not reach an app opened from Finder.",
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

/** How many sessions one context update may describe. */
export const maximumVoiceContextSessions = 10;

/**
 * Renders the session roster the conversation is allowed to know about.
 *
 * These are the same bounded, redacted fields the attention layer already
 * sends — provider, title, status, and the provider's own summary. No
 * transcript, file path, or command output is ever included.
 */
export function sessionContextText(sessions: readonly NormalizedSession[]): string {
  if (sessions.length === 0) return "No coding-agent sessions are currently observed.";

  return [
    "Currently observed sessions:",
    ...sessions
      .slice(0, maximumVoiceContextSessions)
      .map((session) =>
        [
          `- ${session.provider.displayName}`,
          session.title,
          session.status,
          session.summary ?? "no summary reported",
        ].join(" — "),
      ),
  ].join("\n");
}

/**
 * Builds the event that tells the conversation what Luke can currently see.
 *
 * Deliberately no `response.create`: this is context, not a prompt, so adding
 * it must never make Luke start talking. Without it the standing instructions
 * would claim Luke can see sessions it was never told about, and a spoken
 * question about live work could not be answered from real data.
 */
export function sessionContextEvents(
  sessions: readonly NormalizedSession[],
): readonly Record<string, unknown>[] {
  return [
    {
      type: REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE,
      item: {
        type: "message",
        // A user-role item is universally accepted by the Realtime API, and the
        // explicit label keeps it from reading as something the developer said.
        role: "user",
        content: [
          {
            type: "input_text",
            text: `[observed session status, sent automatically]\n${sessionContextText(sessions)}`,
          },
        ],
      },
    },
  ];
}

/** Builds the event that stops a reply the developer is talking over. */
export function cancelResponseEvents(): readonly Record<string, unknown>[] {
  return [{ type: REALTIME_CLIENT_EVENT.RESPONSE_CANCEL }];
}

/** Builds the events that close a push-to-talk turn and ask for a reply. */
export function pushToTalkCommitEvents(): readonly Record<string, unknown>[] {
  return [
    { type: REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT },
    { type: REALTIME_CLIENT_EVENT.RESPONSE_CREATE },
  ];
}

/**
 * Builds the event that empties the input audio buffer.
 *
 * A turn both opens and is abandoned with this. With turn detection disabled
 * the server keeps every byte received since the last commit, and a muted track
 * still transmits, so a turn that did not start from an empty buffer would
 * commit however long the call had been sitting idle along with what was said.
 */
export function clearInputAudioEvents(): readonly Record<string, unknown>[] {
  return [{ type: REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR }];
}

/**
 * Builds the event that voices a proactive update. The sentence the attention
 * layer already approved is spoken as-is rather than re-generated, so the
 * bounded, redacted summary that passed review is exactly what is said aloud.
 */
export function proactiveSpeechEvents(speech: AttentionSpeech): readonly Record<string, unknown>[] {
  const summary = trimmedText(speech.summary)?.slice(0, maximumAttentionSummaryLength);
  if (!summary) return [];

  return [
    {
      type: REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
      response: {
        instructions: [
          "Say the following sentence to the developer verbatim, then stop.",
          "Do not add a greeting, a follow-up question, or any other commentary.",
          "",
          summary,
        ].join("\n"),
      },
    },
  ];
}

/**
 * Selects the reviews worth voicing right now. A deduplicated review still
 * means the session needs attention, which the panel shows, but repeating the
 * same sentence out loud would be noise rather than news.
 */
export function attentionSpeechFromReviews(
  reviews: readonly AttentionReview[],
): readonly AttentionSpeech[] {
  const speech: AttentionSpeech[] = [];
  for (const review of reviews) {
    if (review.outcome !== ATTENTION_REVIEW_OUTCOME.DECIDED) continue;
    if (review.decision.disposition === ATTENTION_DISPOSITION.SILENT) continue;
    const summary = trimmedText(review.decision.summary);
    if (!summary) continue;
    speech.push({
      providerId: review.providerId,
      providerSessionId: review.providerSessionId,
      disposition: review.decision.disposition,
      summary,
      decidedAt: review.decision.decidedAt,
    });
  }
  return speech;
}
