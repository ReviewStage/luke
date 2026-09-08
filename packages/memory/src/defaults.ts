/**
 * The retrieval defaults, pinned to OpenClaw `b7528507`
 * (`src/agents/memory-search.ts`). Changing one of these is a deliberate
 * change to the parity fixture, not a tuning an implementer makes alone.
 */
export const MEMORY_SEARCH_DEFAULTS = {
  CHUNK_TOKENS: 400,
  CHUNK_OVERLAP_TOKENS: 80,
  WATCH_DEBOUNCE_MS: 1_500,
  MAXIMUM_RESULTS: 6,
  MINIMUM_SCORE: 0.35,
  VECTOR_WEIGHT: 0.7,
  TEXT_WEIGHT: 0.3,
  CANDIDATE_MULTIPLIER: 4,
  MMR_ENABLED: true,
  MMR_LAMBDA: 0.7,
  TEMPORAL_DECAY_ENABLED: true,
  TEMPORAL_DECAY_HALF_LIFE_DAYS: 30,
  EMBEDDING_CACHE_MAXIMUM_ENTRIES: 50_000,
  /** The pinned source estimates four characters per token when it cuts a chunk. */
  CHARS_PER_TOKEN_ESTIMATE: 4,
} as const;

/**
 * The most characters one memory query carries, pinned to the same
 * revision's `extensions/active-memory/types.ts`.
 */
export const MEMORY_QUERY_MAXIMUM_CHARS = 480;

/**
 * The retrieval mode a search actually ran in. Hybrid is the design;
 * keyword alone is what a search degrades to when its embeddings cannot be
 * had, and the answer says so.
 */
export const RETRIEVAL_MODE = {
  HYBRID: "hybrid",
  KEYWORD_ONLY: "keyword-only",
} as const;

export type RetrievalMode = (typeof RETRIEVAL_MODE)[keyof typeof RETRIEVAL_MODE];
