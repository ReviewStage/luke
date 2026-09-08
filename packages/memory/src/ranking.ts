import type { KeywordHit, MemorySearchResult, MemorySource, VectorHit } from "./contracts.js";
import { MEMORY_SEARCH_DEFAULTS } from "./defaults.js";
import { isNotebookRootFile } from "./notebook-markdown.js";
import { jaccardSimilarity, textSimilarity, tokenize } from "./tokenize.js";

/**
 * How the two rankings become one answer, ported from OpenClaw `b7528507`
 * (`hybrid.ts`, `mmr.ts`, `temporal-decay.ts` under
 * `extensions/memory-core/src/memory`): the vector and keyword hits are
 * joined by chunk id and weighted, dated notes decay with a half-life while
 * the evergreen files (MEMORY.md, USER.md, undated notes) never do, and
 * maximal marginal relevance diversifies the top of the list. The result
 * window is the strict matches over the minimum score, topped up with
 * keyword-only hits when the window has room, and the all-lexical fallback
 * stands when nothing scores above the threshold.
 */

export interface HybridRankingOptions {
  readonly vectorWeight: number;
  readonly textWeight: number;
  readonly mmr: { readonly enabled: boolean; readonly lambda: number };
  readonly temporalDecay: { readonly enabled: boolean; readonly halfLifeDays: number };
  readonly nowMs: number;
}

export function defaultRankingOptions(nowMs: number): HybridRankingOptions {
  return {
    vectorWeight: MEMORY_SEARCH_DEFAULTS.VECTOR_WEIGHT,
    textWeight: MEMORY_SEARCH_DEFAULTS.TEXT_WEIGHT,
    mmr: { enabled: MEMORY_SEARCH_DEFAULTS.MMR_ENABLED, lambda: MEMORY_SEARCH_DEFAULTS.MMR_LAMBDA },
    temporalDecay: {
      enabled: MEMORY_SEARCH_DEFAULTS.TEMPORAL_DECAY_ENABLED,
      halfLifeDays: MEMORY_SEARCH_DEFAULTS.TEMPORAL_DECAY_HALF_LIFE_DAYS,
    },
    nowMs,
  };
}

/** The FTS5 query the pinned source builds: every token quoted and required. */
export function buildFtsQuery(raw: string): string | undefined {
  const tokens = raw.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (tokens.length === 0) return undefined;
  return tokens.map((token) => `"${token.replaceAll('"', "")}"`).join(" AND ");
}

/** A bm25 rank (lower is better, negative in SQLite) as a score in (0, 1]. */
export function bm25RankToScore(rank: number): number {
  if (!Number.isFinite(rank)) return 1 / (1 + 999);
  if (rank < 0) {
    const relevance = -rank;
    return relevance / (1 + relevance);
  }
  return 1 / (1 + rank);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DATED_MEMORY_PATH_RE = /(?:^|\/)memory\/(?:[^/]+\/)*(\d{4})-(\d{2})-(\d{2})(?:-[^/]+)?\.md$/;

/** The day a dated note is about, read from its name; nothing for any other path. */
export function datedNoteDay(path: string): Date | undefined {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  const match = DATED_MEMORY_PATH_RE.exec(normalized);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return undefined;
  }
  return parsed;
}

/** MEMORY.md, USER.md, and an undated note are knowledge that stands; only a dated note ages. */
export function isEvergreenMemoryPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (isNotebookRootFile(normalized)) return true;
  if (!normalized.startsWith("memory/")) return false;
  return !DATED_MEMORY_PATH_RE.test(normalized);
}

export function decayedScore(score: number, ageDays: number, halfLifeDays: number): number {
  const age = Math.max(0, ageDays);
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0 || !Number.isFinite(age)) return score;
  return score * Math.exp(-(Math.LN2 / halfLifeDays) * age);
}

interface MmrItem {
  id: string;
  score: number;
  content: string;
}

/** Maximal marginal relevance: λ·relevance − (1−λ)·max similarity to what is already chosen. */
export function mmrRerank<T extends MmrItem>(items: readonly T[], lambda: number): T[] {
  if (items.length <= 1) return [...items];
  const clamped = Math.max(0, Math.min(1, lambda));
  if (clamped === 1) return [...items].sort((a, b) => b.score - a.score);
  const tokens = new Map(items.map((item) => [item.id, tokenize(item.content)]));
  const scores = items.map((item) => item.score);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const range = maxScore - minScore;
  const normalized = (score: number) => (range === 0 ? 1 : (score - minScore) / range);
  const selected: T[] = [];
  const remaining = new Set(items);
  const maxSimilarity = new Map<T, number>();
  while (remaining.size > 0) {
    let best: T | undefined;
    let bestMmr = Number.NEGATIVE_INFINITY;
    for (const candidate of remaining) {
      const mmr =
        clamped * normalized(candidate.score) - (1 - clamped) * (maxSimilarity.get(candidate) ?? 0);
      if (
        mmr > bestMmr ||
        (mmr === bestMmr && candidate.score > (best?.score ?? Number.NEGATIVE_INFINITY))
      ) {
        bestMmr = mmr;
        best = candidate;
      }
    }
    if (!best) break;
    selected.push(best);
    remaining.delete(best);
    const chosenTokens = tokens.get(best.id) ?? tokenize(best.content);
    for (const candidate of remaining) {
      const candidateTokens = tokens.get(candidate.id) ?? tokenize(candidate.content);
      const similarity =
        candidateTokens.size === 0 && chosenTokens.size === 0
          ? textSimilarity(candidate.content, best.content)
          : jaccardSimilarity(candidateTokens, chosenTokens);
      if (similarity > (maxSimilarity.get(candidate) ?? 0)) {
        maxSimilarity.set(candidate, similarity);
      }
    }
  }
  return selected;
}

interface Merged {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  vectorScore: number;
  textScore: number;
  hasKeyword: boolean;
  provenance: MemorySearchResult["provenance"];
}

/** The two hit lists as one ranked list, decayed and diversified; not yet cut to the window. */
export function mergeHybridResults(
  vector: readonly VectorHit[],
  keyword: readonly KeywordHit[],
  source: MemorySource,
  options: HybridRankingOptions,
): MemorySearchResult[] {
  const byId = new Map<string, Merged>();
  for (const hit of vector) {
    byId.set(hit.id, {
      id: hit.id,
      path: hit.path,
      startLine: hit.startLine,
      endLine: hit.endLine,
      snippet: hit.snippet,
      vectorScore: hit.vectorScore,
      textScore: 0,
      hasKeyword: false,
      provenance: hit.provenance,
    });
  }
  for (const hit of keyword) {
    const existing = byId.get(hit.id);
    if (existing) {
      existing.textScore = hit.textScore;
      existing.hasKeyword = true;
      if (hit.snippet.length > 0) existing.snippet = hit.snippet;
    } else {
      byId.set(hit.id, {
        id: hit.id,
        path: hit.path,
        startLine: hit.startLine,
        endLine: hit.endLine,
        snippet: hit.snippet,
        vectorScore: 0,
        textScore: hit.textScore,
        hasKeyword: true,
        provenance: hit.provenance,
      });
    }
  }
  const merged = [...byId.values()].map((entry) => {
    const combined =
      options.vectorWeight * entry.vectorScore + options.textWeight * entry.textScore;
    let score = combined;
    if (options.temporalDecay.enabled) {
      const day = datedNoteDay(entry.path);
      if (day && !isEvergreenMemoryPath(entry.path)) {
        score = decayedScore(
          combined,
          (options.nowMs - day.getTime()) / DAY_MS,
          options.temporalDecay.halfLifeDays,
        );
      }
    }
    return { ...entry, score };
  });
  const sorted = merged.sort(
    (a, b) =>
      b.score - a.score ||
      a.path.localeCompare(b.path) ||
      a.startLine - b.startLine ||
      a.endLine - b.endLine,
  );
  const ranked = options.mmr.enabled
    ? mmrRerank(
        sorted.map((entry) => ({ ...entry, content: entry.snippet })),
        options.mmr.lambda,
      )
    : sorted;
  return ranked.map((entry) => ({
    path: entry.path,
    startLine: entry.startLine,
    endLine: entry.endLine,
    score: entry.score,
    vectorScore: entry.vectorScore,
    textScore: entry.textScore,
    snippet: entry.snippet,
    source,
    provenance: entry.provenance,
  }));
}

type LineRange = Pick<MemorySearchResult, "path" | "startLine" | "endLine">;

/** The ranges seen so far, by path, start, and end, so no key is ever composed from them. */
class RangeSet {
  readonly #ranges = new Map<string, Map<number, Set<number>>>();

  constructor(ranges: readonly LineRange[] = []) {
    for (const range of ranges) this.add(range);
  }

  add(range: LineRange): void {
    let starts = this.#ranges.get(range.path);
    if (!starts) {
      starts = new Map();
      this.#ranges.set(range.path, starts);
    }
    let ends = starts.get(range.startLine);
    if (!ends) {
      ends = new Set();
      starts.set(range.startLine, ends);
    }
    ends.add(range.endLine);
  }

  has(range: LineRange): boolean {
    return this.#ranges.get(range.path)?.get(range.startLine)?.has(range.endLine) ?? false;
  }
}

/**
 * The window: strict matches first, keyword-only hits into spare room, and
 * the lexical fallback when nothing clears the threshold, exactly as the
 * pinned `selectHybridSearchResults` has it.
 */
export function selectHybridSearchResults(params: {
  merged: readonly MemorySearchResult[];
  keyword: readonly Pick<KeywordHit, "path" | "startLine" | "endLine">[];
  maxResults: number;
  minScore: number;
}): MemorySearchResult[] {
  const strict = params.merged.filter((entry) => entry.score >= params.minScore);
  const selected = strict.slice(0, params.maxResults);
  if (params.keyword.length === 0 || selected.length === params.maxResults) return selected;
  const keywordRanges = new RangeSet(params.keyword);
  if (strict.length === 0) {
    return params.merged
      .filter((entry) => entry.score >= 0 && keywordRanges.has(entry))
      .slice(0, params.maxResults);
  }
  const seen = new RangeSet(selected);
  for (const entry of params.merged) {
    if (selected.length === params.maxResults) break;
    if (
      entry.score < params.minScore &&
      entry.vectorScore === 0 &&
      keywordRanges.has(entry) &&
      !seen.has(entry)
    ) {
      seen.add(entry);
      selected.push(entry);
    }
  }
  return selected;
}
