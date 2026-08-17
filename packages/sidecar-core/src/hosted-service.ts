import { attentionDecisionFromModel } from "./attention.js";
import { isRecord } from "./json.js";
import {
  REALTIME_CALLS_PATH,
  type RealtimeConnection,
  realtimeCredentialIsUsable,
} from "./realtime-credentials.js";
import type { AttentionDecision } from "./session.js";

/**
 * The wire contract between Luke's hosted service and the desktop. The web
 * endpoints answer with these shapes and the desktop's hosted clients validate
 * against them, both importing from here, so the two sides cannot drift — the
 * same standing the attention request construction has.
 */

/** The hosted endpoints, rooted at the service origin. */
export const HOSTED_SERVICE_PATH = {
  VOICE_MINT: "/api/voice/mint",
  ATTENTION_REVIEW: "/api/attention/review",
} as const;

/** Every refusal a hosted endpoint answers with, by its reason. */
export const HOSTED_API_ERROR = {
  /** The bearer token is missing, expired, or revoked. */
  INVALID_TOKEN: "invalid-token",
  /** The request body is not what this endpoint takes. */
  INVALID_REQUEST: "invalid-request",
  /** Today's free allowance for this meter is spent. */
  QUOTA_EXHAUSTED: "quota-exhausted",
  /** The deployment holds no OpenAI key: the hosted tier is switched off. */
  UNAVAILABLE: "unavailable",
  /** OpenAI refused or failed; the status travels, the bodies never do. */
  UPSTREAM_ERROR: "upstream-error",
  METHOD_NOT_ALLOWED: "method-not-allowed",
} as const;

export type HostedApiError = (typeof HOSTED_API_ERROR)[keyof typeof HOSTED_API_ERROR];

/** What one day's allowance looked like when the service last answered. */
export interface HostedQuota {
  used: number;
  limit: number;
  remaining: number;
  /** When the day's counters reset, as epoch milliseconds. */
  resetsAt: number;
}

function wholeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Reads a quota out of an untrusted hosted answer, or nothing. */
export function hostedQuotaFromWire(value: unknown): HostedQuota | undefined {
  if (!isRecord(value)) return undefined;
  const used = wholeNumber(value.used);
  const limit = wholeNumber(value.limit);
  const remaining = wholeNumber(value.remaining);
  const resetsAt = wholeNumber(value.resetsAt);
  if (used === undefined || limit === undefined || remaining === undefined) return undefined;
  if (resetsAt === undefined) return undefined;
  return { used, limit, remaining, resetsAt };
}

/**
 * The one address a hosted credential may point a call at. The renderer's
 * content-security policy only permits the canonical OpenAI host, so a
 * credential aimed anywhere else could not work — validating it here means a
 * mis-answering service reads as a malformed response rather than as a call
 * that dies mid-handshake.
 */
export const HOSTED_CALLS_URL = `https://api.openai.com/v1${REALTIME_CALLS_PATH}`;

export interface HostedMintAnswer {
  connection: RealtimeConnection;
  quota?: HostedQuota;
}

/**
 * Validates a hosted mint answer. Anything without a usable, canonically
 * addressed credential is discarded rather than repaired, the same posture as
 * the OpenAI mint response reader.
 */
export function hostedMintAnswerFromWire(
  value: unknown,
  now: number,
): HostedMintAnswer | undefined {
  if (!isRecord(value) || !isRecord(value.connection)) return undefined;
  const { connection } = value;
  const secret = typeof connection.value === "string" ? connection.value.trim() : "";
  const expiresAt = connection.expiresAt;
  const model = typeof connection.model === "string" ? connection.model.trim() : "";
  if (!secret || !model) return undefined;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return undefined;
  if (connection.callsUrl !== HOSTED_CALLS_URL) return undefined;
  const credential: RealtimeConnection = {
    value: secret,
    expiresAt,
    model,
    callsUrl: HOSTED_CALLS_URL,
  };
  if (!realtimeCredentialIsUsable(credential, now)) return undefined;
  const quota = hostedQuotaFromWire(value.quota);
  return { connection: credential, ...(quota ? { quota } : {}) };
}

export interface HostedReviewAnswer {
  decision: AttentionDecision;
  quota?: HostedQuota;
}

/**
 * Validates a hosted attention answer through the same contract a model's own
 * decision passes, and stamps it with the reader's clock: `decidedAt` feeds
 * local dedup windows, so the service's clock has no business in it.
 */
export function hostedReviewAnswerFromWire(
  value: unknown,
  decidedAt: number,
): HostedReviewAnswer | undefined {
  if (!isRecord(value) || !isRecord(value.decision)) return undefined;
  const wire = value.decision;
  const decision = attentionDecisionFromModel(
    {
      disposition: wire.disposition,
      summary: typeof wire.summary === "string" ? wire.summary : null,
      answers_ask: wire.answersAsk === true,
    },
    decidedAt,
  );
  if (!decision) return undefined;
  const quota = hostedQuotaFromWire(value.quota);
  return { decision, ...(quota ? { quota } : {}) };
}

/** Reads the error reason out of a refused hosted answer, or nothing. */
export function hostedErrorFromWire(value: unknown): HostedApiError | undefined {
  if (!isRecord(value) || typeof value.error !== "string") return undefined;
  return (Object.values(HOSTED_API_ERROR) as string[]).includes(value.error)
    ? (value.error as HostedApiError)
    : undefined;
}
