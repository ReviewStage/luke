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
 * The private-conversation recall defaults, pinned to the same revision's
 * `extensions/active-memory/types.ts`.
 */
export const RECALL_DEFAULTS = {
  TIMEOUT_MS: 15_000,
  MAXIMUM_SUMMARY_CHARS: 220,
  RECENT_USER_TURNS: 2,
  RECENT_ASSISTANT_TURNS: 1,
  RECENT_USER_CHARS: 220,
  RECENT_ASSISTANT_CHARS: 180,
  CACHE_TTL_MS: 15_000,
  MAXIMUM_CACHE_ENTRIES: 1_000,
  CIRCUIT_BREAKER_MAXIMUM_TIMEOUTS: 3,
  CIRCUIT_BREAKER_COOLDOWN_MS: 60_000,
  MAXIMUM_QUERY_CHARS: 480,
} as const;

/** How embeddings are chosen: automatically, by name, or not at all. */
export const EMBEDDING_PROVIDER_SELECTION = {
  AUTO: "auto",
  OPENAI: "openai",
  NONE: "none",
} as const;

export type EmbeddingProviderSelection =
  (typeof EMBEDDING_PROVIDER_SELECTION)[keyof typeof EMBEDDING_PROVIDER_SELECTION];

/**
 * The retrieval mode a search actually ran in. Hybrid is the design; keyword
 * alone is what an automatic provider degrades to when its embeddings cannot
 * be had; unavailable is what an explicitly selected provider's failure
 * earns, because the developer asked for that provider and nothing else.
 */
export const RETRIEVAL_MODE = {
  HYBRID: "hybrid",
  KEYWORD_ONLY: "keyword-only",
  UNAVAILABLE: "unavailable",
} as const;

export type RetrievalMode = (typeof RETRIEVAL_MODE)[keyof typeof RETRIEVAL_MODE];
