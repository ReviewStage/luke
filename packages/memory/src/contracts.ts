import type { RetrievalMode } from "./defaults.js";

/**
 * The vocabulary the memory index, its store, and its tools share. The store
 * that implements `MemoryIndexStore` runs on the database worker; the service
 * that drives it runs in the main process and never touches SQLite itself.
 */

/**
 * Where a search result came from: the notebook's indexed files, or a line
 * already said in an eligible past private conversation, read from the
 * retained history rather than from any index. Nothing merges the two.
 */
export const MEMORY_SOURCE = {
  MEMORY: "memory",
  CONVERSATIONS: "conversations",
} as const;

export type MemorySource = (typeof MEMORY_SOURCE)[keyof typeof MEMORY_SOURCE];

/**
 * Who wrote what a chunk holds, as the index records it: the developer's
 * own hand or Luke's own tools on the notebook, a migrated stable fact, or
 * material the index cannot attribute.
 */
export const MEMORY_ORIGIN = {
  AGENT: "agent",
  USER: "user",
  MIGRATED_FACT: "migrated-fact",
  UNTRUSTED: "untrusted",
} as const;

export type MemoryOrigin = (typeof MEMORY_ORIGIN)[keyof typeof MEMORY_ORIGIN];

export interface MemoryProvenance {
  readonly origin: MemoryOrigin;
  /** The file's path relative to the notebook root. */
  readonly path: string;
  readonly indexedAt: number;
  /** The notebook entry ids the chunk's lines carry, when the chunk covers notebook entries. */
  readonly entryIds?: readonly string[];
}

export interface MemorySearchResult {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly score: number;
  readonly vectorScore: number;
  readonly textScore: number;
  readonly snippet: string;
  readonly source: MemorySource;
  readonly provenance: MemoryProvenance;
}

export interface MemorySearchAnswer {
  readonly mode: RetrievalMode;
  readonly results: readonly MemorySearchResult[];
  /** Why the mode is not hybrid, in words the model can read. */
  readonly note?: string;
}

/** A source file as the index recorded it last. */
export interface IndexedSourceRecord {
  readonly path: string;
  readonly source: MemorySource;
  readonly hash: string;
  readonly mtimeMs: number;
  readonly size: number;
}

/** A chunk as the index writes it: the vector is absent in keyword-only mode. */
export interface IndexedChunkWrite {
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  readonly hash: string;
  readonly embedding?: readonly number[];
  readonly entryIds?: readonly string[];
}

export interface IndexedFileWrite {
  readonly path: string;
  readonly source: MemorySource;
  readonly hash: string;
  readonly mtimeMs: number;
  readonly size: number;
  readonly origin: MemoryOrigin;
  readonly chunks: readonly IndexedChunkWrite[];
}

/** The identity vectors were made under; a search only reads vectors of the same identity. */
export interface EmbeddingModelIdentity {
  readonly provider: string;
  readonly model: string;
}

export interface KeywordHit {
  readonly id: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly snippet: string;
  readonly textScore: number;
  readonly provenance: MemoryProvenance;
}

export interface VectorHit {
  readonly id: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly snippet: string;
  readonly vectorScore: number;
  readonly provenance: MemoryProvenance;
}

/** What a read of one file's lines answers with. */
export interface MemoryReadResult {
  readonly path: string;
  readonly text: string;
  readonly from: number;
  readonly to: number;
  readonly totalLines: number;
  readonly truncated: boolean;
}
