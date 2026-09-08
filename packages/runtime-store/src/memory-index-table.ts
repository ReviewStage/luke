import fs from "node:fs";
import path from "node:path";
import {
  bm25RankToScore,
  buildFtsQuery,
  chunkMarkdown,
  cosineSimilarity,
  defaultRankingOptions,
  type EmbeddingModelIdentity,
  hashText,
  type IndexedFileWrite,
  type IndexedSourceRecord,
  type KeywordHit,
  MEMORY_ORIGIN,
  MEMORY_SEARCH_DEFAULTS,
  MEMORY_SOURCE,
  type MemoryOrigin,
  type MemoryProvenance,
  type MemoryReadResult,
  type MemorySearchResult,
  mergeHybridResults,
  parseEmbedding,
  parseNotebook,
  selectHybridSearchResults,
  serializeEmbedding,
  type VectorHit,
} from "@sidecar/memory";
import { DAILY_NOTES_DIRECTORY, WORKSPACE_FILE } from "@sidecar/runtime";
import { isWireString, type UnparsedWireValue } from "@sidecar/wire";
import type { RuntimeDatabase } from "./database.js";
import { listNotebookEntries } from "./notebook-table.js";

/**
 * The disposable search index over the notebook's Markdown files, in the
 * agent's own database. The files are the source of truth and the index is
 * derived: a scan reads every file the notebook root holds, compares each
 * against what the index recorded, and answers which changed and which
 * chunks still need a vector; an apply writes the chunks, their FTS5 rows,
 * and the embedding cache in one transaction; a search runs the lexical
 * rank in SQLite and the cosine similarity here on the worker, never on the
 * main thread; and a rebuild drops every derived row so the next scan
 * indexes everything again from the files alone.
 */

export const MEMORY_ROOT_FILES: readonly string[] = [WORKSPACE_FILE.MEMORY, WORKSPACE_FILE.USER];

/** A chunk's id names its place and content, so an unchanged chunk keeps its id across scans. */
function chunkId(filePath: string, startLine: number, endLine: number, hash: string): string {
  return `${filePath}:${startLine}-${endLine}:${hash.slice(0, 12)}`;
}

function normalizedRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

/** Whether a relative path names a file the index may hold or a read may open: the two root files, or a Markdown note under memory/. */
export function isMemoryPath(relative: string): boolean {
  if (relative.includes("..") || path.isAbsolute(relative) || relative.includes("\\")) return false;
  if (MEMORY_ROOT_FILES.includes(relative)) return true;
  if (!relative.startsWith(`${DAILY_NOTES_DIRECTORY}/`)) return false;
  return relative.endsWith(".md") && !relative.includes("/./") && !relative.includes("//");
}

/** The absolute file a relative memory path names, once it is inside the root; nothing otherwise. */
export function resolveMemoryPath(root: string, relative: string): string | undefined {
  if (!isMemoryPath(relative)) return undefined;
  const resolved = path.resolve(root, relative);
  const rootResolved = path.resolve(root);
  return resolved.startsWith(`${rootResolved}${path.sep}`) ? resolved : undefined;
}

interface ScannedFile {
  readonly path: string;
  readonly content: string;
  readonly hash: string;
  readonly mtimeMs: number;
  readonly size: number;
}

function readIfFile(
  absolute: string,
): { content: string; mtimeMs: number; size: number } | undefined {
  try {
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) return undefined;
    return { content: fs.readFileSync(absolute, "utf8"), mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return undefined;
  }
}

function walkNotes(root: string, directory: string, found: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkNotes(root, absolute, found);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      found.push(absolute);
    }
  }
}

/** Every file the notebook root holds that the index may carry, read whole. */
export function scanMemoryFiles(root: string): readonly ScannedFile[] {
  const absolutes = MEMORY_ROOT_FILES.map((name) => path.join(root, name));
  walkNotes(root, path.join(root, DAILY_NOTES_DIRECTORY), absolutes);
  const files: ScannedFile[] = [];
  for (const absolute of absolutes) {
    const relative = normalizedRelative(root, absolute);
    if (!isMemoryPath(relative)) continue;
    const read = readIfFile(absolute);
    if (!read) continue;
    files.push({
      path: relative,
      content: read.content,
      hash: hashText(read.content),
      mtimeMs: read.mtimeMs,
      size: read.size,
    });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function listIndexedSources(database: RuntimeDatabase): readonly IndexedSourceRecord[] {
  // SAFETY: the columns selected are the ones the row type names.
  const rows = database
    .prepare("SELECT path, source, hash, mtime, size FROM memory_index_sources ORDER BY path")
    .all() as { path: string; source: string; hash: string; mtime: number; size: number }[];
  return rows.map((row) => ({
    path: row.path,
    source: MEMORY_SOURCE.MEMORY,
    hash: row.hash,
    mtimeMs: row.mtime,
    size: row.size,
  }));
}

export interface MemoryScanPlan {
  readonly changed: readonly IndexedFileWrite[];
  readonly removed: readonly string[];
  /** Chunk hashes among the changed files with no vector cached under the identity given. */
  readonly missingEmbeddings: readonly { hash: string; text: string }[];
  readonly unchanged: number;
}

/**
 * Compares the files on disk with the index and plans the apply: files whose
 * hash moved (or were never indexed) are chunked, files the index holds but
 * the disk no longer does are removed, and the chunk texts with no cached
 * vector are listed for the main thread to embed. USER.md chunks carry the
 * ids of the notebook entries whose lines they cover.
 */
export function planMemorySync(
  database: RuntimeDatabase,
  root: string,
  identity: EmbeddingModelIdentity | undefined,
  now: number,
): MemoryScanPlan {
  const files = scanMemoryFiles(root);
  const indexed = new Map(listIndexedSources(database).map((record) => [record.path, record]));
  const entries = listNotebookEntries(database, root, now);
  const changed: IndexedFileWrite[] = [];
  let unchanged = 0;
  for (const file of files) {
    const known = indexed.get(file.path);
    indexed.delete(file.path);
    // An unchanged file is done only when every chunk of it already carries a
    // vector under the identity asked for: a file indexed before a credential
    // stood, or while the embedding provider was failing, is planned again so
    // its vectors are backfilled without waiting for the developer to edit it.
    if (
      known &&
      known.hash === file.hash &&
      !(identity && lacksVectors(database, file.path, identity))
    ) {
      unchanged += 1;
      continue;
    }
    const entryLines =
      file.path === WORKSPACE_FILE.USER
        ? new Map(
            parseNotebook(file.content).entries.flatMap((parsed) => {
              const entry = entries.find((candidate) => candidate.words === parsed.words);
              return entry ? [[parsed.line, entry.id] as const] : [];
            }),
          )
        : new Map<number, string>();
    const origin: MemoryOrigin = MEMORY_ORIGIN.AGENT;
    changed.push({
      path: file.path,
      source: MEMORY_SOURCE.MEMORY,
      hash: file.hash,
      mtimeMs: file.mtimeMs,
      size: file.size,
      origin,
      chunks: chunkMarkdown(file.content).map((chunk) => {
        const ids = [...entryLines.entries()]
          .filter(([line]) => line >= chunk.startLine && line <= chunk.endLine)
          .map(([, id]) => id);
        return {
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          text: chunk.text,
          hash: chunk.hash,
          ...(ids.length > 0 ? { entryIds: ids } : undefined),
        };
      }),
    });
  }
  const hashes = new Set(changed.flatMap((file) => file.chunks.map((chunk) => chunk.hash)));
  const cached = identity ? cachedEmbeddings(database, identity, [...hashes]) : new Map();
  const missing = new Map<string, string>();
  if (identity) {
    for (const file of changed) {
      for (const chunk of file.chunks) {
        if (!cached.has(chunk.hash) && chunk.text.trim().length > 0) {
          missing.set(chunk.hash, chunk.text);
        }
      }
    }
  }
  return {
    changed,
    removed: [...indexed.keys()],
    missingEmbeddings: [...missing.entries()].map(([hash, text]) => ({ hash, text })),
    unchanged,
  };
}

/** Whether any indexed chunk of the path has no vector under the model given. */
function lacksVectors(
  database: RuntimeDatabase,
  filePath: string,
  identity: EmbeddingModelIdentity,
): boolean {
  // SAFETY: COUNT(*) is one integer column named `count`.
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count FROM memory_index_chunks
       WHERE path = ? AND trim(text) <> '' AND (embedding = '' OR model <> ?)`,
    )
    .get(filePath, identity.model) as { count: number };
  return row.count > 0;
}

export function cachedEmbeddings(
  database: RuntimeDatabase,
  identity: EmbeddingModelIdentity,
  hashes: readonly string[],
): Map<string, readonly number[]> {
  const found = new Map<string, readonly number[]>();
  const select = database.prepare(
    "SELECT embedding FROM memory_embedding_cache WHERE provider = ? AND model = ? AND hash = ?",
  );
  for (const hash of hashes) {
    // SAFETY: the one text column selected is the embedding's JSON.
    const row = select.get(identity.provider, identity.model, hash) as
      | { embedding: string }
      | undefined;
    const vector = row ? parseEmbedding(row.embedding) : undefined;
    if (vector) found.set(hash, vector);
  }
  return found;
}

export interface EmbeddingWrite {
  readonly hash: string;
  readonly vector: readonly number[];
}

function putCachedEmbeddings(
  database: RuntimeDatabase,
  identity: EmbeddingModelIdentity,
  embeddings: readonly EmbeddingWrite[],
  now: number,
): void {
  const insert = database.prepare(
    `INSERT INTO memory_embedding_cache (provider, model, hash, embedding, dims, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, model, hash) DO UPDATE SET embedding = excluded.embedding,
       dims = excluded.dims, updated_at = excluded.updated_at`,
  );
  for (const embedding of embeddings) {
    insert.run(
      identity.provider,
      identity.model,
      embedding.hash,
      serializeEmbedding(embedding.vector),
      embedding.vector.length,
      now,
    );
  }
  database
    .prepare(
      `DELETE FROM memory_embedding_cache WHERE rowid IN (
         SELECT rowid FROM memory_embedding_cache ORDER BY updated_at DESC, rowid DESC
         LIMIT -1 OFFSET ?
       )`,
    )
    .run(MEMORY_SEARCH_DEFAULTS.EMBEDDING_CACHE_MAXIMUM_ENTRIES);
}

export interface MemoryApplyReport {
  readonly indexedFiles: number;
  readonly removedFiles: number;
  readonly indexedChunks: number;
  readonly embeddedChunks: number;
}

export function removeIndexedPath(database: RuntimeDatabase, filePath: string): void {
  database.prepare("DELETE FROM memory_index_chunks_fts WHERE path = ?").run(filePath);
  database.prepare("DELETE FROM memory_index_chunks WHERE path = ?").run(filePath);
  database.prepare("DELETE FROM memory_index_sources WHERE path = ?").run(filePath);
}

/**
 * Writes a planned sync: each changed file's chunks replace what the index
 * held for that path, each vector given is cached and stored on its chunk,
 * a chunk with no vector is stored for keyword search alone, and removed
 * paths lose their rows. One transaction, so a search never sees half a file.
 */
export function applyMemorySync(
  database: RuntimeDatabase,
  plan: { changed: readonly IndexedFileWrite[]; removed: readonly string[] },
  embeddings: readonly EmbeddingWrite[],
  identity: EmbeddingModelIdentity | undefined,
  now: number,
): MemoryApplyReport {
  return database.transaction(() => {
    if (identity && embeddings.length > 0) putCachedEmbeddings(database, identity, embeddings, now);
    const vectors = new Map(embeddings.map((embedding) => [embedding.hash, embedding.vector]));
    const hashes = plan.changed.flatMap((file) => file.chunks.map((chunk) => chunk.hash));
    const cached = identity ? cachedEmbeddings(database, identity, hashes) : new Map();
    const insertSource = database.prepare(
      `INSERT INTO memory_index_sources (path, source, hash, mtime, size, origin, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertChunk = database.prepare(
      `INSERT INTO memory_index_chunks
         (id, path, source, start_line, end_line, hash, model, text, embedding, entry_ids, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertFts = database.prepare(
      "INSERT INTO memory_index_chunks_fts (text, id, path) VALUES (?, ?, ?)",
    );
    let indexedChunks = 0;
    let embeddedChunks = 0;
    for (const removed of plan.removed) removeIndexedPath(database, removed);
    for (const file of plan.changed) {
      removeIndexedPath(database, file.path);
      insertSource.run(
        file.path,
        file.source,
        file.hash,
        file.mtimeMs,
        file.size,
        file.origin,
        now,
      );
      for (const chunk of file.chunks) {
        const vector = vectors.get(chunk.hash) ?? cached.get(chunk.hash);
        const id = chunkId(file.path, chunk.startLine, chunk.endLine, chunk.hash);
        insertChunk.run(
          id,
          file.path,
          file.source,
          chunk.startLine,
          chunk.endLine,
          chunk.hash,
          vector && identity ? identity.model : "",
          chunk.text,
          vector ? serializeEmbedding(vector) : "",
          chunk.entryIds ? JSON.stringify(chunk.entryIds) : null,
          now,
        );
        insertFts.run(chunk.text, id, file.path);
        indexedChunks += 1;
        if (vector) embeddedChunks += 1;
      }
    }
    return {
      indexedFiles: plan.changed.length,
      removedFiles: plan.removed.length,
      indexedChunks,
      embeddedChunks,
    };
  });
}

/** Drops every derived row; the files stand, and the next sync indexes them all again. */
export function rebuildMemoryIndex(database: RuntimeDatabase): boolean {
  database.transaction(() => {
    database.exec("DELETE FROM memory_index_chunks_fts");
    database.exec("DELETE FROM memory_index_chunks");
    database.exec("DELETE FROM memory_index_sources");
  });
  return true;
}

export interface MemoryIndexStatus {
  readonly sources: number;
  readonly chunks: number;
  readonly embeddedChunks: number;
  readonly cachedEmbeddings: number;
}

export function memoryIndexStatus(database: RuntimeDatabase): MemoryIndexStatus {
  const count = (sql: string) =>
    // SAFETY: COUNT(*) is one integer column named `count`.
    (database.prepare(sql).get() as { count: number }).count;
  return {
    sources: count("SELECT COUNT(*) AS count FROM memory_index_sources"),
    chunks: count("SELECT COUNT(*) AS count FROM memory_index_chunks"),
    embeddedChunks: count(
      "SELECT COUNT(*) AS count FROM memory_index_chunks WHERE embedding <> ''",
    ),
    cachedEmbeddings: count("SELECT COUNT(*) AS count FROM memory_embedding_cache"),
  };
}

type ChunkRow = {
  id: string;
  path: string;
  start_line: number;
  end_line: number;
  text: string;
  embedding: string;
  entry_ids: string | null;
  updated_at: number;
  origin: string;
};

function entryIdsOf(serialized: string | null): string[] | undefined {
  if (!serialized) return undefined;
  // SAFETY: JSON.parse returns a runtime value; only its string members are kept below.
  const parsed = JSON.parse(serialized) as UnparsedWireValue;
  return Array.isArray(parsed) ? parsed.filter(isWireString) : undefined;
}

function provenanceOf(row: ChunkRow): MemoryProvenance {
  const ids = entryIdsOf(row.entry_ids);
  const origins: readonly string[] = Object.values(MEMORY_ORIGIN);
  return {
    // SAFETY: the origin column holds one of the vocabulary's values, written by applyMemorySync.
    origin: origins.includes(row.origin) ? (row.origin as MemoryOrigin) : MEMORY_ORIGIN.UNTRUSTED,
    path: row.path,
    indexedAt: row.updated_at,
    ...(ids && ids.length > 0 ? { entryIds: ids } : undefined),
  };
}

const CHUNK_COLUMNS = `c.id, c.path, c.start_line, c.end_line, c.text, c.embedding, c.entry_ids, c.updated_at,
  COALESCE(s.origin, '') AS origin`;

export function keywordSearch(
  database: RuntimeDatabase,
  query: string,
  limit: number,
): readonly KeywordHit[] {
  const fts = buildFtsQuery(query);
  if (!fts) return [];
  // SAFETY: the columns selected are the chunk row's, plus bm25's rank.
  const rows = database
    .prepare(
      `SELECT ${CHUNK_COLUMNS}, bm25(memory_index_chunks_fts) AS rank
       FROM memory_index_chunks_fts f
       JOIN memory_index_chunks c ON c.id = f.id
       LEFT JOIN memory_index_sources s ON s.path = c.path
       WHERE memory_index_chunks_fts MATCH ?
       ORDER BY rank LIMIT ?`,
    )
    .all(fts, limit) as (ChunkRow & { rank: number })[];
  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    startLine: row.start_line,
    endLine: row.end_line,
    snippet: row.text,
    textScore: bm25RankToScore(row.rank),
    provenance: provenanceOf(row),
  }));
}

/** Cosine similarity over every stored vector of the model given, here on the worker. */
export function vectorSearch(
  database: RuntimeDatabase,
  queryVector: readonly number[],
  identity: EmbeddingModelIdentity,
  limit: number,
): readonly VectorHit[] {
  // SAFETY: the columns selected are the chunk row's.
  const rows = database
    .prepare(
      `SELECT ${CHUNK_COLUMNS} FROM memory_index_chunks c
       LEFT JOIN memory_index_sources s ON s.path = c.path
       WHERE c.model = ? AND c.embedding <> ''`,
    )
    .all(identity.model) as ChunkRow[];
  const scored: VectorHit[] = [];
  for (const row of rows) {
    const vector = parseEmbedding(row.embedding);
    if (!vector) continue;
    const score = cosineSimilarity(queryVector, vector);
    if (score <= 0) continue;
    scored.push({
      id: row.id,
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      snippet: row.text,
      vectorScore: score,
      provenance: provenanceOf(row),
    });
  }
  return scored.sort((a, b) => b.vectorScore - a.vectorScore).slice(0, limit);
}

export interface MemorySearchQuery {
  readonly query: string;
  readonly queryVector?: readonly number[];
  readonly identity?: EmbeddingModelIdentity;
  readonly maxResults?: number;
  readonly minScore?: number;
  readonly now: number;
}

export interface MemorySearchOutcome {
  readonly results: readonly MemorySearchResult[];
  readonly keywordHits: number;
  readonly vectorHits: number;
}

/** One hybrid search: candidates from both rankings under the multiplier, merged, decayed, diversified, and windowed. */
export function searchMemoryIndex(
  database: RuntimeDatabase,
  query: MemorySearchQuery,
): MemorySearchOutcome {
  const maxResults = query.maxResults ?? MEMORY_SEARCH_DEFAULTS.MAXIMUM_RESULTS;
  const minScore = query.minScore ?? MEMORY_SEARCH_DEFAULTS.MINIMUM_SCORE;
  const candidates = Math.max(1, maxResults * MEMORY_SEARCH_DEFAULTS.CANDIDATE_MULTIPLIER);
  const keyword = keywordSearch(database, query.query, candidates);
  const vector =
    query.queryVector && query.identity
      ? vectorSearch(database, query.queryVector, query.identity, candidates)
      : [];
  const merged = mergeHybridResults(
    vector,
    keyword,
    MEMORY_SOURCE.MEMORY,
    defaultRankingOptions(query.now),
  );
  return {
    results: selectHybridSearchResults({ merged, keyword, maxResults, minScore }),
    keywordHits: keyword.length,
    vectorHits: vector.length,
  };
}

/** The most lines one read answers when none are asked for. */
export const MEMORY_READ_DEFAULT_LINES = 120;
export const MEMORY_READ_MAXIMUM_LINES = 400;

/**
 * Reads lines of one memory file for the model, the path validated against
 * the root and the range clamped to the file. A path outside the root, or
 * one the index would not carry, answers nothing at all.
 */
export function readMemoryLines(
  root: string,
  relative: string,
  from = 1,
  lines = MEMORY_READ_DEFAULT_LINES,
): MemoryReadResult | undefined {
  const absolute = resolveMemoryPath(root, relative);
  if (!absolute) return undefined;
  const read = readIfFile(absolute);
  if (!read) return undefined;
  const all = read.content.split("\n");
  const start = Math.max(1, Math.floor(from));
  const count = Math.min(MEMORY_READ_MAXIMUM_LINES, Math.max(1, Math.floor(lines)));
  const end = Math.min(all.length, start + count - 1);
  const slice = start <= all.length ? all.slice(start - 1, end) : [];
  return {
    path: relative,
    text: slice.join("\n"),
    from: start,
    to: Math.max(start - 1, end),
    totalLines: all.length,
    truncated: end < all.length,
  };
}
