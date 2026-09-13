import {
  type ConversationRecord,
  DEFAULT_AGENT_ID,
  type EmbeddingAdapter,
  MODEL_RESPONSE_OUTCOME,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/session";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { Data, Deferred, Duration, Effect, FileSystem, Ref, type Scope, Stream } from "effect";
import {
  type ConversationLineHit,
  type EmbeddingModelIdentity,
  type EmbeddingWrite,
  MEMORY_ORIGIN,
  MEMORY_SOURCE,
  type MemoryApplyReport,
  type MemoryReadResult,
  type MemoryScanPlan,
  type MemorySearchAnswer,
  type MemorySearchOutcome,
  type MemorySearchQuery,
  type MemorySearchResult,
  type MemorySyncApply,
} from "./contracts.js";
import { MEMORY_SEARCH_DEFAULTS, RETRIEVAL_MODE, type RetrievalMode } from "./defaults.js";
import { isRecallEligibleConversation } from "./eligibility.js";
import { selectHybridSearchResults, tokenize } from "./ranking.js";

/**
 * The notebook's index as one scoped effect over injected seams. The files
 * under the agent's workspace are the source of truth; the store's worker
 * keeps the derived index and does the ranking; this module drives the sync
 * (a plan from the store, the missing vectors from the embedding adapter, the
 * apply back to the store), watches the files for a hand edit, and answers
 * the brain's memory tools. It knows no database, no runtime, and no window:
 * the store and the adapter are handed in, and the one thing it reaches for
 * itself is the platform's `FileSystem`, for the watch alone.
 *
 * The scope it is built in is its life: the watch runs on a fiber of that
 * scope and a pass under way is a fiber of it too, so closing the scope ends
 * both and there is no stop for a caller to remember.
 *
 * An adapter that cannot answer degrades the search to keyword-only and the
 * answer says so. No embedding is ever made of a conversation: the
 * past-conversation results a search may carry are lines already retained in
 * Conversation, read from the store for the eligible conversations alone and
 * indexed nowhere.
 */

/**
 * The store as the host reads and writes it: the index's plan and apply, its
 * search and read, and Conversation's search. Every one of them answers an
 * effect refused with `MemorySeamRefused`, so a store that could not carry
 * the call out is the same failure here as an adapter that could not answer,
 * and the index runs none of them: the pass, the search, and the read are
 * effects of whoever asked for them.
 */
export interface NotebookMemoryStore {
  planMemorySync(
    identity: EmbeddingModelIdentity | undefined,
    now: number,
  ): Effect.Effect<MemoryScanPlan, MemorySeamRefused>;
  applyMemorySync(apply: MemorySyncApply): Effect.Effect<MemoryApplyReport, MemorySeamRefused>;
  searchMemory(query: MemorySearchQuery): Effect.Effect<MemorySearchOutcome, MemorySeamRefused>;
  readMemory(
    path: string,
    from?: number,
    lines?: number,
  ): Effect.Effect<MemoryReadResult | undefined, MemorySeamRefused>;
  searchConversation(
    sessionKeys: readonly SessionKey[],
    query: string,
    limit: number,
    now: number,
  ): Effect.Effect<readonly ConversationLineHit[], MemorySeamRefused>;
}

/** The two memory tools as one conversation is offered them, each answering the record the model reads. */
export interface NotebookMemoryAccess {
  search(ask: {
    readonly query: string;
    readonly maxResults?: number;
    readonly signal: AbortSignal;
  }): Effect.Effect<WireRecord>;
  get(ask: {
    readonly path: string;
    readonly from?: number;
    readonly lines?: number;
  }): Effect.Effect<WireRecord>;
}

export interface NotebookMemoryOptions {
  readonly store: () => NotebookMemoryStore;
  /** The embedding adapter the credential policy built, or nothing when no credential stands. */
  readonly embeddingAdapter: () => EmbeddingAdapter | undefined;
  /** The most texts one embed call carries; longer plans are cut into batches of this size. */
  readonly embeddingBatchSize: number;
  /** The agent's identity workspace, watched for the notebook's files. */
  readonly workspaceDirectory: () => string;
  readonly agentId?: string;
  readonly conversationDirectory: () => readonly ConversationRecord[];
  readonly isTemporary: (sessionKey: SessionKey) => boolean;
  readonly now: () => number;
  readonly report: (message: string) => void;
  /** Run at the end of every completed sync, so the notebook's cached entries can be read again after a hand edit. */
  readonly onSynced?: Effect.Effect<void>;
}

/** The index as its owner holds it; the scope it was built in is its stop. */
export interface NotebookMemory {
  /** The retrieval mode the last sync settled on; a search reports its own mode on its answer. */
  readonly mode: Effect.Effect<RetrievalMode>;
  /** Syncs once and starts watching; a second start only syncs again. */
  readonly start: Effect.Effect<void>;
  /**
   * One reconcile of the index against the files, answered when the pass
   * this call earned has ended.
   */
  readonly sync: Effect.Effect<MemorySyncReport | undefined>;
  /** Asks for that same reconcile without waiting on it: the pass runs on the index's own scope. */
  readonly requestSync: Effect.Effect<void>;
  /** The brain's memory tools for one conversation. */
  accessFor(sessionKey: SessionKey): NotebookMemoryAccess;
}

export interface MemorySyncReport extends MemoryApplyReport {
  readonly mode: RetrievalMode;
  readonly note?: string;
}

/** The mode one call ran in and, when it is not hybrid, why. */
interface RetrievalStanding {
  readonly mode: RetrievalMode;
  readonly note?: string;
}

/** What one query's embedding resolved to: the standing, and the vector with its identity when the standing is hybrid. */
interface QueryEmbedding extends RetrievalStanding {
  readonly queryVector?: readonly number[];
  readonly identity?: EmbeddingModelIdentity;
}

/** A store or adapter call that refused; the pass it was made in reports it and answers nothing. */
export class MemorySeamRefused extends Data.TaggedError("MemorySeamRefused")<{
  readonly reason: string;
}> {}

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The embedding adapter's promise as an effect, its rejection carried as the reason a pass reports. */
function attempted<A>(promise: () => Promise<A>): Effect.Effect<A, MemorySeamRefused> {
  return Effect.tryPromise({
    try: promise,
    catch: (cause) => new MemorySeamRefused({ reason: reasonOf(cause) }),
  });
}

const HYBRID: RetrievalStanding = { mode: RETRIEVAL_MODE.HYBRID };

/** What a search says when its embeddings cannot be had: the keyword half alone, and why. */
function keywordOnly(reason: string): RetrievalStanding {
  return { mode: RETRIEVAL_MODE.KEYWORD_ONLY, note: `keyword-only: ${reason}` };
}

const NO_CREDENTIAL = "no embedding credential stands";
const RATE_LIMITED = "the embedding provider is rate limiting";

/** A conversation hit's path names the conversation, never a file; a read of it answers nothing. */
export function conversationResultPath(sessionKey: SessionKey): string {
  return `conversation:${sessionKey}`;
}

/** A line's keyword score: the share of the query's tokens it carries; a search has no bm25 over Conversation. */
function lexicalScore(query: string, words: string): number {
  const asked = [...tokenize(query)];
  if (asked.length === 0) return 0;
  const held = tokenize(words);
  return asked.filter((token) => held.has(token)).length / asked.length;
}

function isAsk(entry: ConversationEntry): boolean {
  return entry.kind === CONVERSATION_ENTRY_KIND.ASK;
}

/**
 * A retained line as a search result. A conversation hit is keyword-only:
 * it has no vector, so its score is the text weight times its lexical share
 * and is at most 0.3, below the 0.35 the strict window asks for. It never
 * competes with a notebook chunk for a place in that window; it fills only
 * the slots the strict matches leave empty, so a notebook that fills the
 * window on its own excludes every conversation hit. This is a known
 * ranking limitation kept as it stands; rescoring conversation hits to
 * compete is a ranking decision to make deliberately, not here.
 */
function conversationResult(
  query: string,
  hit: ConversationLineHit,
  ordinal: number,
): MemorySearchResult {
  const textScore = lexicalScore(query, hit.entry.words);
  // A line has no line number; its moment stands in, so two hits from one
  // conversation are two results and never one.
  const moment = hit.entry.recordedAt ?? ordinal;
  return {
    path: conversationResultPath(hit.sessionKey),
    startLine: moment,
    endLine: moment,
    score: MEMORY_SEARCH_DEFAULTS.TEXT_WEIGHT * textScore,
    vectorScore: 0,
    textScore,
    snippet: `${hit.entry.kind}: ${hit.entry.words}`,
    source: MEMORY_SOURCE.CONVERSATIONS,
    provenance: {
      origin: isAsk(hit.entry) ? MEMORY_ORIGIN.USER : MEMORY_ORIGIN.AGENT,
      path: hit.sessionKey,
      indexedAt: hit.entry.recordedAt ?? 0,
    },
  };
}

function resultRecord(result: MemorySearchResult): WireRecord {
  return {
    path: result.path,
    start_line: result.startLine,
    end_line: result.endLine,
    score: Number(result.score.toFixed(4)),
    source: result.source,
    snippet: result.snippet,
    provenance: {
      origin: result.provenance.origin,
      path: result.provenance.path,
      indexed_at: new Date(result.provenance.indexedAt).toISOString(),
      ...(result.provenance.entryIds ? { entry_ids: [...result.provenance.entryIds] } : undefined),
    },
  };
}

function withNote(standing: RetrievalStanding): { note?: string } {
  return standing.note ? { note: standing.note } : {};
}

/** The identity the index stores beside a vector: the adapter's provider and model, never its width. */
function identityOf(
  adapter: EmbeddingAdapter,
): Effect.Effect<EmbeddingModelIdentity, MemorySeamRefused> {
  return Effect.map(
    attempted(() => adapter.identity()),
    (identity) => ({ provider: identity.provider, model: identity.model }),
  );
}

/** The passes one index has under way: the one running, and the one every caller during it shares. */
interface Passes {
  readonly running: Deferred.Deferred<MemorySyncReport | undefined> | undefined;
  readonly follow: Deferred.Deferred<MemorySyncReport | undefined> | undefined;
}

export function makeNotebookMemory(
  options: NotebookMemoryOptions,
): Effect.Effect<NotebookMemory, never, FileSystem.FileSystem | Scope.Scope> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const scope = yield* Effect.scope;
    const agentId = options.agentId ?? DEFAULT_AGENT_ID;
    const standing = yield* Ref.make<RetrievalStanding>({ mode: RETRIEVAL_MODE.KEYWORD_ONLY });
    const passes = yield* Ref.make<Passes>({ running: undefined, follow: undefined });
    // One caller at a time decides what its call earns, so two arriving
    // together cannot both find no pass running.
    const decision = yield* Effect.makeSemaphore(1);

    const reported = (message: string): Effect.Effect<void> =>
      Effect.sync(() => {
        options.report(message);
      });

    /** The query's vector under the adapter that stands now, or the standing its absence or failure earns. */
    const embedQuery = (query: string, signal: AbortSignal): Effect.Effect<QueryEmbedding> =>
      Effect.gen(function* () {
        const adapter = options.embeddingAdapter();
        if (!adapter) return keywordOnly(NO_CREDENTIAL);
        const answer = yield* Effect.promise(() => adapter.embed([query], { signal }));
        if (answer.outcome === MODEL_RESPONSE_OUTCOME.THROTTLED) {
          return keywordOnly(RATE_LIMITED);
        }
        if (answer.outcome === MODEL_RESPONSE_OUTCOME.FAILED) {
          return keywordOnly(`${answer.failure}: ${answer.reason}`);
        }
        const queryVector = answer.vectors[0];
        if (!queryVector) {
          return keywordOnly("the embedding provider answered no vector");
        }
        return { ...HYBRID, queryVector, identity: yield* Effect.orDie(identityOf(adapter)) };
      });

    const searchNotebook = (
      query: string,
      embedding: QueryEmbedding,
      maxResults: number,
    ): Effect.Effect<MemorySearchOutcome> =>
      Effect.orDie(
        Effect.suspend(() =>
          options.store().searchMemory({
            query,
            ...(embedding.queryVector && embedding.identity
              ? { queryVector: embedding.queryVector, identity: embedding.identity }
              : undefined),
            maxResults,
            now: options.now(),
          }),
        ),
      );

    /** The conversations a search from `current` may read lines of: eligible, same agent, never itself. */
    const eligibleKeys = (current: SessionKey): SessionKey[] =>
      options
        .conversationDirectory()
        .filter((record) =>
          isRecallEligibleConversation(
            {
              sessionKey: record.sessionKey,
              agentId,
              temporary: options.isTemporary(record.sessionKey),
            },
            { sessionKey: current, agentId },
          ),
        )
        .map((record) => record.sessionKey);

    const conversationResults = (
      current: SessionKey,
      query: string,
      limit: number,
    ): Effect.Effect<MemorySearchResult[]> =>
      Effect.suspend(() => {
        const keys = eligibleKeys(current);
        if (keys.length === 0 || limit <= 0) return Effect.succeed([]);
        return Effect.map(
          Effect.orDie(options.store().searchConversation(keys, query, limit, options.now())),
          (hits) => hits.map((hit, ordinal) => conversationResult(query, hit, ordinal)),
        );
      });

    /**
     * One search from `current`: the notebook's chunks and the eligible
     * conversations' lines ranked inside the same window, under the same
     * weights and the same threshold. The mode is this call's own; it moves
     * the standing mode of nothing.
     */
    const search = (
      current: SessionKey,
      ask: { readonly query: string; readonly maxResults?: number; readonly signal: AbortSignal },
    ): Effect.Effect<MemorySearchAnswer> =>
      Effect.gen(function* () {
        const maxResults = ask.maxResults ?? MEMORY_SEARCH_DEFAULTS.MAXIMUM_RESULTS;
        const embedding = yield* embedQuery(ask.query, ask.signal);
        const [notebook, conversations] = yield* Effect.all(
          [
            searchNotebook(ask.query, embedding, maxResults),
            conversationResults(
              current,
              ask.query,
              maxResults * MEMORY_SEARCH_DEFAULTS.CANDIDATE_MULTIPLIER,
            ),
          ],
          { concurrency: "unbounded" },
        );
        const merged = [...notebook.results, ...conversations].sort(
          (a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine,
        );
        return {
          mode: embedding.mode,
          results: selectHybridSearchResults({
            merged,
            keyword: merged.filter((result) => result.textScore > 0),
            maxResults,
            minScore: MEMORY_SEARCH_DEFAULTS.MINIMUM_SCORE,
          }),
          ...withNote(embedding),
        };
      });

    const accessFor = (sessionKey: SessionKey): NotebookMemoryAccess => ({
      search: (ask) =>
        Effect.map(search(sessionKey, ask), (answer) => ({
          status: ACTION_RESULT_STATUS.ACCEPTED,
          mode: answer.mode,
          ...(answer.note ? { note: answer.note } : undefined),
          results: answer.results.map(resultRecord),
        })),
      get: (ask) =>
        Effect.map(
          Effect.orDie(
            Effect.suspend(() => options.store().readMemory(ask.path, ask.from, ask.lines)),
          ),
          (read): WireRecord =>
            read
              ? {
                  status: ACTION_RESULT_STATUS.ACCEPTED,
                  path: read.path,
                  from: read.from,
                  to: read.to,
                  total_lines: read.totalLines,
                  truncated: read.truncated,
                  text: read.text,
                }
              : {
                  status: ACTION_RESULT_STATUS.REJECTED,
                  reason: "not read: that path is not a notebook file",
                },
        ),
    });

    /** Embeds in batches until one fails; the vectors already answered are kept beside the reason the rest were not. */
    const embedAll = (
      adapter: EmbeddingAdapter,
      texts: readonly { hash: string; text: string }[],
    ): Effect.Effect<{ written: readonly EmbeddingWrite[]; failed?: string }, MemorySeamRefused> =>
      Effect.gen(function* () {
        const written: EmbeddingWrite[] = [];
        const size = options.embeddingBatchSize;
        for (let start = 0; start < texts.length; start += size) {
          const batch = texts.slice(start, start + size);
          const answer = yield* attempted(() => adapter.embed(batch.map((entry) => entry.text)));
          if (answer.outcome === MODEL_RESPONSE_OUTCOME.THROTTLED) {
            return { written, failed: RATE_LIMITED };
          }
          if (answer.outcome === MODEL_RESPONSE_OUTCOME.FAILED) {
            return { written, failed: `${answer.failure}: ${answer.reason}` };
          }
          batch.forEach((entry, index) => {
            const vector = answer.vectors[index];
            if (vector) written.push({ hash: entry.hash, vector });
          });
        }
        return { written };
      });

    const syncOnce: Effect.Effect<MemorySyncReport, MemorySeamRefused> = Effect.gen(function* () {
      const store = options.store();
      const now = options.now();
      // One read of the adapter for the whole pass: the identity the plan is
      // asked under and the adapter the vectors come from are the same one,
      // whatever a credential swap installs meanwhile.
      const adapter = options.embeddingAdapter();
      const identity = adapter ? yield* identityOf(adapter) : undefined;
      const plan = yield* store.planMemorySync(identity, now);
      let settled: RetrievalStanding = adapter ? HYBRID : keywordOnly(NO_CREDENTIAL);
      let embeddings: readonly EmbeddingWrite[] = [];
      if (adapter && plan.missingEmbeddings.length > 0) {
        const embedded = yield* embedAll(adapter, plan.missingEmbeddings);
        // Every batch that answered lands whatever a later batch did, and the
        // keyword rows land regardless, under the same identity so every vector
        // already cached is kept on its chunk; only the chunks still without
        // one are asked for again next sync.
        embeddings = embedded.written;
        if (embedded.failed) settled = keywordOnly(embedded.failed);
      }
      const report = yield* store.applyMemorySync({
        changed: plan.changed,
        removed: plan.removed,
        embeddings,
        ...(identity ? { identity } : undefined),
        now: options.now(),
      });
      yield* Ref.set(standing, settled);
      return { ...report, mode: settled.mode, ...withNote(settled) };
    });

    /** A pass that fails reports and answers nothing, without cancelling the follow-on it owes. */
    const passOnce: Effect.Effect<MemorySyncReport | undefined> = syncOnce.pipe(
      Effect.tap(() => options.onSynced ?? Effect.void),
      Effect.catchAll((refusal) =>
        Effect.as(reported(`Notebook index sync failed: ${refusal.reason}`), undefined),
      ),
      Effect.catchAllDefect((defect) =>
        Effect.as(reported(`Notebook index sync failed: ${reasonOf(defect)}`), undefined),
      ),
    );

    /**
     * The pass itself, on a fiber of the index's own scope so no caller's
     * giving up ends it: when it settles it hands the follow-on it owes the
     * place it held and only then answers everyone waiting on it.
     */
    function runPass(
      deferred: Deferred.Deferred<MemorySyncReport | undefined>,
    ): Effect.Effect<void> {
      return Effect.asVoid(
        Effect.onExit(passOnce, (exit) =>
          Effect.zipRight(
            decision.withPermits(1)(
              Effect.gen(function* () {
                const { follow } = yield* Ref.get(passes);
                yield* Ref.set(passes, { running: follow, follow: undefined });
                if (follow) yield* forkPass(follow);
              }),
            ),
            Deferred.done(deferred, exit),
          ),
        ),
      );
    }

    /**
     * Every fiber this index owns is forked `Effect.interruptible`, because a
     * fork inherits the interrupt status of whoever made it and both doors
     * here are reached from uninterruptible regions — the follow-on from a
     * finished pass's own finalizer, the start from the composer's start —
     * and a fiber forked uninterruptible is one no scope close could end.
     */
    function forkPass(
      deferred: Deferred.Deferred<MemorySyncReport | undefined>,
    ): Effect.Effect<void> {
      return Effect.asVoid(Effect.forkIn(Effect.interruptible(runPass(deferred)), scope));
    }

    /**
     * One reconcile of the index against the files. A call while no pass runs
     * starts one and answers its report. A call during a pass answers the one
     * follow-on pass that starts when the running one ends, because the running
     * pass read the adapter once when it began and a credential published
     * meanwhile is what the caller is asking to be seen; every call during the
     * same pass shares that follow-on, and a call during the follow-on
     * schedules one more, so requests coalesce and a pass runs only when one
     * was asked for.
     */
    const sync: Effect.Effect<MemorySyncReport | undefined> = Effect.flatten(
      decision.withPermits(1)(
        Effect.gen(function* () {
          const held = yield* Ref.get(passes);
          if (!held.running) {
            const started = yield* Deferred.make<MemorySyncReport | undefined>();
            yield* Ref.set(passes, { running: started, follow: undefined });
            yield* forkPass(started);
            return Deferred.await(started);
          }
          if (held.follow) return Deferred.await(held.follow);
          const asked = yield* Deferred.make<MemorySyncReport | undefined>();
          yield* Ref.set(passes, { ...held, follow: asked });
          return Deferred.await(asked);
        }),
      ),
    );

    /**
     * Watches the notebook's directory and asks for one reconcile per burst of
     * changes, debounced at the pinned 1,500 ms. The watch decides nothing
     * about what changed: the reconcile it asks for reads every file again and
     * compares hashes, so a missed event costs a later pass and never a wrong
     * index, and an index can always be rebuilt from the files alone. A watch
     * that cannot be armed, or that ends in a failure, is reported and leaves
     * the files unwatched; every later sync is one somebody asked for. Each
     * burst asks rather than waits, so the next debounce window opens at once
     * and an edit landing during a long pass is a request the coalescer folds
     * into that pass's follow-on rather than one held behind it.
     */
    const requestSync = Effect.asVoid(Effect.forkIn(Effect.interruptible(sync), scope));

    const watchFiles: Effect.Effect<void> = Effect.suspend(() =>
      Effect.catchAll(
        Stream.runForEach(
          Stream.debounce(
            fileSystem.watch(options.workspaceDirectory(), { recursive: true }),
            Duration.millis(MEMORY_SEARCH_DEFAULTS.WATCH_DEBOUNCE_MS),
          ),
          () => requestSync,
        ),
        (failure) => reported(`Memory files are not being watched: ${failure.message}`),
      ),
    );

    const watching = yield* Effect.once(
      Effect.asVoid(Effect.forkIn(Effect.interruptible(watchFiles), scope)),
    );

    return {
      mode: Effect.map(Ref.get(standing), (held) => held.mode),
      start: Effect.zipRight(Effect.asVoid(sync), watching),
      sync,
      requestSync,
      accessFor,
    };
  });
}
