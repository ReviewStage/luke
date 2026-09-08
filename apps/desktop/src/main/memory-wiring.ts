import type { BrainMemoryAccess, BrainRecallAsk } from "@sidecar/brain";
import { EMBEDDING_BATCH_SIZE, runRecallSubrun } from "@sidecar/brain";
import {
  ConversationRecall,
  conversationRunsRecall,
  EMBEDDING_PROVIDER_SELECTION,
  type EmbeddingModelIdentity,
  type EmbeddingProviderSelection,
  isRecallEligibleConversation,
  MEMORY_ORIGIN,
  MEMORY_SEARCH_DEFAULTS,
  MEMORY_SOURCE,
  type MemorySearchAnswer,
  type MemorySearchResult,
  RETRIEVAL_MODE,
  type RecallRecentTurn,
  type RetrievalMode,
  selectHybridSearchResults,
  tokenize,
  watchMemoryFiles,
} from "@sidecar/memory";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/realtime";
import {
  type AgentRuntime,
  type ConversationRecord,
  DEFAULT_AGENT_ID,
  type EmbeddingAdapter,
  MODEL_RESPONSE_OUTCOME,
  type SessionKey,
} from "@sidecar/runtime-contracts";
import type { EmbeddingWrite, RuntimeStoreClient } from "@sidecar/runtime-store";
import { ACT_RESULT_STATUS, type WireRecord } from "@sidecar/wire";

/**
 * The notebook's index and recall as the desktop composes them. The files
 * under the agent's workspace are the source of truth; the store's worker
 * keeps the derived index and does the ranking; this module drives the sync
 * (a plan from the worker, the missing vectors from the embedding adapter
 * the credential policy built, the apply back to the worker), watches the
 * files for a hand edit, answers the brain's memory tools, and runs the
 * private-conversation recall an eligible conversation's ask earns.
 *
 * Embeddings follow OpenClaw's distinction: under the automatic selection an
 * adapter that cannot answer degrades the search to keyword-only and the
 * answer says so; under an explicit selection the same failure leaves the
 * search unavailable, because the developer asked for that provider and no
 * other. No embedding is ever made of a conversation: the past-conversation
 * results a search may carry are lines already retained in History, read
 * from the store for the eligible conversations alone and indexed nowhere.
 */

export interface MemoryWiringDependencies {
  persistent: boolean;
  client: () => RuntimeStoreClient;
  /** The embedding adapter the credential policy built, or nothing when no credential stands. */
  embeddingAdapter: () => EmbeddingAdapter | undefined;
  embeddingSelection?: EmbeddingProviderSelection;
  /** The agent's identity workspace, watched for the notebook's files. */
  workspaceDirectory: () => string;
  /** A runtime for the recall subrun, or nothing when no brain may stand. */
  createRuntime: () => AgentRuntime | undefined;
  conversationDirectory: () => readonly ConversationRecord[];
  isTemporary: (sessionKey: SessionKey) => boolean;
  /** One conversation's retained lines, for the recall's small recent-turn input. */
  historyLines: (sessionKey: SessionKey) => readonly ConversationEntry[];
  now: () => number;
  createId: () => string;
  report: (message: string) => void;
  /** Hears every completed sync, so the notebook's cached entries can be read again after a hand edit. */
  onSynced?: () => void;
}

export interface MemorySyncReport {
  readonly mode: RetrievalMode;
  readonly indexedFiles: number;
  readonly removedFiles: number;
  readonly indexedChunks: number;
  readonly embeddedChunks: number;
  readonly note?: string;
}

export interface MemoryWiring {
  /** Syncs once and starts watching; a run with nothing on disk does neither. */
  start: () => Promise<void>;
  stop: () => void;
  /** One reconcile of the index against the files; concurrent calls share one pass. */
  sync: () => Promise<MemorySyncReport | undefined>;
  /** The brain's memory tools for one conversation. */
  accessFor: (sessionKey: SessionKey) => BrainMemoryAccess | undefined;
  /** The recall an eligible conversation's asks run, or nothing for one that does not recall. */
  recallFor: (
    sessionKey: SessionKey,
  ) => ((ask: BrainRecallAsk) => Promise<string | undefined>) | undefined;
  /** The retrieval mode the last search or sync actually ran in. */
  mode: () => RetrievalMode;
}

const RECENT_TURNS_READ = 6;

export function wireMemory(dependencies: MemoryWiringDependencies): MemoryWiring {
  const selection = dependencies.embeddingSelection ?? EMBEDDING_PROVIDER_SELECTION.AUTO;
  let mode: RetrievalMode = RETRIEVAL_MODE.KEYWORD_ONLY;
  let modeNote: string | undefined;
  let watcher: ReturnType<typeof watchMemoryFiles>;
  let syncing: Promise<MemorySyncReport | undefined> | undefined;

  /** Whether embeddings are wanted at all, and what to say when they cannot be had. */
  const embeddingUnavailable = (reason: string): void => {
    if (selection === EMBEDDING_PROVIDER_SELECTION.NONE) {
      mode = RETRIEVAL_MODE.KEYWORD_ONLY;
      modeNote = undefined;
      return;
    }
    if (selection === EMBEDDING_PROVIDER_SELECTION.AUTO) {
      mode = RETRIEVAL_MODE.KEYWORD_ONLY;
      modeNote = `keyword-only: ${reason}`;
      return;
    }
    mode = RETRIEVAL_MODE.UNAVAILABLE;
    modeNote = `the selected embedding provider failed: ${reason}`;
  };

  const identityOf = async (): Promise<EmbeddingModelIdentity | undefined> => {
    if (selection === EMBEDDING_PROVIDER_SELECTION.NONE) return undefined;
    const adapter = dependencies.embeddingAdapter();
    if (!adapter) {
      embeddingUnavailable("no embedding credential stands");
      return undefined;
    }
    const identity = await adapter.identity();
    return { provider: identity.provider, model: identity.model };
  };

  const embedAll = async (
    adapter: EmbeddingAdapter,
    texts: readonly { hash: string; text: string }[],
  ): Promise<EmbeddingWrite[] | { failed: string }> => {
    const written: EmbeddingWrite[] = [];
    for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
      const answer = await adapter.embed(batch.map((entry) => entry.text));
      if (answer.outcome === MODEL_RESPONSE_OUTCOME.THROTTLED) {
        return { failed: "the embedding provider is rate limiting" };
      }
      if (answer.outcome === MODEL_RESPONSE_OUTCOME.FAILED) {
        return { failed: `${answer.failure}: ${answer.reason}` };
      }
      batch.forEach((entry, index) => {
        const vector = answer.vectors[index];
        if (vector) written.push({ hash: entry.hash, vector });
      });
    }
    return written;
  };

  const syncOnce = async (): Promise<MemorySyncReport | undefined> => {
    if (!dependencies.persistent) return undefined;
    const client = dependencies.client();
    const identity = await identityOf();
    const plan = await client.planMemorySync(identity, dependencies.now());
    let embeddings: EmbeddingWrite[] = [];
    if (identity && plan.missingEmbeddings.length > 0) {
      const adapter = dependencies.embeddingAdapter();
      const embedded = adapter
        ? await embedAll(adapter, plan.missingEmbeddings)
        : { failed: "no embedding credential stands" };
      if ("failed" in embedded) {
        embeddingUnavailable(embedded.failed);
        // Keyword rows still land so the notebook stays searchable, under the
        // same identity so every vector already cached is kept on its chunk;
        // only the chunks still without one are asked for again next sync.
      } else {
        embeddings = embedded;
        mode = RETRIEVAL_MODE.HYBRID;
        modeNote = undefined;
      }
    } else if (identity) {
      mode = RETRIEVAL_MODE.HYBRID;
      modeNote = undefined;
    }
    const report = await client.applyMemorySync({
      changed: plan.changed,
      removed: plan.removed,
      embeddings,
      ...(identity ? { identity } : undefined),
      now: dependencies.now(),
    });
    return { mode, ...report, ...(modeNote ? { note: modeNote } : undefined) };
  };

  const sync = (): Promise<MemorySyncReport | undefined> => {
    if (syncing) return syncing;
    syncing = syncOnce()
      .then((report) => {
        dependencies.onSynced?.();
        return report;
      })
      .catch((error) => {
        dependencies.report(
          `Notebook index sync failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      })
      .finally(() => {
        syncing = undefined;
      });
    return syncing;
  };

  /** The conversations a search from `current` may read lines of: eligible, same agent, never itself. */
  const eligibleKeys = (current: SessionKey): SessionKey[] =>
    dependencies
      .conversationDirectory()
      .filter((record) =>
        isRecallEligibleConversation(
          {
            sessionKey: record.sessionKey,
            agentId: DEFAULT_AGENT_ID,
            temporary: dependencies.isTemporary(record.sessionKey),
          },
          { sessionKey: current, agentId: DEFAULT_AGENT_ID },
        ),
      )
      .map((record) => record.sessionKey);

  /** A line's keyword score: the share of the query's tokens it carries; a search has no bm25 over History. */
  const lexicalScore = (query: string, words: string): number => {
    const asked = [...tokenize(query)];
    if (asked.length === 0) return 0;
    const held = tokenize(words);
    return asked.filter((token) => held.has(token)).length / asked.length;
  };

  const conversationResults = async (
    current: SessionKey,
    query: string,
    limit: number,
  ): Promise<MemorySearchResult[]> => {
    const keys = eligibleKeys(current);
    if (keys.length === 0 || limit <= 0) return [];
    const hits = await dependencies.client().searchHistory(keys, query, limit, dependencies.now());
    return hits.map((hit, ordinal) => {
      const textScore = lexicalScore(query, hit.entry.words);
      // A line has no line number; its moment stands in, so two hits from one
      // conversation are two results and never one.
      const moment = hit.entry.recordedAt ?? ordinal;
      return {
        path: `conversation:${hit.sessionKey}`,
        startLine: moment,
        endLine: moment,
        score: MEMORY_SEARCH_DEFAULTS.TEXT_WEIGHT * textScore,
        vectorScore: 0,
        textScore,
        snippet: `${hit.entry.kind}: ${hit.entry.words}`,
        source: MEMORY_SOURCE.CONVERSATIONS,
        provenance: {
          origin:
            hit.entry.kind === CONVERSATION_ENTRY_KIND.TYPED_ASK ||
            hit.entry.kind === CONVERSATION_ENTRY_KIND.SPOKEN_ASK
              ? MEMORY_ORIGIN.USER
              : MEMORY_ORIGIN.AGENT,
          path: hit.sessionKey,
          indexedAt: hit.entry.recordedAt ?? 0,
        },
      };
    });
  };

  const search = async (
    current: SessionKey,
    ask: { query: string; maxResults?: number; signal: AbortSignal },
  ): Promise<MemorySearchAnswer> => {
    const client = dependencies.client();
    const maxResults = ask.maxResults ?? MEMORY_SEARCH_DEFAULTS.MAXIMUM_RESULTS;
    let queryVector: readonly number[] | undefined;
    let identity: EmbeddingModelIdentity | undefined;
    if (selection !== EMBEDDING_PROVIDER_SELECTION.NONE) {
      const adapter = dependencies.embeddingAdapter();
      if (adapter) {
        const answer = await adapter.embed([ask.query], { signal: ask.signal });
        if (answer.outcome === MODEL_RESPONSE_OUTCOME.ANSWERED && answer.vectors[0]) {
          queryVector = answer.vectors[0];
          const known = await adapter.identity();
          identity = { provider: known.provider, model: known.model };
          mode = RETRIEVAL_MODE.HYBRID;
          modeNote = undefined;
        } else if (answer.outcome === MODEL_RESPONSE_OUTCOME.THROTTLED) {
          embeddingUnavailable("the embedding provider is rate limiting");
        } else if (answer.outcome === MODEL_RESPONSE_OUTCOME.FAILED) {
          embeddingUnavailable(`${answer.failure}: ${answer.reason}`);
        } else {
          embeddingUnavailable("the embedding provider answered no vector");
        }
      } else {
        embeddingUnavailable("no embedding credential stands");
      }
    }
    if (mode === RETRIEVAL_MODE.UNAVAILABLE) {
      return { mode, results: [], ...(modeNote ? { note: modeNote } : undefined) };
    }
    const outcome = await client.searchMemory({
      query: ask.query,
      ...(queryVector && identity ? { queryVector, identity } : undefined),
      maxResults,
      now: dependencies.now(),
    });
    // Conversation lines rank inside the same window as the notebook's
    // chunks, under the same weights and the same threshold: they are keyword
    // hits, so they enter the strict window only when their words match well
    // and otherwise fill spare room the way any keyword-only hit does.
    const conversations = await conversationResults(
      current,
      ask.query,
      maxResults * MEMORY_SEARCH_DEFAULTS.CANDIDATE_MULTIPLIER,
    );
    const merged = [...outcome.results, ...conversations].sort(
      (a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine,
    );
    const keywordBacked = merged.filter((result) => result.textScore > 0);
    return {
      mode,
      results: selectHybridSearchResults({
        merged,
        keyword: keywordBacked,
        maxResults,
        minScore: MEMORY_SEARCH_DEFAULTS.MINIMUM_SCORE,
      }),
      ...(modeNote ? { note: modeNote } : undefined),
    };
  };

  const resultRecord = (result: MemorySearchResult): WireRecord => ({
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
  });

  const accessFor = (sessionKey: SessionKey): BrainMemoryAccess | undefined => {
    if (!dependencies.persistent) return undefined;
    return {
      search: async (ask) => {
        const answer = await search(sessionKey, ask);
        return {
          status: ACT_RESULT_STATUS.ACCEPTED,
          mode: answer.mode,
          ...(answer.note ? { note: answer.note } : undefined),
          results: answer.results.map(resultRecord),
        };
      },
      get: async (ask): Promise<WireRecord> => {
        const read = await dependencies.client().readMemory(ask.path, ask.from, ask.lines);
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
  };

  const recentTurns = (sessionKey: SessionKey): RecallRecentTurn[] =>
    dependencies
      .historyLines(sessionKey)
      .slice(-RECENT_TURNS_READ)
      .flatMap((entry): RecallRecentTurn[] => {
        if (
          entry.kind === CONVERSATION_ENTRY_KIND.TYPED_ASK ||
          entry.kind === CONVERSATION_ENTRY_KIND.SPOKEN_ASK
        ) {
          return [{ role: "user", text: entry.words }];
        }
        if (entry.kind === CONVERSATION_ENTRY_KIND.REPLY) {
          return [{ role: "assistant", text: entry.words }];
        }
        return [];
      });

  const recalls = new Map<SessionKey, ConversationRecall>();
  const recallFor = (sessionKey: SessionKey) => {
    if (!dependencies.persistent) return undefined;
    if (
      !conversationRunsRecall({
        sessionKey,
        agentId: DEFAULT_AGENT_ID,
        temporary: dependencies.isTemporary(sessionKey),
      })
    ) {
      return undefined;
    }
    let recall = recalls.get(sessionKey);
    if (!recall) {
      recall = new ConversationRecall({
        now: dependencies.now,
        report: dependencies.report,
        trustedMemory: async (query, signal) => {
          const answer = await search(sessionKey, {
            query,
            signal: signal ?? new AbortController().signal,
          });
          return {
            strongHit: answer.results.some(
              (result) =>
                result.source === MEMORY_SOURCE.MEMORY &&
                result.score >= MEMORY_SEARCH_DEFAULTS.MINIMUM_SCORE,
            ),
          };
        },
        subrun: async ({ query, recentTurns: recent, signal }) => {
          const runtime = dependencies.createRuntime();
          const memory = accessFor(sessionKey);
          if (!runtime || !memory) return undefined;
          return runRecallSubrun({
            runtime,
            memory,
            query,
            recentTurns: recent,
            signal,
            runId: `recall-${dependencies.createId()}`,
          });
        },
      });
      recalls.set(sessionKey, recall);
    }
    const bound = recall;
    return async (ask: BrainRecallAsk) => {
      const result = await bound.recall({
        sessionKey,
        agentId: DEFAULT_AGENT_ID,
        query: ask.query,
        recentTurns: recentTurns(sessionKey),
        signal: ask.signal,
      });
      return result.summary.length > 0 ? result.summary : undefined;
    };
  };

  return {
    start: async () => {
      if (!dependencies.persistent) return;
      await sync();
      watcher ??= watchMemoryFiles({
        directory: dependencies.workspaceDirectory(),
        onChange: () => {
          void sync();
        },
        report: dependencies.report,
      });
    },
    stop: () => {
      watcher?.close();
      watcher = undefined;
    },
    sync,
    accessFor,
    recallFor,
    mode: () => mode,
  };
}
