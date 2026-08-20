import { attentionDecisionFromModel } from "@sidecar/attention";
import {
  REALTIME_CALLS_PATH,
  type RealtimeConnection,
  realtimeCredentialIsUsable,
} from "@sidecar/realtime";
import type { AttentionDecision } from "@sidecar/session";
import { isRecord, text, type UnparsedWireValue, wholeNumber } from "@sidecar/wire";

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
  ACCOUNT_DELETE: "/api/account/delete",
  USAGE: "/api/usage",
  EVENTS: "/api/events",
} as const;

/** Every refusal a hosted endpoint answers with, by its reason. */
export const HOSTED_API_ERROR = {
  /** The bearer token is missing, expired, or revoked. */
  INVALID_TOKEN: "invalid-token",
  /** The request body is not what this endpoint takes. */
  INVALID_REQUEST: "invalid-request",
  /**
   * Today's free allowance for this meter is spent, or — on the recording
   * endpoint, which meters nothing — this account has sent more counts this
   * minute than the brake allows.
   */
  QUOTA_EXHAUSTED: "quota-exhausted",
  /**
   * The deployment holds no key for what was asked — OpenAI's for the hosted
   * tier, the analytics processor's for recording — so that endpoint is off.
   */
  UNAVAILABLE: "unavailable",
  /** The upstream refused or failed; the status travels, the bodies never do. */
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

function nonNegativeWholeNumber(value: UnparsedWireValue): number | undefined {
  const parsed = wholeNumber(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

/** Reads a quota out of an untrusted hosted answer, or nothing. */
export function hostedQuotaFromWire(value: UnparsedWireValue): HostedQuota | undefined {
  if (!isRecord(value)) return undefined;
  const used = nonNegativeWholeNumber(value.used);
  const limit = nonNegativeWholeNumber(value.limit);
  const remaining = nonNegativeWholeNumber(value.remaining);
  const resetsAt = nonNegativeWholeNumber(value.resetsAt);
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
  value: UnparsedWireValue,
  now: number,
): HostedMintAnswer | undefined {
  if (!isRecord(value) || !isRecord(value.connection)) return undefined;
  const connection = value.connection;
  const secret = text(connection.value);
  const expiresAt = wholeNumber(connection.expiresAt);
  const model = text(connection.model);
  if (!secret || !model) return undefined;
  if (expiresAt === undefined) return undefined;
  if (connection.callsUrl !== HOSTED_CALLS_URL) return undefined;
  const credential: RealtimeConnection = {
    value: secret,
    expiresAt,
    model,
    callsUrl: HOSTED_CALLS_URL,
  };
  if (!realtimeCredentialIsUsable(credential, now)) return undefined;
  const quota = hostedQuotaFromWire(value.quota);
  const answer: HostedMintAnswer = { connection: credential };
  if (quota !== undefined) answer.quota = quota;
  return answer;
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
  value: UnparsedWireValue,
  decidedAt: number,
): HostedReviewAnswer | undefined {
  if (!isRecord(value) || !isRecord(value.decision)) return undefined;
  const decision = attentionDecisionFromModel(value.decision, decidedAt);
  if (!decision) return undefined;
  const quota = hostedQuotaFromWire(value.quota);
  const answer: HostedReviewAnswer = { decision };
  if (quota !== undefined) answer.quota = quota;
  return answer;
}

/**
 * Where today's allowance stands on both meters, read without spending
 * either: what the usage endpoint answers, and what the panel shows.
 */
export interface HostedUsageAnswer {
  voice: HostedQuota;
  attention: HostedQuota;
}

/** Validates a usage answer; a malformed one reads as no answer at all. */
export function hostedUsageAnswerFromWire(value: UnparsedWireValue): HostedUsageAnswer | undefined {
  if (!isRecord(value)) return undefined;
  const voice = hostedQuotaFromWire(value.voice);
  const attention = hostedQuotaFromWire(value.attention);
  return voice && attention ? { voice, attention } : undefined;
}

const HOSTED_API_ERROR_LIST: readonly HostedApiError[] = Object.values(HOSTED_API_ERROR);

/** Reads the error reason out of a refused hosted answer, or nothing. */
export function hostedErrorFromWire(value: UnparsedWireValue): HostedApiError | undefined {
  if (!isRecord(value)) return undefined;
  const error = text(value.error);
  if (!error) return undefined;
  // SAFETY: error is a string; membership in HOSTED_API_ERROR_LIST is the wire contract check.
  return HOSTED_API_ERROR_LIST.includes(error as HostedApiError)
    ? (error as HostedApiError)
    : undefined;
}
