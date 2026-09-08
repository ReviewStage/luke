import { DAY_MS } from "@sidecar/runtime-contracts";
import {
  CONSOLIDATION_DEFAULTS,
  isConsolidationCandidateEligible,
  type MemoryCandidate,
} from "./candidate.js";

/** The six weighted base signals of deep ranking, as the pinned design lists them. */
export const DEEP_RANKING_WEIGHTS = {
  RELEVANCE: 0.3,
  FREQUENCY: 0.24,
  QUERY_DIVERSITY: 0.15,
  RECENCY: 0.15,
  CONSOLIDATION: 0.1,
  CONCEPTUAL_RICHNESS: 0.06,
} as const;

/** The small recency-decayed boost light and REM hits add. */
const PHASE_BOOST_MAXIMUM = 0.05;

export interface DeepRanking {
  readonly score: number;
  readonly relevance: number;
  readonly frequency: number;
  readonly diversity: number;
  readonly recency: number;
  readonly consolidation: number;
  readonly conceptual: number;
  readonly phaseBoost: number;
}

function averageScore(candidate: MemoryCandidate): number {
  const signals = Math.max(1, candidate.signalCount);
  return Math.max(0, Math.min(1, candidate.totalScore / signals));
}

function decay(ageMs: number, halfLifeDays: number): number {
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  const halfLifeMs = halfLifeDays * DAY_MS;
  return halfLifeMs <= 0 ? 1 : 2 ** (-ageMs / halfLifeMs);
}

/**
 * The pinned ranking: six weighted base signals — relevance, frequency,
 * query diversity, recency, multi-day consolidation, conceptual richness —
 * plus a small recency-decayed boost from light and REM phase hits.
 */
export function rankCandidate(candidate: MemoryCandidate, nowMs: number): DeepRanking {
  const relevance = averageScore(candidate);
  const frequency = Math.min(1, Math.log1p(candidate.signalCount) / Math.log1p(6));
  const diversity = Math.min(1, candidate.queries.length / 3);
  const recency = decay(
    nowMs - candidate.lastSeenAt,
    CONSOLIDATION_DEFAULTS.DEEP_RECENCY_HALF_LIFE_DAYS,
  );
  const consolidation = Math.min(1, candidate.days.length / 3);
  const conceptual = Math.min(1, candidate.tags.length / 3);
  const hits = candidate.lightHits + candidate.remHits;
  const phaseBoost =
    hits > 0
      ? Math.min(PHASE_BOOST_MAXIMUM, hits * 0.01) *
        decay(
          nowMs - (candidate.lastPhaseHitAt ?? candidate.lastSeenAt),
          CONSOLIDATION_DEFAULTS.DEEP_RECENCY_HALF_LIFE_DAYS,
        )
      : 0;
  const score =
    relevance * DEEP_RANKING_WEIGHTS.RELEVANCE +
    frequency * DEEP_RANKING_WEIGHTS.FREQUENCY +
    diversity * DEEP_RANKING_WEIGHTS.QUERY_DIVERSITY +
    recency * DEEP_RANKING_WEIGHTS.RECENCY +
    consolidation * DEEP_RANKING_WEIGHTS.CONSOLIDATION +
    conceptual * DEEP_RANKING_WEIGHTS.CONCEPTUAL_RICHNESS +
    phaseBoost;
  return {
    score: Math.max(0, Math.min(1, score)),
    relevance,
    frequency,
    diversity,
    recency,
    consolidation,
    conceptual,
    phaseBoost,
  };
}

export interface RankedCandidate {
  readonly candidate: MemoryCandidate;
  readonly ranking: DeepRanking;
}

/** The default gates: score, recall count, and distinct queries must all pass, and the candidate must not be too old. */
export function passesDeepGates(ranked: RankedCandidate, nowMs: number): boolean {
  const { candidate, ranking } = ranked;
  const maxAgeMs = CONSOLIDATION_DEFAULTS.DEEP_MAX_AGE_DAYS * DAY_MS;
  if (nowMs - candidate.lastSeenAt > maxAgeMs) return false;
  return (
    ranking.score >= CONSOLIDATION_DEFAULTS.DEEP_MIN_SCORE &&
    candidate.recallCount >= CONSOLIDATION_DEFAULTS.DEEP_MIN_RECALL_COUNT &&
    candidate.queries.length >= CONSOLIDATION_DEFAULTS.DEEP_MIN_UNIQUE_QUERIES
  );
}

/** The eligible candidates that pass every gate, best first, at most the promotion limit. */
export function selectDeepPromotions(
  candidates: readonly MemoryCandidate[],
  nowMs: number,
  limit: number = CONSOLIDATION_DEFAULTS.DEEP_LIMIT,
): RankedCandidate[] {
  return candidates
    .filter(isConsolidationCandidateEligible)
    .map((candidate) => ({ candidate, ranking: rankCandidate(candidate, nowMs) }))
    .filter((ranked) => passesDeepGates(ranked, nowMs))
    .sort(
      (a, b) =>
        b.ranking.score - a.ranking.score || a.candidate.text.localeCompare(b.candidate.text),
    )
    .slice(0, Math.max(0, limit));
}
