import { type FSWatcher, watch } from "node:fs";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/realtime";
import {
  type ConversationRecord,
  DEFAULT_AGENT_ID,
  type EmbeddingAdapter,
  MODEL_RESPONSE_OUTCOME,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import { ACT_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
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
 * The notebook's index as one host over injected seams. The files under the
 * agent's workspace are the source of truth; the store's worker keeps the
 * derived index and does the ranking; this class drives the sync (a plan
 * from the store, the missing vectors from the embedding adapter, the apply
 * back to the store), watches the files for a hand edit, and answers the
 * brain's memory tools. It knows no database, no runtime, and no window: the
 * store and the adapter are handed in.
 *
 * An adapter that cannot answer degrades the search to keyword-only and the
 * answer says so. No embedding is ever made of a conversation: the
 * past-conversation results a search may carry are lines already retained in
 * History, read from the store for the eligible conversations alone and
 * indexed nowhere.
 */

/** The store as the host reads and writes it: the index's plan and apply, its search and read, and History's search. */
export interface NotebookMemoryStore {
  planMemorySync(
    identity: EmbeddingModelIdentity | undefined,
    now: number,
  ): Promise<MemoryScanPlan>;
  applyMemorySync(apply: MemorySyncApply): Promise<MemoryApplyReport>;
  searchMemory(query: MemorySearchQuery): Promise<MemorySearchOutcome>;
  readMemory(path: string, from?: number, lines?: number): Promise<MemoryReadResult | undefined>;
  searchHistory(
    sessionKeys: readonly SessionKey[],
    query: string,
    limit: number,
    now: number,
  ): Promise<readonly ConversationLineHit[]>;
}

/** The two memory tools as one conversation is offered them, each answering the record the model reads. */
export interface NotebookMemoryAccess {
  search(ask: {
    readonly query: string;
    readonly maxResults?: number;
    readonly signal: AbortSignal;
  }): Promise<WireRecord>;
  get(ask: {
    readonly path: string;
    readonly from?: number;
    readonly lines?: number;
  }): Promise<WireRecord>;
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
  /** Hears every completed sync, so the notebook's cached entries can be read again after a hand edit. */
  readonly onSynced?: () => void;
}

export interface MemorySyncReport extends MemoryApplyReport {
  readonly mode: RetrievalMode;
  readonly note?: string;
}

/** The mode one call ran in and, when it is not hybrid, why. */
export interface RetrievalStanding {
  readonly mode: RetrievalMode;
  readonly note?: string;
}

/** What one query's embedding resolved to: the standing, and the vector with its identity when the standing is hybrid. */
interface QueryEmbedding extends RetrievalStanding {
  readonly queryVector?: readonly number[];
  readonly identity?: EmbeddingModelIdentity;
}

const HYBRID: RetrievalStanding = { mode: RETRIEVAL_MODE.HYBRID };

/** What a search says when its embeddings cannot be had: the keyword half alone, and why. */
function keywordOnly(reason: string): RetrievalStanding {
  return { mode: RETRIEVAL_MODE.KEYWORD_ONLY, note: `keyword-only: ${reason}` };
}

const NO_CREDENTIAL = "no embedding credential stands";
const RATE_LIMITED = "the embedding provider is rate limiting";

/** A conversation hit's path names the conversation, never a file; a read of it answers nothing. */
export const CONVERSATION_RESULT_PATH_PREFIX = "conversation:";

export function conversationResultPath(sessionKey: SessionKey): string {
  return `${CONVERSATION_RESULT_PATH_PREFIX}${sessionKey}`;
}

/** A line's keyword score: the share of the query's tokens it carries; a search has no bm25 over History. */
function lexicalScore(query: string, words: string): number {
  const asked = [...tokenize(query)];
  if (asked.length === 0) return 0;
  const held = tokenize(words);
  return asked.filter((token) => held.has(token)).length / asked.length;
}

function isAsk(entry: ConversationEntry): boolean {
  return (
    entry.kind === CONVERSATION_ENTRY_KIND.TYPED_ASK ||
    entry.kind === CONVERSATION_ENTRY_KIND.SPOKEN_ASK
  );
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

export class NotebookMemory {
  readonly #options: NotebookMemoryOptions;
  readonly #agentId: string;
  #standing: RetrievalStanding = { mode: RETRIEVAL_MODE.KEYWORD_ONLY };
  #watcher: MemoryWatcher | undefined;
  #syncing: Promise<MemorySyncReport | undefined> | undefined;
  #followOn: Promise<MemorySyncReport | undefined> | undefined;

  constructor(options: NotebookMemoryOptions) {
    this.#options = options;
    this.#agentId = options.agentId ?? DEFAULT_AGENT_ID;
  }

  /** The retrieval mode the last sync settled on; a search reports its own mode on its answer. */
  mode(): RetrievalMode {
    return this.#standing.mode;
  }

  /** Syncs once and starts watching; a second start only syncs again. */
  async start(): Promise<void> {
    await this.sync();
    this.#watcher ??= watchMemoryFiles({
      directory: this.#options.workspaceDirectory(),
      onChange: () => {
        void this.sync();
      },
      report: this.#options.report,
    });
  }

  stop(): void {
    this.#watcher?.close();
    this.#watcher = undefined;
  }

  /**
   * One reconcile of the index against the files. A call while no pass runs
   * starts one and answers its report. A call during a pass answers the one
   * follow-on pass that starts when the running one ends, because the running
   * pass read the adapter once when it began and a credential published
   * meanwhile is what the caller is asking to be seen; every call during the
   * same pass shares that follow-on, and a call during the follow-on
   * schedules one more, so requests coalesce and a pass runs only when one
   * was asked for. A pass that fails reports and answers nothing without
   * cancelling the follow-on it owes; stop() closes the watcher and leaves a
   * pass already promised to finish.
   */
  sync(): Promise<MemorySyncReport | undefined> {
    if (!this.#syncing) {
      this.#syncing = this.#runPass();
      return this.#syncing;
    }
    this.#followOn ??= this.#syncing.then(() => {
      this.#followOn = undefined;
      this.#syncing ??= this.#runPass();
      return this.#syncing;
    });
    return this.#followOn;
  }

  #runPass(): Promise<MemorySyncReport | undefined> {
    return this.#syncOnce()
      .then((report) => {
        this.#options.onSynced?.();
        return report;
      })
      .catch((error) => {
        this.#options.report(
          `Notebook index sync failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      })
      .finally(() => {
        this.#syncing = undefined;
      });
  }

  /** The brain's memory tools for one conversation. */
  accessFor(sessionKey: SessionKey): NotebookMemoryAccess {
    return {
      search: async (ask) => {
        const answer = await this.search(sessionKey, ask);
        return {
          status: ACT_RESULT_STATUS.ACCEPTED,
          mode: answer.mode,
          ...(answer.note ? { note: answer.note } : undefined),
          results: answer.results.map(resultRecord),
        };
      },
      get: async (ask): Promise<WireRecord> => {
        const read = await this.#options.store().readMemory(ask.path, ask.from, ask.lines);
        if (!read) {
          const refused: WireRecord = {
            status: ACT_RESULT_STATUS.REJECTED,
            reason: "not read: that path is not a notebook file",
          };
          return refused;
        }
        const answered: WireRecord = {
          status: ACT_RESULT_STATUS.ACCEPTED,
          path: read.path,
          from: read.from,
          to: read.to,
          total_lines: read.totalLines,
          truncated: read.truncated,
          text: read.text,
        };
        return answered;
      },
    };
  }

  /**
   * One search from `current`: the notebook's chunks and the eligible
   * conversations' lines ranked inside the same window, under the same
   * weights and the same threshold. The mode is this call's own; it moves
   * the standing mode of nothing.
   */
  async search(
    current: SessionKey,
    ask: { readonly query: string; readonly maxResults?: number; readonly signal: AbortSignal },
  ): Promise<MemorySearchAnswer> {
    const maxResults = ask.maxResults ?? MEMORY_SEARCH_DEFAULTS.MAXIMUM_RESULTS;
    const embedding = await this.#embedQuery(ask.query, ask.signal);
    const [notebook, conversations] = await Promise.all([
      this.#searchNotebook(ask.query, embedding, maxResults),
      this.#conversationResults(
        current,
        ask.query,
        maxResults * MEMORY_SEARCH_DEFAULTS.CANDIDATE_MULTIPLIER,
      ),
    ]);
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
  }

  #searchNotebook(
    query: string,
    embedding: QueryEmbedding,
    maxResults: number,
  ): Promise<MemorySearchOutcome> {
    return this.#options.store().searchMemory({
      query,
      ...(embedding.queryVector && embedding.identity
        ? { queryVector: embedding.queryVector, identity: embedding.identity }
        : undefined),
      maxResults,
      now: this.#options.now(),
    });
  }

  /** The query's vector under the adapter that stands now, or the standing its absence or failure earns. */
  async #embedQuery(query: string, signal: AbortSignal): Promise<QueryEmbedding> {
    const adapter = this.#options.embeddingAdapter();
    if (!adapter) return keywordOnly(NO_CREDENTIAL);
    const answer = await adapter.embed([query], { signal });
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
    return { ...HYBRID, queryVector, identity: await identityOf(adapter) };
  }

  async #syncOnce(): Promise<MemorySyncReport> {
    const store = this.#options.store();
    const now = this.#options.now();
    // One read of the adapter for the whole pass: the identity the plan is
    // asked under and the adapter the vectors come from are the same one,
    // whatever a credential swap installs meanwhile.
    const adapter = this.#options.embeddingAdapter();
    const identity = adapter ? await identityOf(adapter) : undefined;
    const plan = await store.planMemorySync(identity, now);
    let standing: RetrievalStanding = adapter ? HYBRID : keywordOnly(NO_CREDENTIAL);
    let embeddings: readonly EmbeddingWrite[] = [];
    if (adapter && plan.missingEmbeddings.length > 0) {
      const embedded = await this.#embedAll(adapter, plan.missingEmbeddings);
      // Every batch that answered lands whatever a later batch did, and the
      // keyword rows land regardless, under the same identity so every vector
      // already cached is kept on its chunk; only the chunks still without
      // one are asked for again next sync.
      embeddings = embedded.written;
      if (embedded.failed) standing = keywordOnly(embedded.failed);
    }
    const report = await store.applyMemorySync({
      changed: plan.changed,
      removed: plan.removed,
      embeddings,
      ...(identity ? { identity } : undefined),
      now: this.#options.now(),
    });
    this.#standing = standing;
    return { ...report, mode: standing.mode, ...withNote(standing) };
  }

  /** Embeds in batches until one fails; the vectors already answered are kept beside the reason the rest were not. */
  async #embedAll(
    adapter: EmbeddingAdapter,
    texts: readonly { hash: string; text: string }[],
  ): Promise<{ written: readonly EmbeddingWrite[]; failed?: string }> {
    const written: EmbeddingWrite[] = [];
    const size = this.#options.embeddingBatchSize;
    for (let start = 0; start < texts.length; start += size) {
      const batch = texts.slice(start, start + size);
      const answer = await adapter.embed(batch.map((entry) => entry.text));
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
  }

  /** The conversations a search from `current` may read lines of: eligible, same agent, never itself. */
  #eligibleKeys(current: SessionKey): SessionKey[] {
    return this.#options
      .conversationDirectory()
      .filter((record) =>
        isRecallEligibleConversation(
          {
            sessionKey: record.sessionKey,
            agentId: this.#agentId,
            temporary: this.#options.isTemporary(record.sessionKey),
          },
          { sessionKey: current, agentId: this.#agentId },
        ),
      )
      .map((record) => record.sessionKey);
  }

  async #conversationResults(
    current: SessionKey,
    query: string,
    limit: number,
  ): Promise<MemorySearchResult[]> {
    const keys = this.#eligibleKeys(current);
    if (keys.length === 0 || limit <= 0) return [];
    const hits = await this.#options.store().searchHistory(keys, query, limit, this.#options.now());
    return hits.map((hit, ordinal) => conversationResult(query, hit, ordinal));
  }
}

/** The identity the index stores beside a vector: the adapter's provider and model, never its width. */
async function identityOf(adapter: EmbeddingAdapter): Promise<EmbeddingModelIdentity> {
  const identity = await adapter.identity();
  return { provider: identity.provider, model: identity.model };
}

interface MemoryWatcher {
  close(): void;
}

interface MemoryWatchOptions {
  readonly directory: string;
  readonly onChange: () => void;
  readonly debounceMs?: number;
  readonly report?: (message: string) => void;
}

/**
 * Watches the notebook's directory and asks for one reconcile per burst of
 * changes, debounced at the pinned 1,500 ms. The watcher decides nothing
 * about what changed: the reconcile it triggers reads every file again and
 * compares hashes, so a missed event costs a later pass and never a wrong
 * index, and an index can always be rebuilt from the files alone.
 */
function watchMemoryFiles(options: MemoryWatchOptions): MemoryWatcher | undefined {
  const debounceMs = options.debounceMs ?? MEMORY_SEARCH_DEFAULTS.WATCH_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher;
  try {
    watcher = watch(options.directory, { recursive: true, persistent: false }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        options.onChange();
      }, debounceMs);
    });
  } catch (error) {
    options.report?.(
      `Memory files are not being watched: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
  watcher.on("error", (error) => options.report?.(`Memory watcher stopped: ${error.message}`));
  return {
    close: () => {
      if (timer) clearTimeout(timer);
      watcher.close();
    },
  };
}
