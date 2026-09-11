import fs from "node:fs";
import path from "node:path";
import * as Client from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import * as SqlSchema from "@effect/sql/SqlSchema";
import {
  bm25RankToScore,
  buildFtsQuery,
  chunkMarkdown,
  cosineSimilarity,
  defaultRankingOptions,
  type EmbeddingModelIdentity,
  type EmbeddingWrite,
  hashText,
  type IndexedFileWrite,
  type IndexedSourceRecord,
  isNotebookRootFile,
  type KeywordHit,
  MEMORY_ORIGIN,
  MEMORY_SEARCH_DEFAULTS,
  MEMORY_SOURCE,
  type MemoryApplyReport,
  type MemoryOrigin,
  type MemoryProvenance,
  type MemoryReadResult,
  type MemoryScanPlan,
  type MemorySearchOutcome,
  type MemorySearchQuery,
  mergeHybridResults,
  NOTEBOOK_ROOT_FILES,
  parseEmbedding,
  parseNotebook,
  selectHybridSearchResults,
  serializeEmbedding,
  type VectorHit,
} from "@sidecar/memory";
import { DAILY_NOTES_DIRECTORY, WORKSPACE_FILE } from "@sidecar/runtime";
import { isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { Effect, Option, Schema } from "effect";
import type { NotebookEntry } from "./notebook-table.js";
import { columnsDecoded } from "./rows.js";

/**
 * The disposable search index over the notebook's Markdown files, in the
 * agent's own database. The files are the source of truth and the index is
 * derived: a scan reads every file the notebook root holds, compares each
 * against what the index recorded, and answers which changed and which
 * chunks still need a vector; an apply writes the chunks, their FTS5 rows,
 * and the embedding cache in one transaction; a search runs the lexical
 * rank in SQLite and the cosine similarity here on the worker, never on the
 * main thread; and a rebuild drops every derived row so the next scan
 * indexes everything again from the files alone. The scan and the read stay
 * the synchronous file-system calls they always were; only the rows beside
 * them move onto the client here.
 */

const MEMORY_ROOT_FILES: readonly string[] = NOTEBOOK_ROOT_FILES;

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
  if (isNotebookRootFile(relative)) return true;
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

function walkNotes(directory: string, found: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkNotes(absolute, found);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      found.push(absolute);
    }
  }
}

/** Every file the notebook root holds that the index may carry, read whole. */
function scanMemoryFiles(root: string): readonly ScannedFile[] {
  const absolutes = MEMORY_ROOT_FILES.map((name) => path.join(root, name));
  walkNotes(path.join(root, DAILY_NOTES_DIRECTORY), absolutes);
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

const IndexedSourceRow = Schema.Struct({
  path: Schema.String,
  source: Schema.String,
  hash: Schema.String,
  mtime: Schema.Number,
  size: Schema.Number,
});

const indexedSourceRows = SqlSchema.findAll({
  Request: Schema.Void,
  Result: IndexedSourceRow,
  execute: () =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) => sql`SELECT path, source, hash, mtime, size FROM memory_index_sources ORDER BY path`,
    ),
});

const listIndexedSourcesEffect: Effect.Effect<
  readonly IndexedSourceRecord[],
  SqlError,
  Client.SqlClient
> = Effect.map(columnsDecoded(indexedSourceRows()), (rows) =>
  rows.map((row) => ({
    path: row.path,
    source: MEMORY_SOURCE.MEMORY,
    hash: row.hash,
    mtimeMs: row.mtime,
    size: row.size,
  })),
);

const vectorCountRow = SqlSchema.findOne({
  Request: Schema.Struct({ filePath: Schema.String, model: Schema.String }),
  Result: Schema.Struct({ count: Schema.Number }),
  execute: ({ filePath, model }) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT COUNT(*) AS count FROM memory_index_chunks
            WHERE path = ${filePath} AND trim(text) <> '' AND (embedding = '' OR model <> ${model})`,
    ),
});

/** Whether any indexed chunk of the path has no vector under the model given. */
const lacksVectorsEffect = (
  filePath: string,
  identity: EmbeddingModelIdentity,
): Effect.Effect<boolean, SqlError, Client.SqlClient> =>
  Effect.map(columnsDecoded(vectorCountRow({ filePath, model: identity.model })), (row) =>
    Option.match(row, { onNone: () => false, onSome: ({ count }) => count > 0 }),
  );

const cachedEmbeddingRow = SqlSchema.findOne({
  Request: Schema.Struct({ provider: Schema.String, model: Schema.String, hash: Schema.String }),
  Result: Schema.Struct({ embedding: Schema.String }),
  execute: ({ provider, model, hash }) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT embedding FROM memory_embedding_cache
            WHERE provider = ${provider} AND model = ${model} AND hash = ${hash}`,
    ),
});

const cachedEmbeddingsEffect = (
  identity: EmbeddingModelIdentity,
  hashes: readonly string[],
): Effect.Effect<Map<string, readonly number[]>, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const found = new Map<string, readonly number[]>();
    for (const hash of hashes) {
      const row = yield* columnsDecoded(
        cachedEmbeddingRow({ provider: identity.provider, model: identity.model, hash }),
      );
      const vector = Option.match(row, {
        onNone: () => undefined,
        onSome: ({ embedding }) => parseEmbedding(embedding),
      });
      if (vector) found.set(hash, vector);
    }
    return found;
  });

/**
 * Compares the files on disk with the index and plans the apply: files whose
 * hash moved (or were never indexed) are chunked, files the index holds but
 * the disk no longer does are removed, and the chunk texts with no cached
 * vector are listed for the main thread to embed. USER.md chunks carry the
 * ids of the notebook entries whose lines they cover, read from the entries
 * handed in: the plan itself writes nothing, so the caller reconciles the
 * notebook first.
 */
export const planMemorySyncEffect = (
  root: string,
  identity: EmbeddingModelIdentity | undefined,
  entries: readonly Pick<NotebookEntry, "id" | "words">[],
): Effect.Effect<MemoryScanPlan, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const files = scanMemoryFiles(root);
    const indexed = new Map(
      (yield* listIndexedSourcesEffect).map((record) => [record.path, record]),
    );
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
        !(identity && (yield* lacksVectorsEffect(file.path, identity)))
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
      changed.push({
        path: file.path,
        source: MEMORY_SOURCE.MEMORY,
        hash: file.hash,
        mtimeMs: file.mtimeMs,
        size: file.size,
        origin: MEMORY_ORIGIN.AGENT,
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
    const cached = identity ? yield* cachedEmbeddingsEffect(identity, [...hashes]) : new Map();
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
  });

const putCachedEmbeddingsEffect = (
  identity: EmbeddingModelIdentity,
  embeddings: readonly EmbeddingWrite[],
  now: number,
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* Client.SqlClient;
    for (const embedding of embeddings) {
      yield* sql`INSERT INTO memory_embedding_cache (provider, model, hash, embedding, dims, updated_at)
                 VALUES (${identity.provider}, ${identity.model}, ${embedding.hash},
                         ${serializeEmbedding(embedding.vector)}, ${embedding.vector.length}, ${now})
                 ON CONFLICT(provider, model, hash) DO UPDATE SET embedding = excluded.embedding,
                   dims = excluded.dims, updated_at = excluded.updated_at`;
    }
    yield* sql`DELETE FROM memory_embedding_cache WHERE rowid IN (
                 SELECT rowid FROM memory_embedding_cache ORDER BY updated_at DESC, rowid DESC
                 LIMIT -1 OFFSET ${MEMORY_SEARCH_DEFAULTS.EMBEDDING_CACHE_MAXIMUM_ENTRIES}
               )`;
  });

const removeIndexedPathEffect = (
  filePath: string,
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* Client.SqlClient;
    yield* sql`DELETE FROM memory_index_chunks_fts WHERE path = ${filePath}`;
    yield* sql`DELETE FROM memory_index_chunks WHERE path = ${filePath}`;
    yield* sql`DELETE FROM memory_index_sources WHERE path = ${filePath}`;
  });

/**
 * Writes a planned sync: each changed file's chunks replace what the index
 * held for that path, each vector given is cached and stored on its chunk,
 * a chunk with no vector is stored for keyword search alone, and removed
 * paths lose their rows. One transaction, so a search never sees half a file.
 */
export const applyMemorySyncEffect = (
  plan: { changed: readonly IndexedFileWrite[]; removed: readonly string[] },
  embeddings: readonly EmbeddingWrite[],
  identity: EmbeddingModelIdentity | undefined,
  now: number,
): Effect.Effect<MemoryApplyReport, SqlError, Client.SqlClient> =>
  Effect.flatMap(Client.SqlClient, (sql) =>
    sql.withTransaction(
      Effect.gen(function* () {
        if (identity && embeddings.length > 0) {
          yield* putCachedEmbeddingsEffect(identity, embeddings, now);
        }
        const vectors = new Map(embeddings.map((embedding) => [embedding.hash, embedding.vector]));
        const hashes = plan.changed.flatMap((file) => file.chunks.map((chunk) => chunk.hash));
        const cached = identity ? yield* cachedEmbeddingsEffect(identity, hashes) : new Map();
        let indexedChunks = 0;
        let embeddedChunks = 0;
        for (const removed of plan.removed) yield* removeIndexedPathEffect(removed);
        for (const file of plan.changed) {
          yield* removeIndexedPathEffect(file.path);
          yield* sql`INSERT INTO memory_index_sources (path, source, hash, mtime, size, origin, indexed_at)
                     VALUES (${file.path}, ${file.source}, ${file.hash}, ${file.mtimeMs}, ${file.size},
                             ${file.origin}, ${now})`;
          for (const chunk of file.chunks) {
            const vector = vectors.get(chunk.hash) ?? cached.get(chunk.hash);
            const id = chunkId(file.path, chunk.startLine, chunk.endLine, chunk.hash);
            yield* sql`INSERT INTO memory_index_chunks
                         (id, path, source, start_line, end_line, hash, model, text, embedding, entry_ids, updated_at)
                       VALUES (${id}, ${file.path}, ${file.source}, ${chunk.startLine}, ${chunk.endLine},
                               ${chunk.hash}, ${vector && identity ? identity.model : ""}, ${chunk.text},
                               ${vector ? serializeEmbedding(vector) : ""},
                               ${chunk.entryIds ? JSON.stringify(chunk.entryIds) : null}, ${now})`;
            yield* sql`INSERT INTO memory_index_chunks_fts (text, id, path)
                       VALUES (${chunk.text}, ${id}, ${file.path})`;
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
      }),
    ),
  );

/** Drops every derived row; the files stand, and the next sync indexes them all again. */
export const rebuildMemoryIndexEffect: Effect.Effect<boolean, SqlError, Client.SqlClient> =
  Effect.flatMap(Client.SqlClient, (sql) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`DELETE FROM memory_index_chunks_fts`;
        yield* sql`DELETE FROM memory_index_chunks`;
        yield* sql`DELETE FROM memory_index_sources`;
        return true;
      }),
    ),
  );

export interface MemoryIndexStatus {
  readonly sources: number;
  readonly chunks: number;
  readonly embeddedChunks: number;
  readonly cachedEmbeddings: number;
}

const CountRow = Schema.Struct({ count: Schema.Number });

const sourcesCountRow = SqlSchema.findOne({
  Request: Schema.Void,
  Result: CountRow,
  execute: () =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) => sql`SELECT COUNT(*) AS count FROM memory_index_sources`,
    ),
});

const chunksCountRow = SqlSchema.findOne({
  Request: Schema.Void,
  Result: CountRow,
  execute: () =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) => sql`SELECT COUNT(*) AS count FROM memory_index_chunks`,
    ),
});

const embeddedChunksCountRow = SqlSchema.findOne({
  Request: Schema.Void,
  Result: CountRow,
  execute: () =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) => sql`SELECT COUNT(*) AS count FROM memory_index_chunks WHERE embedding <> ''`,
    ),
});

const cachedEmbeddingsCountRow = SqlSchema.findOne({
  Request: Schema.Void,
  Result: CountRow,
  execute: () =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) => sql`SELECT COUNT(*) AS count FROM memory_embedding_cache`,
    ),
});

const countOf = (found: Option.Option<{ count: number }>): number =>
  Option.match(found, { onNone: () => 0, onSome: ({ count }) => count });

export const memoryIndexStatusEffect: Effect.Effect<MemoryIndexStatus, SqlError, Client.SqlClient> =
  Effect.gen(function* () {
    return {
      sources: countOf(yield* columnsDecoded(sourcesCountRow())),
      chunks: countOf(yield* columnsDecoded(chunksCountRow())),
      embeddedChunks: countOf(yield* columnsDecoded(embeddedChunksCountRow())),
      cachedEmbeddings: countOf(yield* columnsDecoded(cachedEmbeddingsCountRow())),
    };
  });

const ChunkRow = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  start_line: Schema.Number,
  end_line: Schema.Number,
  text: Schema.String,
  embedding: Schema.String,
  entry_ids: Schema.NullOr(Schema.String),
  updated_at: Schema.Number,
  origin: Schema.String,
});

type ChunkRow = Schema.Schema.Type<typeof ChunkRow>;

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

const keywordChunkRows = SqlSchema.findAll({
  Request: Schema.Struct({ fts: Schema.String, limit: Schema.Number }),
  Result: Schema.extend(ChunkRow, Schema.Struct({ rank: Schema.Number })),
  execute: ({ fts, limit }) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT ${sql.literal(CHUNK_COLUMNS)}, bm25(memory_index_chunks_fts) AS rank
            FROM memory_index_chunks_fts f
            JOIN memory_index_chunks c ON c.id = f.id
            LEFT JOIN memory_index_sources s ON s.path = c.path
            WHERE memory_index_chunks_fts MATCH ${fts}
            ORDER BY rank LIMIT ${limit}`,
    ),
});

const keywordSearchEffect = (
  query: string,
  limit: number,
): Effect.Effect<readonly KeywordHit[], SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const fts = buildFtsQuery(query);
    if (!fts) return [];
    const rows = yield* columnsDecoded(keywordChunkRows({ fts, limit }));
    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      snippet: row.text,
      textScore: bm25RankToScore(row.rank),
      provenance: provenanceOf(row),
    }));
  });

const vectorChunkRows = SqlSchema.findAll({
  Request: Schema.String,
  Result: ChunkRow,
  execute: (model) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT ${sql.literal(CHUNK_COLUMNS)} FROM memory_index_chunks c
            LEFT JOIN memory_index_sources s ON s.path = c.path
            WHERE c.model = ${model} AND c.embedding <> ''`,
    ),
});

/** Cosine similarity over every stored vector of the model given, here on the worker. */
const vectorSearchEffect = (
  queryVector: readonly number[],
  identity: EmbeddingModelIdentity,
  limit: number,
): Effect.Effect<readonly VectorHit[], SqlError, Client.SqlClient> =>
  Effect.map(columnsDecoded(vectorChunkRows(identity.model)), (rows) => {
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
  });

/** One hybrid search: candidates from both rankings under the multiplier, merged, decayed, diversified, and windowed. */
export const searchMemoryIndexEffect = (
  query: MemorySearchQuery,
): Effect.Effect<MemorySearchOutcome, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const maxResults = query.maxResults ?? MEMORY_SEARCH_DEFAULTS.MAXIMUM_RESULTS;
    const minScore = query.minScore ?? MEMORY_SEARCH_DEFAULTS.MINIMUM_SCORE;
    const candidates = Math.max(1, maxResults * MEMORY_SEARCH_DEFAULTS.CANDIDATE_MULTIPLIER);
    const keyword = yield* keywordSearchEffect(query.query, candidates);
    const vector =
      query.queryVector && query.identity
        ? yield* vectorSearchEffect(query.queryVector, query.identity, candidates)
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
  });

/** The most lines one read answers when none are asked for. */
const MEMORY_READ_DEFAULT_LINES = 120;
const MEMORY_READ_MAXIMUM_LINES = 400;

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
