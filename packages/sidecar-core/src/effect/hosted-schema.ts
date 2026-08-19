import { attentionDecisionFromModel } from "../attention.js";
import {
  HOSTED_CALLS_URL,
  type HostedMintAnswer,
  type HostedQuota,
  type HostedReviewAnswer,
} from "../hosted-service.js";
import type { UnparsedWireValue } from "../json.js";
import { type RealtimeConnection, realtimeCredentialIsUsable } from "../realtime-credentials.js";
import { decodeRecord, decodeText, decodeWholeNumber } from "./wire-schema.js";

function decodeNonNegativeWholeNumber(value: UnparsedWireValue): number | undefined {
  const parsed = decodeWholeNumber(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

/** Reads a quota out of an untrusted hosted answer, or nothing. */
export function decodeHostedQuota(value: UnparsedWireValue): HostedQuota | undefined {
  const record = decodeRecord(value);
  if (!record) return undefined;
  const used = decodeNonNegativeWholeNumber(record.used);
  const limit = decodeNonNegativeWholeNumber(record.limit);
  const remaining = decodeNonNegativeWholeNumber(record.remaining);
  const resetsAt = decodeNonNegativeWholeNumber(record.resetsAt);
  if (used === undefined || limit === undefined || remaining === undefined) return undefined;
  if (resetsAt === undefined) return undefined;
  return { used, limit, remaining, resetsAt };
}

/**
 * Validates a hosted mint answer. Anything without a usable, canonically
 * addressed credential is discarded rather than repaired, the same posture as
 * the OpenAI mint response reader.
 */
export function decodeHostedMintAnswer(
  value: UnparsedWireValue,
  now: number,
): HostedMintAnswer | undefined {
  const record = decodeRecord(value);
  if (!record) return undefined;
  const connectionRecord = decodeRecord(record.connection);
  if (!connectionRecord) return undefined;
  const secret = decodeText(connectionRecord.value);
  const expiresAt = decodeWholeNumber(connectionRecord.expiresAt);
  const model = decodeText(connectionRecord.model);
  if (!secret || !model) return undefined;
  if (expiresAt === undefined) return undefined;
  if (connectionRecord.callsUrl !== HOSTED_CALLS_URL) return undefined;
  const credential: RealtimeConnection = {
    value: secret,
    expiresAt,
    model,
    callsUrl: HOSTED_CALLS_URL,
  };
  if (!realtimeCredentialIsUsable(credential, now)) return undefined;
  const quota = decodeHostedQuota(record.quota);
  const answer: HostedMintAnswer = { connection: credential };
  if (quota !== undefined) answer.quota = quota;
  return answer;
}

/**
 * Validates a hosted attention answer through the same contract a model's own
 * decision passes, and stamps it with the reader's clock: `decidedAt` feeds
 * local dedup windows, so the service's clock has no business in it.
 */
export function decodeHostedReviewAnswer(
  value: UnparsedWireValue,
  decidedAt: number,
): HostedReviewAnswer | undefined {
  const record = decodeRecord(value);
  if (!record) return undefined;
  const decisionRecord = decodeRecord(record.decision);
  if (!decisionRecord) return undefined;
  const decision = attentionDecisionFromModel(decisionRecord, decidedAt);
  if (!decision) return undefined;
  const quota = decodeHostedQuota(record.quota);
  const answer: HostedReviewAnswer = { decision };
  if (quota !== undefined) answer.quota = quota;
  return answer;
}
