import { createHash } from "node:crypto";
import type { SessionKey } from "@sidecar/runtime-contracts";
import { isRecord, isWireString, text, type UnparsedWireValue, wholeNumber } from "@sidecar/wire";
import { conceptTags, stripBullet } from "./tokenize.js";

/**
 * Consolidation, ported in shape from OpenClaw `b7528507`'s dreaming
 * (`docs/concepts/dreaming.md`, `src/memory-host-sdk/dreaming.ts`,
 * `extensions/memory-core/src/dreaming-consolidation.ts`). One managed daily
 * sweep runs three phases in order — light stages and dedupes recent
 * short-term material, REM reflects on recurring themes, deep ranks and
 * promotes — and only the deep phase writes durable memory, into MEMORY.md
 * alone. Everything here is pure: the candidate shape, the six-signal
 * ranking and its gates, the tool-free consolidation prompt, the validation
 * a proposed rewrite must pass, the deterministic append-only fallback, and
 * the Dream Diary's text. What reads files and the store is the caller's.
 */

export const CONSOLIDATION_DEFAULTS = {
  FREQUENCY_CRON: "0 3 * * *",
  JOB_ID: "memory-consolidation",
  JOB_NAME: "Memory consolidation",
  LIGHT_LOOKBACK_DAYS: 2,
  LIGHT_LIMIT: 100,
  LIGHT_DEDUPE_SIMILARITY: 0.9,
  REM_LOOKBACK_DAYS: 7,
  REM_LIMIT: 10,
  REM_MIN_PATTERN_STRENGTH: 0.75,
  DEEP_LIMIT: 10,
  DEEP_MIN_SCORE: 0.75,
  DEEP_MIN_RECALL_COUNT: 3,
  DEEP_MIN_UNIQUE_QUERIES: 3,
  DEEP_RECENCY_HALF_LIFE_DAYS: 14,
  DEEP_MAX_AGE_DAYS: 30,
  DEEP_MAX_PROMOTED_SNIPPET_TOKENS: 160,
  DEEP_MAX_PRIOR_ENTRY_LOSS_FRACTION: 0.25,
  /** The bootstrap-safe budget for MEMORY.md: the per-file prompt bound. */
  MEMORY_FILE_MAX_CHARS: 20_000,
  CONSOLIDATION_TIMEOUT_MS: 60_000,
  /** How many message hashes one conversation's ingestion remembers. */
  MAX_TRACKED_MESSAGES_PER_SESSION: 4_096,
  CHARS_PER_TOKEN_ESTIMATE: 4,
} as const;

export const DREAMS_FILE = "DREAMS.md";

/** Who a candidate's evidence came from; external and system material never becomes trusted by repetition. */
export const CANDIDATE_ORIGIN = {
  USER: "user",
  AGENT: "agent",
  EXTERNAL: "external",
  SYSTEM: "system",
} as const;

export type CandidateOrigin = (typeof CANDIDATE_ORIGIN)[keyof typeof CANDIDATE_ORIGIN];

const CANDIDATE_ORIGIN_LIST: readonly CandidateOrigin[] = Object.values(CANDIDATE_ORIGIN);

/** What kind of conversation the evidence came from; only interactive ones feed durable memory. */
export const CANDIDATE_SESSION_KIND = {
  INTERACTIVE: "interactive",
  BACKGROUND: "background",
  UNKNOWN: "unknown",
} as const;

export type CandidateSessionKind =
  (typeof CANDIDATE_SESSION_KIND)[keyof typeof CANDIDATE_SESSION_KIND];

const CANDIDATE_SESSION_KIND_LIST: readonly CandidateSessionKind[] =
  Object.values(CANDIDATE_SESSION_KIND);

export const CANDIDATE_STATUS = {
  STAGED: "staged",
  PROMOTED: "promoted",
  DROPPED: "dropped",
} as const;

export type CandidateStatus = (typeof CANDIDATE_STATUS)[keyof typeof CANDIDATE_STATUS];

const CANDIDATE_STATUS_LIST: readonly CandidateStatus[] = Object.values(CANDIDATE_STATUS);

export const CONSOLIDATION_PHASE = {
  LIGHT: "light",
  REM: "rem",
  DEEP: "deep",
} as const;

export type ConsolidationPhase = (typeof CONSOLIDATION_PHASE)[keyof typeof CONSOLIDATION_PHASE];

/**
 * One short-term candidate as the store keeps it: the words, where they came
 * from, who said them, and the signals recall and the phases have added.
 */
export interface MemoryCandidate {
  readonly key: string;
  readonly text: string;
  /** The source's path: a dated note, or `conversation:<key>` for a History line. */
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly origin: CandidateOrigin;
  readonly sessionKind: CandidateSessionKind;
  readonly sourceSessionKey?: string;
  /** The History line's id when the evidence is a line, so a deleted source is recognized. */
  readonly sourceEventId?: string;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly signalCount: number;
  readonly totalScore: number;
  readonly recallCount: number;
  readonly queries: readonly string[];
  readonly days: readonly string[];
  readonly tags: readonly string[];
  readonly lightHits: number;
  readonly remHits: number;
  readonly lastPhaseHitAt?: number;
  readonly supersedesKey?: string;
  readonly status: CandidateStatus;
  readonly promotedAt?: number;
}

export function candidateKeyFor(path: string, text: string): string {
  return createHash("sha256")
    .update(`${path}\u0000${text.replace(/\s+/g, " ").trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 24);
}

/** A candidate's words, one-lined and cut to the promoted snippet bound. */
export function boundCandidateText(text: string): string {
  const maximum =
    CONSOLIDATION_DEFAULTS.DEEP_MAX_PROMOTED_SNIPPET_TOKENS *
    CONSOLIDATION_DEFAULTS.CHARS_PER_TOKEN_ESTIMATE;
  return stripBullet(text).replace(/\s+/gu, " ").trim().slice(0, maximum).trimEnd();
}

export interface CandidateSeed {
  readonly text: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly origin: CandidateOrigin;
  readonly sessionKind: CandidateSessionKind;
  readonly sourceSessionKey?: string;
  readonly sourceEventId?: string;
  /** The query, or the ingestion day, that surfaced it; one distinct query per signal. */
  readonly query: string;
  readonly score: number;
  readonly day: string;
  readonly supersedesKey?: string;
}

/** A fresh candidate from one signal; the store merges a second signal for the same key into it. */
export function candidateFromSeed(seed: CandidateSeed, now: number): MemoryCandidate {
  const text = boundCandidateText(seed.text);
  return {
    key: candidateKeyFor(seed.path, text),
    text,
    path: seed.path,
    startLine: seed.startLine,
    endLine: seed.endLine,
    origin: seed.origin,
    sessionKind: seed.sessionKind,
    ...(seed.sourceSessionKey ? { sourceSessionKey: seed.sourceSessionKey } : undefined),
    ...(seed.sourceEventId ? { sourceEventId: seed.sourceEventId } : undefined),
    firstSeenAt: now,
    lastSeenAt: now,
    signalCount: 1,
    totalScore: Math.max(0, Math.min(1, seed.score)),
    recallCount: 1,
    queries: [seed.query],
    days: [seed.day],
    tags: conceptTags(text),
    lightHits: 0,
    remHits: 0,
    ...(seed.supersedesKey ? { supersedesKey: seed.supersedesKey } : undefined),
    status: CANDIDATE_STATUS.STAGED,
  };
}

/** The candidate with one more signal folded in: counts up, the query and day added once, the origin never widened to trusted. */
export function reinforceCandidate(
  held: MemoryCandidate,
  seed: CandidateSeed,
  now: number,
): MemoryCandidate {
  const origin =
    trustedOrigin(held.origin) && trustedOrigin(seed.origin)
      ? held.origin
      : leastTrusted(held.origin, seed.origin);
  return {
    ...held,
    origin,
    sessionKind:
      held.sessionKind === CANDIDATE_SESSION_KIND.INTERACTIVE &&
      seed.sessionKind === CANDIDATE_SESSION_KIND.INTERACTIVE
        ? CANDIDATE_SESSION_KIND.INTERACTIVE
        : held.sessionKind === CANDIDATE_SESSION_KIND.UNKNOWN ||
            seed.sessionKind === CANDIDATE_SESSION_KIND.UNKNOWN
          ? CANDIDATE_SESSION_KIND.UNKNOWN
          : CANDIDATE_SESSION_KIND.BACKGROUND,
    lastSeenAt: Math.max(held.lastSeenAt, now),
    signalCount: held.signalCount + 1,
    totalScore: held.totalScore + Math.max(0, Math.min(1, seed.score)),
    recallCount: held.recallCount + 1,
    queries: held.queries.includes(seed.query) ? held.queries : [...held.queries, seed.query],
    days: held.days.includes(seed.day) ? held.days : [...held.days, seed.day],
    ...(seed.supersedesKey && !held.supersedesKey
      ? { supersedesKey: seed.supersedesKey }
      : undefined),
  };
}

function trustedOrigin(origin: CandidateOrigin): boolean {
  return origin === CANDIDATE_ORIGIN.USER || origin === CANDIDATE_ORIGIN.AGENT;
}

const ORIGIN_TRUST_ORDER: readonly CandidateOrigin[] = [
  CANDIDATE_ORIGIN.USER,
  CANDIDATE_ORIGIN.AGENT,
  CANDIDATE_ORIGIN.EXTERNAL,
  CANDIDATE_ORIGIN.SYSTEM,
];

function leastTrusted(left: CandidateOrigin, right: CandidateOrigin): CandidateOrigin {
  return ORIGIN_TRUST_ORDER.indexOf(left) >= ORIGIN_TRUST_ORDER.indexOf(right) ? left : right;
}

/** The structural taint gate: an external or system origin never promotes through any durable write path. */
export function isPromotionOriginBlocked(candidate: Pick<MemoryCandidate, "origin">): boolean {
  return (
    candidate.origin === CANDIDATE_ORIGIN.EXTERNAL || candidate.origin === CANDIDATE_ORIGIN.SYSTEM
  );
}

/** Eligible for consolidation: a trusted origin, from an interactive conversation or a note, not yet promoted. */
export function isConsolidationCandidateEligible(candidate: MemoryCandidate): boolean {
  if (isPromotionOriginBlocked(candidate)) return false;
  if (candidate.status !== CANDIDATE_STATUS.STAGED) return false;
  if (isConversationCandidate(candidate)) {
    return candidate.sessionKind === CANDIDATE_SESSION_KIND.INTERACTIVE;
  }
  return true;
}

export const CONVERSATION_PATH_PREFIX = "conversation:";

export function conversationCandidatePath(sessionKey: SessionKey): string {
  return `${CONVERSATION_PATH_PREFIX}${sessionKey}`;
}

/** Whether a candidate's evidence is a History line rather than a note. */
export function isConversationCandidate(candidate: Pick<MemoryCandidate, "path">): boolean {
  return candidate.path.startsWith(CONVERSATION_PATH_PREFIX);
}

/** The query an ingestion day stages a seed under; one distinct query per day. */
export function ingestionQuery(day: string): string {
  return `ingest:${day}`;
}

/** An array of strings as a wire value, or nothing when it is anything else. */
export function wireStrings(value: UnparsedWireValue): readonly string[] | undefined {
  return Array.isArray(value) && value.every(isWireString) ? value : undefined;
}

/** A candidate as the store wrote it, read back; anything unreadable answers nothing. */
export function memoryCandidateFromWire(value: UnparsedWireValue): MemoryCandidate | undefined {
  if (!isRecord(value)) return undefined;
  const key = text(value.key);
  const words = text(value.text);
  const filePath = text(value.path);
  const origin = CANDIDATE_ORIGIN_LIST.find((candidate) => candidate === value.origin);
  const sessionKind = CANDIDATE_SESSION_KIND_LIST.find((kind) => kind === value.sessionKind);
  const status = CANDIDATE_STATUS_LIST.find((candidate) => candidate === value.status);
  const startLine = wholeNumber(value.startLine);
  const endLine = wholeNumber(value.endLine);
  const firstSeenAt = wholeNumber(value.firstSeenAt);
  const lastSeenAt = wholeNumber(value.lastSeenAt);
  const signalCount = wholeNumber(value.signalCount);
  const totalScore = wholeNumber(value.totalScore);
  const recallCount = wholeNumber(value.recallCount);
  const queries = wireStrings(value.queries);
  const days = wireStrings(value.days);
  const tags = wireStrings(value.tags);
  if (
    !key ||
    !words ||
    !filePath ||
    !origin ||
    !sessionKind ||
    !status ||
    startLine === undefined ||
    endLine === undefined ||
    firstSeenAt === undefined ||
    lastSeenAt === undefined ||
    signalCount === undefined ||
    totalScore === undefined ||
    recallCount === undefined ||
    !queries ||
    !days ||
    !tags
  ) {
    return undefined;
  }
  const sourceSessionKey = text(value.sourceSessionKey);
  const sourceEventId = text(value.sourceEventId);
  const supersedesKey = text(value.supersedesKey);
  const lastPhaseHitAt = wholeNumber(value.lastPhaseHitAt);
  const promotedAt = wholeNumber(value.promotedAt);
  return {
    key,
    text: words,
    path: filePath,
    startLine,
    endLine,
    origin,
    sessionKind,
    ...(sourceSessionKey ? { sourceSessionKey } : undefined),
    ...(sourceEventId ? { sourceEventId } : undefined),
    firstSeenAt,
    lastSeenAt,
    signalCount,
    totalScore,
    recallCount,
    queries,
    days,
    tags,
    lightHits: wholeNumber(value.lightHits) ?? 0,
    remHits: wholeNumber(value.remHits) ?? 0,
    ...(lastPhaseHitAt !== undefined ? { lastPhaseHitAt } : undefined),
    ...(supersedesKey ? { supersedesKey } : undefined),
    status,
    ...(promotedAt !== undefined ? { promotedAt } : undefined),
  };
}
