import { DAY_MS } from "@sidecar/runtime/vocabulary";

/**
 * How the notebook's passages are ranked for one search, in process and
 * with nothing kept between searches: a keyword lane (BM25 over the
 * passages' own words), a vector lane (cosine over the embeddings the caller
 * hands in, absent in keyword-only mode), each lane normalised to its best
 * hit, the two combined by the weights the pinned OpenClaw `b7528507` uses
 * (`hybrid.ts` under `extensions/memory-core/src/memory`), and the sum
 * decayed by an exponential recency with a 30-day half-life from the note's
 * day for a dated note or from the row's last change otherwise. Nothing
 * here reads a file or a row: the caller cuts and gathers, this module
 * scores and orders.
 */

/**
 * The mode a search actually ran in. Hybrid is the design; keyword alone is
 * what a search degrades to when its embeddings cannot be had, and the answer
 * says so.
 */
export const RETRIEVAL_MODE = {
  HYBRID: "hybrid",
  KEYWORD: "keyword",
} as const;

export type RetrievalMode = (typeof RETRIEVAL_MODE)[keyof typeof RETRIEVAL_MODE];

export const MEMORY_RANKING = {
  /** The vector lane's share of a hybrid score, pinned to the source above. */
  VECTOR_WEIGHT: 0.7,
  /** The keyword lane's share, the rest. */
  TEXT_WEIGHT: 0.3,
  /** A passage's score halves for every 30 days since its note's day or its row's last change. */
  RECENCY_HALF_LIFE_DAYS: 30,
  /** BM25's term-frequency saturation and length normalisation, the textbook defaults. */
  BM25_K1: 1.2,
  BM25_B: 0.75,
  /** The longest a result's snippet runs, so a result names its passage without carrying the whole of it. */
  SNIPPET_CHARS: 240,
} as const;

/**
 * The CJK-aware tokenizer of the same revision's `tokenize.ts`: ASCII words,
 * CJK characters, and their adjacent bigrams, duplicates kept so a term's
 * frequency counts.
 */
const CJK_RE = /[぀-ゟ゠-ヿ㐀-䶿一-鿿가-힯ᄀ-ᇿ]/u;

export function tokenize(text: string): readonly string[] {
  const lower = text.toLowerCase();
  const ascii = lower.match(/[a-z0-9_]+/g) ?? [];
  const chars = Array.from(lower);
  const cjk: { char: string; index: number }[] = [];
  chars.forEach((char, index) => {
    if (CJK_RE.test(char)) cjk.push({ char, index });
  });
  const bigrams: string[] = [];
  for (let i = 1; i < cjk.length; i += 1) {
    const previous = cjk[i - 1];
    const next = cjk[i];
    if (previous && next && next.index === previous.index + 1) {
      bigrams.push(previous.char + next.char);
    }
  }
  return [...ascii, ...bigrams, ...cjk.map((entry) => entry.char)];
}

function termFrequencies(terms: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  return counts;
}

/**
 * Okapi BM25 of every document against the query, in the documents' order:
 * zero for a document sharing no term with the query. The inverse document
 * frequency is the smoothed form that never goes negative, so a term every
 * passage carries adds nothing rather than subtracting.
 */
export function bm25Scores(
  query: readonly string[],
  documents: readonly (readonly string[])[],
): readonly number[] {
  if (documents.length === 0) return [];
  const asked = [...new Set(query)];
  if (asked.length === 0) return documents.map(() => 0);
  const frequencies = documents.map(termFrequencies);
  const averageLength =
    documents.reduce((total, document) => total + document.length, 0) / documents.length;
  const documentFrequency = new Map<string, number>();
  for (const term of asked) {
    let count = 0;
    for (const frequency of frequencies) if (frequency.has(term)) count += 1;
    documentFrequency.set(term, count);
  }
  const total = documents.length;
  return documents.map((document, index) => {
    const frequency = frequencies[index];
    if (!frequency) return 0;
    let score = 0;
    for (const term of asked) {
      const tf = frequency.get(term) ?? 0;
      if (tf === 0) continue;
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
      const lengthShare = averageLength === 0 ? 1 : document.length / averageLength;
      const saturated =
        (tf * (MEMORY_RANKING.BM25_K1 + 1)) /
        (tf +
          MEMORY_RANKING.BM25_K1 *
            (1 - MEMORY_RANKING.BM25_B + MEMORY_RANKING.BM25_B * lengthShare));
      score += idf * saturated;
    }
    return score;
  });
}

/** The similarity every vector rank reads; two vectors of unequal width are unrelated. */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

const DATED_NOTE_PATH_RE = /^memory\/(\d{4})-(\d{2})-(\d{2})(?:-[^/]+)?\.md$/;

/** The day a dated note is about, as the UTC instant its day begins, read from its path; nothing for any other path. */
export function datedNoteDay(path: string): number | undefined {
  const match = DATED_NOTE_PATH_RE.exec(path);
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
  return parsed.getTime();
}

/** The weight an age earns: one for now or the future, a half at the half-life, and so on. */
export function recencyWeight(
  ageMs: number,
  halfLifeDays: number = MEMORY_RANKING.RECENCY_HALF_LIFE_DAYS,
): number {
  const ageDays = Math.max(0, ageMs) / DAY_MS;
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0 || !Number.isFinite(ageDays)) return 1;
  return Math.exp(-(Math.LN2 / halfLifeDays) * ageDays);
}

/** Every score as a share of the best, so the two lanes meet on one scale; all zeros stay zeros. */
function normalised(scores: readonly number[]): readonly number[] {
  const best = scores.reduce((most, score) => Math.max(most, score), 0);
  return best <= 0 ? scores.map(() => 0) : scores.map((score) => Math.max(0, score) / best);
}

/** The first words of a passage, whitespace folded, cut to the snippet bound. */
export function snippetOf(text: string): string {
  const folded = text.replace(/\s+/g, " ").trim();
  return folded.length <= MEMORY_RANKING.SNIPPET_CHARS
    ? folded
    : `${folded.slice(0, MEMORY_RANKING.SNIPPET_CHARS - 1)}…`;
}

/** One passage as the caller gathered it: where it stands, its words, the vector it has (if any), and when its row last changed. */
export interface PassageCandidate {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  /** The passage's embedding under the search's model, absent for a passage not yet embedded; ranked by keyword alone then. */
  readonly vector?: readonly number[] | undefined;
  /** When the row holding the passage last changed, the recency anchor for a file that is not a dated note. */
  readonly updatedAt: number;
}

export interface RankedPassage {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly snippet: string;
  /** In (0, 1]: the lanes' weighted sum, decayed by recency. */
  readonly score: number;
}

export interface RankingAsk {
  readonly query: string;
  /** The query's embedding under the same model as the passages' vectors; absent runs the keyword lane alone. */
  readonly queryVector?: readonly number[] | undefined;
  readonly passages: readonly PassageCandidate[];
  readonly now: number;
  readonly maxResults: number;
}

/**
 * The search's order: every passage with a positive score, best first, ties
 * broken by path and line so two runs over the same rows answer the same
 * list, cut to the window asked for. In keyword-only mode the keyword lane is
 * the whole score, so a keyword-only best still scores one before decay; in
 * hybrid mode a passage without a vector keeps only its keyword share.
 */
export function rankPassages(ask: RankingAsk): readonly RankedPassage[] {
  if (ask.passages.length === 0 || ask.maxResults <= 0) return [];
  const queryTerms = tokenize(ask.query);
  const textScores = normalised(
    bm25Scores(
      queryTerms,
      ask.passages.map((passage) => tokenize(passage.text)),
    ),
  );
  const queryVector = ask.queryVector;
  const vectorScores = normalised(
    ask.passages.map((passage) =>
      queryVector && passage.vector ? cosineSimilarity(queryVector, passage.vector) : 0,
    ),
  );
  const scored = ask.passages.flatMap((passage, index) => {
    const text = textScores[index] ?? 0;
    const vector = vectorScores[index] ?? 0;
    const combined = queryVector
      ? MEMORY_RANKING.TEXT_WEIGHT * text + MEMORY_RANKING.VECTOR_WEIGHT * vector
      : text;
    if (combined <= 0) return [];
    const anchor = datedNoteDay(passage.path) ?? passage.updatedAt;
    const score = combined * recencyWeight(ask.now - anchor);
    return [
      {
        path: passage.path,
        startLine: passage.startLine,
        endLine: passage.endLine,
        snippet: snippetOf(passage.text),
        score,
      },
    ];
  });
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.path.localeCompare(b.path) ||
        a.startLine - b.startLine ||
        a.endLine - b.endLine,
    )
    .slice(0, ask.maxResults);
}
