import {
  cutPassages,
  maximumMemorySearchResults,
  type NotebookMemoryAccess,
  type PassageCandidate,
  type RankedPassage,
  RETRIEVAL_MODE,
  type RetrievalMode,
  rankPassages,
} from "@sidecar/memory";
import { Effect, type Schema } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  ACTION_RESULT_STATUS,
  DAILY_NOTES_DIRECTORY,
  guardedRead,
  type WireRecord,
  WORKSPACE_FILE,
} from "../../core.js";
import type { HostedStore } from "../store/index.js";
import type { HostedEmbedder } from "./embedding.js";

/**
 * The hosted brain's notebook index, which is no index at all but a search
 * run whole at the moment it is asked: the account's `MEMORY.md`, `USER.md`,
 * and every note under `memory/` are read from their sealed rows, opened,
 * cut into passages, and ranked in process by keyword and, when Luke's own
 * embeddings credential stands, by vector too. The only thing kept between
 * searches is the embedding cache — a hash and a vector per passage, never
 * a word — filled for the passages a search finds unembedded, at most
 * `EMBED_BATCH` of them a search so no turn waits on a backfill, and pruned
 * on every search to the passages the workspace holds now, so a deleted or
 * rewritten note's vectors go the next time anyone searches. The query is embedded once, in
 * the same call as those passages, under the turn's own signal: a turn that
 * ends mid-call answers keyword-only rather than waiting the model out.
 * `memory_get` reads one of the same files by line range, bounded, and
 * refuses any path that is not the notebook's.
 */

export const NOTEBOOK_SEARCH = {
  /** The most passages one search embeds that were not yet cached; the rest are ranked by keyword alone that turn. */
  EMBED_BATCH: 64,
  /** How many lines `memory_get` answers when asked for none. */
  DEFAULT_LINES: 80,
  /** The most lines one `memory_get` answers, whatever it asks. */
  MAXIMUM_LINES: 400,
} as const;

export const HOSTED_NOTEBOOK_REFUSAL = {
  NOT_NOTEBOOK: "not read: that path is not a notebook file",
  NOT_FOUND: "not read: no notebook file stands at that path",
  PAST_END: "not read: the file ends before that line",
} as const;

/** Why a search was not hybrid, or not wholly so, in words the model can read back. */
export const NOTEBOOK_SEARCH_NOTE = {
  NO_CREDENTIAL: "keyword-only: this deployment holds no embedding credential",
  NOT_ANSWERED: "keyword-only: the embeddings model did not answer",
  TURN_OVER: "keyword-only: the turn ended before the embeddings answered",
} as const;

export interface HostedNotebookSeams {
  /** The request's own connection, provided into every row read here. */
  readonly client: SqlClient.SqlClient;
  /** The request's own HTTP client, provided into the one embeddings call a search makes. */
  readonly http: HttpClient.HttpClient;
  readonly store: Pick<HostedStore, "workspace" | "embeddings">;
  readonly userId: string;
  /** Luke's own embedder, or nothing when the deployment holds no key: the search then runs keyword-only and says so. */
  readonly embedder: HostedEmbedder | undefined;
  readonly now: () => number;
  /** The backfill bound, `NOTEBOOK_SEARCH.EMBED_BATCH` unless a test narrows it. */
  readonly embedBatch?: number;
}

const NOTES_PREFIX = `${DAILY_NOTES_DIRECTORY}/`;
const NOTE_NAME_RE = /^[^/]+\.md$/;

/** A name as the notebook's path, or nothing for one outside the notebook: MEMORY.md, USER.md, and a Markdown file directly under memory/. */
export function notebookPath(name: string): string | undefined {
  if (name === WORKSPACE_FILE.MEMORY || name === WORKSPACE_FILE.USER) return name;
  if (!name.startsWith(NOTES_PREFIX)) return undefined;
  return NOTE_NAME_RE.test(name.slice(NOTES_PREFIX.length)) ? name : undefined;
}

/** A passage as this search gathered it: where it stands, its words, its hash, and when its row last changed. */
interface GatheredPassage extends PassageCandidate {
  readonly hash: string;
}

/** What the vector lane settled on: the mode, why it is not wholly hybrid, the query's vector, and the vectors by hash. */
interface VectorLane {
  readonly mode: RetrievalMode;
  readonly note?: string;
  readonly queryVector?: readonly number[];
  readonly vectors: ReadonlyMap<string, readonly number[]>;
}

function keywordOnly(note: string): VectorLane {
  return { mode: RETRIEVAL_MODE.KEYWORD, note, vectors: new Map() };
}

function rejection(reason: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** A result as the model reads it: the path and the range `memory_get` takes back, a snippet, and the score. */
function resultRecord(result: RankedPassage): WireRecord {
  return {
    path: result.path,
    from: result.startLine,
    lines: result.endLine - result.startLine + 1,
    snippet: result.snippet,
    score: Number(result.score.toFixed(4)),
  };
}

/**
 * The notebook's two reads over the account's rows. `NotebookMemoryAccess`
 * answers `Effect<WireRecord>`, but a row is read over `SqlClient` and the
 * embeddings call over `HttpClient`, so the request's own two are provided
 * here and `Effect.orDie` stands for the error the contract has nowhere to
 * say: a row this service cannot read is not a refusal the model is offered
 * a reason for.
 */
export function hostedNotebookAccess(seams: HostedNotebookSeams): NotebookMemoryAccess {
  const { store, userId } = seams;
  const embedBatch = seams.embedBatch ?? NOTEBOOK_SEARCH.EMBED_BATCH;
  const run = <A>(
    effect: Effect.Effect<A, SqlError | Schema.SchemaError, SqlClient.SqlClient>,
  ): Effect.Effect<A> =>
    Effect.orDie(Effect.provideService(effect, SqlClient.SqlClient, seams.client));

  /** Every notebook file of the account, opened, with its passages cut. */
  const gather = Effect.gen(function* () {
    const listed = yield* store.workspace.list(userId);
    const paths = listed.flatMap((listing) => {
      const path = notebookPath(listing.path);
      return path === undefined ? [] : [path];
    });
    const files = yield* Effect.forEach(paths, (path) => store.workspace.read(userId, path));
    return files.flatMap((file): GatheredPassage[] =>
      file === undefined
        ? []
        : cutPassages(file.content).map((passage) => ({
            path: file.path,
            startLine: passage.startLine,
            endLine: passage.endLine,
            text: passage.text,
            hash: passage.hash,
            updatedAt: file.updatedAt,
          })),
    );
  });

  /**
   * The vector lane for one search: the cached vectors by hash, the query
   * and up to `embedBatch` uncached passages embedded in one call under the
   * turn's signal, the new vectors cached and the stale rows dropped, and
   * the mode the answer names.
   */
  const vectorLane = (
    query: string,
    passages: readonly GatheredPassage[],
    signal: AbortSignal,
  ): Effect.Effect<VectorLane, SqlError | Schema.SchemaError, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      const embedder = seams.embedder;
      if (!embedder) return keywordOnly(NOTEBOOK_SEARCH_NOTE.NO_CREDENTIAL);
      const byHash = new Map(passages.map((passage) => [passage.hash, passage]));
      const hashes = [...byHash.keys()];
      // The cache follows the workspace on every search, not only one that
      // embeds something new: a note deleted or rewritten since the last
      // search loses its vectors here, one statement, before anything is
      // read, and an emptied notebook prunes the account's cache to nothing.
      yield* store.embeddings.prune(userId, hashes);
      if (passages.length === 0) return { mode: RETRIEVAL_MODE.HYBRID, vectors: new Map() };
      const cached = yield* store.embeddings.read(userId, embedder.model, hashes);
      const uncached = hashes.flatMap((hash) => {
        const passage = byHash.get(hash);
        return passage === undefined || cached.has(hash) ? [] : [passage];
      });
      const embedding = uncached.slice(0, embedBatch);
      const vectors = yield* guardedRead(
        Effect.provideService(
          embedder.embed([query, ...embedding.map((passage) => passage.text)]),
          HttpClient.HttpClient,
          seams.http,
        ),
        { isRevoked: () => signal.aborted, signal },
      );
      if (vectors === undefined) {
        return keywordOnly(
          signal.aborted ? NOTEBOOK_SEARCH_NOTE.TURN_OVER : NOTEBOOK_SEARCH_NOTE.NOT_ANSWERED,
        );
      }
      const [queryVector, ...passageVectors] = vectors;
      if (queryVector === undefined) return keywordOnly(NOTEBOOK_SEARCH_NOTE.NOT_ANSWERED);
      const learned = new Map(cached);
      const writes = embedding.flatMap((passage, index) => {
        const vector = passageVectors[index];
        if (vector === undefined) return [];
        learned.set(passage.hash, vector);
        return [{ hash: passage.hash, vector }];
      });
      if (writes.length > 0) {
        yield* store.embeddings.write(userId, embedder.model, writes, seams.now());
      }
      const pending = uncached.length - embedding.length;
      return {
        mode: RETRIEVAL_MODE.HYBRID,
        queryVector,
        vectors: learned,
        ...(pending > 0
          ? {
              note: `${pending} passages await embedding and were ranked by keyword alone this turn`,
            }
          : undefined),
      };
    });

  return {
    search: (ask) =>
      run(
        Effect.gen(function* () {
          const passages = yield* gather;
          const lane = yield* vectorLane(ask.query, passages, ask.signal);
          const ranked = rankPassages({
            query: ask.query,
            ...(lane.queryVector ? { queryVector: lane.queryVector } : undefined),
            passages: passages.map((passage) => ({
              ...passage,
              vector: lane.vectors.get(passage.hash),
            })),
            now: seams.now(),
            maxResults: ask.maxResults ?? maximumMemorySearchResults,
          });
          return {
            status: ACTION_RESULT_STATUS.ACCEPTED,
            mode: lane.mode,
            ...(lane.note ? { note: lane.note } : undefined),
            results: ranked.map(resultRecord),
          };
        }),
      ),
    get: (ask) =>
      run(
        Effect.gen(function* () {
          const path = notebookPath(ask.path);
          if (path === undefined) return rejection(HOSTED_NOTEBOOK_REFUSAL.NOT_NOTEBOOK);
          const row = yield* store.workspace.read(userId, path);
          if (row === undefined) return rejection(HOSTED_NOTEBOOK_REFUSAL.NOT_FOUND);
          const lines = row.content.split("\n");
          const total = lines.length;
          const from = ask.from ?? 1;
          if (from > total) return rejection(HOSTED_NOTEBOOK_REFUSAL.PAST_END);
          const count = Math.min(
            ask.lines ?? NOTEBOOK_SEARCH.DEFAULT_LINES,
            NOTEBOOK_SEARCH.MAXIMUM_LINES,
          );
          const to = Math.min(total, from + count - 1);
          return {
            status: ACTION_RESULT_STATUS.ACCEPTED,
            path,
            from,
            to,
            total_lines: total,
            truncated: to < total,
            text: lines.slice(from - 1, to).join("\n"),
          };
        }),
      ),
  };
}
