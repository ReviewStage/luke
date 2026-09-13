import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import {
  type ConversationRecord,
  conversationKindOf,
  type EmbeddingAdapter,
  MAIN_SESSION_KEY,
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type SessionKey,
  threadSessionKey,
} from "@sidecar/runtime/vocabulary";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/session";
import { isRecord, type WireRecord } from "@sidecar/wire";
import { Deferred, Effect, Fiber, type FileSystem, type Scope } from "effect";
import { chunkMarkdown, hashText } from "./chunking.js";
import {
  type ConversationLineHit,
  type EmbeddingModelIdentity,
  type IndexedFileWrite,
  MEMORY_ORIGIN,
  MEMORY_SOURCE,
  type MemoryScanPlan,
  type MemorySearchQuery,
  type MemorySyncApply,
} from "./contracts.js";
import { MEMORY_SEARCH_DEFAULTS, RETRIEVAL_MODE } from "./defaults.js";
import {
  conversationResultPath,
  makeNotebookMemory,
  type NotebookMemoryOptions,
  type NotebookMemoryStore,
} from "./notebook-memory.js";
import {
  cosineSimilarity,
  defaultRankingOptions,
  mergeHybridResults,
  selectHybridSearchResults,
  tokenize,
} from "./ranking.js";

const NOW = 1_800_000_000_000;
const MEMORY_FILE = "MEMORY.md";

/** A toy embedding over a fixed vocabulary, deterministic and enough for cosine to rank. */
function embed(text: string): number[] {
  const words = ["tuesday", "deploys", "frankfurt", "cluster", "espresso"];
  const lower = text.toLowerCase();
  return words.map((word) => (lower.includes(word) ? 1 : 0));
}

function adapter(behaviour: { fail?: boolean; failAfterBatches?: number } = {}) {
  const built = {
    calls: 0,
    fail: behaviour.fail ?? false,
    identity: async () => ({ provider: "fake-embeddings", model: "toy", dimensions: 5 }),
    embed: async (texts: readonly string[]) => {
      built.calls += 1;
      const failing =
        built.fail ||
        (behaviour.failAfterBatches !== undefined && built.calls > behaviour.failAfterBatches);
      if (failing) {
        return {
          outcome: MODEL_RESPONSE_OUTCOME.FAILED,
          failure: MODEL_FAILURE.UPSTREAM,
          reason: "embeddings are down",
        } as const;
      }
      return { outcome: MODEL_RESPONSE_OUTCOME.ANSWERED, vectors: texts.map(embed) } as const;
    },
  };
  return built satisfies EmbeddingAdapter;
}

interface StoredChunk {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  readonly hash: string;
  readonly vector?: readonly number[];
}

/**
 * The store's worker in memory: the same plan, apply, keyword and vector
 * ranking the SQLite table runs, over a map, so the host is exercised over
 * the seam it is given and no database.
 */
class FakeStore implements NotebookMemoryStore {
  readonly #root: string;
  readonly #files = new Map<string, { hash: string; chunks: StoredChunk[] }>();
  readonly #cache = new Map<string, readonly number[]>();
  readonly linesByKey = new Map<SessionKey, ConversationEntry[]>();
  conversationSearches = 0;

  constructor(root: string) {
    this.#root = root;
  }

  #scan(): { path: string; content: string }[] {
    const files: { path: string; content: string }[] = [];
    for (const name of [MEMORY_FILE, "USER.md"]) {
      const absolute = path.join(this.#root, name);
      if (fs.existsSync(absolute))
        files.push({ path: name, content: fs.readFileSync(absolute, "utf8") });
    }
    const notes = path.join(this.#root, "memory");
    if (fs.existsSync(notes)) {
      for (const name of fs.readdirSync(notes).sort()) {
        files.push({
          path: `memory/${name}`,
          content: fs.readFileSync(path.join(notes, name), "utf8"),
        });
      }
    }
    return files;
  }

  planMemorySync(identity: EmbeddingModelIdentity | undefined): Effect.Effect<MemoryScanPlan> {
    return Effect.sync(() => this.#plan(identity));
  }

  #plan(identity: EmbeddingModelIdentity | undefined): MemoryScanPlan {
    const changed: IndexedFileWrite[] = [];
    const seen = new Set<string>();
    let unchanged = 0;
    for (const file of this.#scan()) {
      seen.add(file.path);
      const hash = hashText(file.content);
      const known = this.#files.get(file.path);
      const lacking = known?.chunks.some((chunk) => chunk.text.trim() && !chunk.vector) ?? false;
      if (known && known.hash === hash && !(identity && lacking)) {
        unchanged += 1;
        continue;
      }
      changed.push({
        path: file.path,
        source: MEMORY_SOURCE.MEMORY,
        hash,
        mtimeMs: NOW,
        size: file.content.length,
        origin: MEMORY_ORIGIN.AGENT,
        chunks: chunkMarkdown(file.content),
      });
    }
    const missing = new Map<string, string>();
    if (identity) {
      for (const file of changed) {
        for (const chunk of file.chunks) {
          if (!this.#cache.has(chunk.hash) && chunk.text.trim())
            missing.set(chunk.hash, chunk.text);
        }
      }
    }
    return {
      changed,
      removed: [...this.#files.keys()].filter((known) => !seen.has(known)),
      missingEmbeddings: [...missing.entries()].map(([hash, text]) => ({ hash, text })),
      unchanged,
    };
  }

  applyMemorySync(apply: MemorySyncApply) {
    return Effect.sync(() => this.#apply(apply));
  }

  #apply(apply: MemorySyncApply) {
    for (const embedding of apply.embeddings) this.#cache.set(embedding.hash, embedding.vector);
    for (const removed of apply.removed) this.#files.delete(removed);
    let indexedChunks = 0;
    let embeddedChunks = 0;
    for (const file of apply.changed) {
      const chunks = file.chunks.map((chunk): StoredChunk => {
        const vector = apply.identity ? this.#cache.get(chunk.hash) : undefined;
        indexedChunks += 1;
        if (vector) embeddedChunks += 1;
        return { ...chunk, path: file.path, ...(vector ? { vector } : undefined) };
      });
      this.#files.set(file.path, { hash: file.hash, chunks });
    }
    return {
      indexedFiles: apply.changed.length,
      removedFiles: apply.removed.length,
      indexedChunks,
      embeddedChunks,
    };
  }

  status() {
    const chunks = [...this.#files.values()].flatMap((file) => file.chunks);
    return {
      sources: this.#files.size,
      chunks: chunks.length,
      embeddedChunks: chunks.filter((chunk) => chunk.vector).length,
    };
  }

  searchMemory(query: MemorySearchQuery) {
    return Effect.sync(() => this.#search(query));
  }

  #search(query: MemorySearchQuery) {
    const chunks = [...this.#files.values()].flatMap((file) => file.chunks);
    const asked = [...tokenize(query.query)];
    const keyword = chunks.flatMap((chunk) => {
      const held = tokenize(chunk.text);
      if (!asked.every((token) => held.has(token))) return [];
      return [{ ...hit(chunk), textScore: 1 }];
    });
    const vector = chunks.flatMap((chunk) => {
      if (!query.queryVector || !chunk.vector) return [];
      const score = cosineSimilarity(query.queryVector, chunk.vector);
      return score > 0 ? [{ ...hit(chunk), vectorScore: score }] : [];
    });
    const merged = mergeHybridResults(
      vector,
      keyword,
      MEMORY_SOURCE.MEMORY,
      defaultRankingOptions(query.now),
    );
    const maxResults = query.maxResults ?? MEMORY_SEARCH_DEFAULTS.MAXIMUM_RESULTS;
    return {
      results: selectHybridSearchResults({
        merged,
        keyword,
        maxResults,
        minScore: query.minScore ?? MEMORY_SEARCH_DEFAULTS.MINIMUM_SCORE,
      }),
      keywordHits: keyword.length,
      vectorHits: vector.length,
    };
  }

  readMemory(relative: string, from = 1, lines = 120) {
    return Effect.sync(() => this.#read(relative, from, lines));
  }

  #read(relative: string, from: number, lines: number) {
    if (relative.includes("..")) return undefined;
    const absolute = path.join(this.#root, relative);
    if (!fs.existsSync(absolute)) return undefined;
    const all = fs.readFileSync(absolute, "utf8").split("\n");
    const end = Math.min(all.length, from + lines - 1);
    return {
      path: relative,
      text: all.slice(from - 1, end).join("\n"),
      from,
      to: end,
      totalLines: all.length,
      truncated: end < all.length,
    };
  }

  searchConversation(
    sessionKeys: readonly SessionKey[],
    query: string,
    limit: number,
  ): Effect.Effect<readonly ConversationLineHit[]> {
    return Effect.sync(() => this.#searchConversation(sessionKeys, query, limit));
  }

  #searchConversation(
    sessionKeys: readonly SessionKey[],
    query: string,
    limit: number,
  ): readonly ConversationLineHit[] {
    this.conversationSearches += 1;
    const asked = [...tokenize(query)];
    const hits: ConversationLineHit[] = [];
    for (const sessionKey of sessionKeys) {
      for (const entry of this.linesByKey.get(sessionKey) ?? []) {
        const held = tokenize(entry.words);
        if (asked.every((token) => held.has(token))) hits.push({ sessionKey, entry });
      }
    }
    return hits
      .sort((a, b) => (b.entry.recordedAt ?? 0) - (a.entry.recordedAt ?? 0))
      .slice(0, limit);
  }
}

function hit(chunk: StoredChunk) {
  return {
    id: `${chunk.path}#${chunk.startLine}`,
    path: chunk.path,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    snippet: chunk.text,
    provenance: { origin: MEMORY_ORIGIN.AGENT, path: chunk.path, indexedAt: NOW },
  };
}

function workspace() {
  return Effect.map(temporaryDirectoryScoped("luke-notebook-memory-"), (root) => {
    fs.mkdirSync(path.join(root, "memory"), { recursive: true });
    fs.writeFileSync(
      path.join(root, MEMORY_FILE),
      "# MEMORY.md\n\nDeploys go out on Tuesday afternoons.\nThe staging cluster lives in Frankfurt.\n",
    );
    return root;
  });
}

function resultsOf(answer: WireRecord): WireRecord[] {
  return Array.isArray(answer.results) ? answer.results.filter(isRecord) : [];
}

/** Waits for a condition the fibers under test settle, by giving them turns rather than a fixed drain. */
function until(condition: () => boolean): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 1_000; turn += 1) {
      if (condition()) return;
      yield* Effect.yieldNow;
    }
    assert.ok(condition(), "the condition did not hold in time");
  });
}

function harness(overrides: Partial<NotebookMemoryOptions> = {}) {
  return Effect.gen(function* () {
    const root = yield* workspace();
    const store = new FakeStore(root);
    const thread = threadSessionKey("11111111-1111-1111-1111-111111111111");
    const temporary = threadSessionKey("22222222-2222-2222-2222-222222222222");
    const records: ConversationRecord[] = [MAIN_SESSION_KEY, thread, temporary].map(
      (sessionKey) => ({
        sessionKey,
        kind: conversationKindOf(sessionKey),
        name: sessionKey,
        createdAt: NOW,
        lastActivityAt: NOW,
      }),
    );
    const embedding = adapter();
    const reports: string[] = [];
    const memory = yield* makeNotebookMemory({
      store: () => store,
      embeddingAdapter: () => embedding,
      embeddingBatchSize: 1,
      workspaceDirectory: () => root,
      conversationDirectory: () => records,
      isTemporary: (sessionKey) => sessionKey === temporary,
      now: () => NOW + 10,
      report: (message) => reports.push(message),
      ...overrides,
    });
    return { root, store, memory, thread, temporary, embedding, reports };
  });
}

const signal = () => new AbortController().signal;

const platform = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Scope.Scope>) =>
  Effect.provide(effect, NodeFileSystem.layer);

it.scoped(
  "a sync indexes the notebook with vectors, a search runs hybrid, and a hand edit is picked up by the next sync",
  () =>
    platform(
      Effect.gen(function* () {
        const h = yield* harness();
        const first = yield* h.memory.sync;
        assert.equal(first?.mode, RETRIEVAL_MODE.HYBRID);
        assert.equal(yield* h.memory.mode, RETRIEVAL_MODE.HYBRID);
        assert.ok(
          first && first.embeddedChunks > 0 && first.embeddedChunks === first.indexedChunks,
        );
        const access = h.memory.accessFor(MAIN_SESSION_KEY);
        const searched = yield* access.search({ query: "frankfurt cluster", signal: signal() });
        assert.equal(searched.mode, RETRIEVAL_MODE.HYBRID);
        const hits = resultsOf(searched);
        assert.equal(hits[0]?.path, MEMORY_FILE);
        assert.equal(hits[0]?.source, MEMORY_SOURCE.MEMORY);
        fs.writeFileSync(
          path.join(h.root, MEMORY_FILE),
          "# MEMORY.md\n\nThe team drinks espresso.\n",
        );
        const second = yield* h.memory.sync;
        assert.equal(second?.indexedFiles, 1);
        const again = resultsOf(yield* access.search({ query: "frankfurt", signal: signal() }));
        assert.equal(again.filter((entry) => entry.source === MEMORY_SOURCE.MEMORY).length, 0);
        const read = yield* access.get({ path: MEMORY_FILE, from: 3, lines: 1 });
        assert.equal(read.text, "The team drinks espresso.");
        const refused = yield* access.get({ path: "../settings.json" });
        assert.equal(refused.status, "rejected");
      }),
    ),
);

it.scoped(
  "an embedding outage degrades an automatic provider to keyword-only for that call, and the standing mode follows the sync alone",
  () =>
    platform(
      Effect.gen(function* () {
        const h = yield* harness();
        assert.equal((yield* h.memory.sync)?.mode, RETRIEVAL_MODE.HYBRID);
        h.embedding.fail = true;
        const access = h.memory.accessFor(MAIN_SESSION_KEY);
        const searched = yield* access.search({ query: "frankfurt", signal: signal() });
        assert.equal(searched.mode, RETRIEVAL_MODE.KEYWORD_ONLY);
        assert.equal(resultsOf(searched).length, 1);
        assert.equal(
          yield* h.memory.mode,
          RETRIEVAL_MODE.HYBRID,
          "a search moves the standing mode of nothing",
        );
        assert.equal(
          (yield* h.memory.sync)?.mode,
          RETRIEVAL_MODE.HYBRID,
          "nothing to embed, nothing failed",
        );
        fs.writeFileSync(path.join(h.root, "memory", "note.md"), "# note\n\nEspresso thrice.\n");
        const report = yield* h.memory.sync;
        assert.equal(report?.mode, RETRIEVAL_MODE.KEYWORD_ONLY);
        assert.equal(yield* h.memory.mode, RETRIEVAL_MODE.KEYWORD_ONLY);
      }),
    ),
);

it.scoped(
  "a later batch's failure keeps every vector the earlier batches answered, and the report says the rest are missing",
  () =>
    platform(
      Effect.gen(function* () {
        const h = yield* harness();
        fs.writeFileSync(path.join(h.root, "memory", "note.md"), "# note\n\nEspresso thrice.\n");
        const partial = adapter({ failAfterBatches: 1 });
        const memory = yield* makeNotebookMemory({
          store: () => h.store,
          embeddingAdapter: () => partial,
          embeddingBatchSize: 1,
          workspaceDirectory: () => h.root,
          conversationDirectory: () => [],
          isTemporary: () => false,
          now: () => NOW,
          report: () => undefined,
        });
        const report = yield* memory.sync;
        assert.equal(report?.mode, RETRIEVAL_MODE.KEYWORD_ONLY);
        assert.equal(report?.embeddedChunks, 1, "the batch that answered is kept");
        assert.equal(h.store.status().embeddedChunks, 1);
        partial.fail = false;
        const retrying = yield* makeNotebookMemory({
          store: () => h.store,
          embeddingAdapter: () => adapter(),
          embeddingBatchSize: 64,
          workspaceDirectory: () => h.root,
          conversationDirectory: () => [],
          isTemporary: () => false,
          now: () => NOW + 1,
          report: () => undefined,
        });
        const retried = yield* retrying.sync;
        assert.equal(retried?.mode, RETRIEVAL_MODE.HYBRID);
        assert.equal(h.store.status().embeddedChunks, h.store.status().chunks);
      }),
    ),
);

it.scoped(
  "conversation hits are keyword-only fallback: they fill spare slots from eligible conversations' Conversation and never displace notebook chunks",
  () =>
    platform(
      Effect.gen(function* () {
        const h = yield* harness();
        yield* h.memory.sync;
        h.store.linesByKey.set(MAIN_SESSION_KEY, [
          {
            kind: CONVERSATION_ENTRY_KIND.ASK,
            words: "we chose Tuesday deploys in main",
            recordedAt: NOW,
            eventId: "a",
          },
        ]);
        h.store.linesByKey.set(h.thread, [
          {
            kind: CONVERSATION_ENTRY_KIND.REPLY,
            words: "Tuesday it is",
            recordedAt: NOW + 1,
            eventId: "b",
          },
          {
            kind: CONVERSATION_ENTRY_KIND.REPLY,
            words: "tuesday again",
            recordedAt: NOW + 3,
            eventId: "d",
          },
        ]);
        h.store.linesByKey.set(h.temporary, [
          {
            kind: CONVERSATION_ENTRY_KIND.REPLY,
            words: "tuesday secret",
            recordedAt: NOW + 2,
            eventId: "c",
          },
        ]);
        const fromMain = h.memory.accessFor(MAIN_SESSION_KEY);
        const all = resultsOf(yield* fromMain.search({ query: "tuesday", signal: signal() }));
        const conversations = all.filter((entry) => entry.source === MEMORY_SOURCE.CONVERSATIONS);
        assert.deepEqual(
          conversations.map((entry) => entry.path),
          [conversationResultPath(h.thread), conversationResultPath(h.thread)],
          "two lines of one eligible conversation are two results; the asking one and a temporary thread give none",
        );
        assert.ok(
          conversations.every(
            (entry) => Number(entry.score) <= MEMORY_SEARCH_DEFAULTS.TEXT_WEIGHT + Number.EPSILON,
          ),
          "a conversation hit has no vector, so it scores at most the text weight",
        );
        assert.ok(
          conversations.every(
            (entry) => Number(entry.score) < MEMORY_SEARCH_DEFAULTS.MINIMUM_SCORE,
          ),
          "and never clears the strict window on its own",
        );
        assert.equal(all[0]?.source, MEMORY_SOURCE.MEMORY, "the notebook's chunk ranks first");
        const one = resultsOf(
          yield* fromMain.search({ query: "tuesday", maxResults: 1, signal: signal() }),
        );
        assert.deepEqual(
          one.map((entry) => entry.source),
          [MEMORY_SOURCE.MEMORY],
          "a window the notebook fills on its own excludes every conversation hit",
        );
        const fromThread = h.memory.accessFor(h.thread);
        const threadHits = resultsOf(
          yield* fromThread.search({ query: "tuesday", signal: signal() }),
        ).filter((entry) => entry.source === MEMORY_SOURCE.CONVERSATIONS);
        assert.deepEqual(
          threadHits.map((entry) => entry.path),
          [conversationResultPath(MAIN_SESSION_KEY)],
        );
      }),
    ),
);

it.scoped(
  "a launch before any credential indexes keyword-only, and the first credentialed sync backfills the vectors; one adapter read serves the whole pass",
  () =>
    platform(
      Effect.gen(function* () {
        let credential: EmbeddingAdapter | undefined;
        let reads = 0;
        const h = yield* harness({
          embeddingAdapter: () => {
            reads += 1;
            return credential;
          },
        });
        const first = yield* h.memory.sync;
        assert.equal(first?.mode, RETRIEVAL_MODE.KEYWORD_ONLY);
        assert.equal(first?.embeddedChunks, 0);
        assert.equal(reads, 1);
        credential = h.embedding;
        const second = yield* h.memory.sync;
        assert.equal(second?.mode, RETRIEVAL_MODE.HYBRID);
        assert.ok(
          second && second.indexedFiles > 0,
          "unchanged files are planned again for their vectors",
        );
        assert.equal(reads, 2, "the identity and the vectors come from one read of the adapter");
        assert.equal(h.store.status().embeddedChunks, h.store.status().chunks);
        const third = yield* h.memory.sync;
        assert.equal(
          third?.indexedFiles,
          0,
          "once every chunk has a vector the files are left alone",
        );
      }),
    ),
);

it.scoped(
  "a sync asked for during a pass runs one follow-on pass under the adapter that stands then, and every request during the pass shares it",
  () =>
    platform(
      Effect.gen(function* () {
        let credential: EmbeddingAdapter | undefined;
        let synced = 0;
        const h = yield* harness({
          embeddingAdapter: () => credential,
          onSynced: Effect.sync(() => {
            synced += 1;
          }),
        });
        const plan = h.store.planMemorySync.bind(h.store);
        const gate = yield* Deferred.make<void>();
        let plans = 0;
        h.store.planMemorySync = (identity: EmbeddingModelIdentity | undefined) =>
          Effect.suspend(() => {
            plans += 1;
            return plans === 1
              ? Effect.andThen(Deferred.await(gate), plan(identity))
              : plan(identity);
          });
        let asked = 0;
        const askSync = Effect.andThen(
          Effect.sync(() => {
            asked += 1;
          }),
          h.memory.sync,
        );
        const launch = yield* Effect.forkChild(h.memory.sync);
        yield* until(() => plans === 1);
        credential = h.embedding;
        const requested = yield* Effect.forkChild(askSync);
        const again = yield* Effect.forkChild(askSync);
        yield* until(() => asked === 2);
        yield* Deferred.succeed(gate, undefined);
        const first = yield* Fiber.join(launch);
        assert.equal(
          first?.mode,
          RETRIEVAL_MODE.KEYWORD_ONLY,
          "the pass under way kept its adapter read",
        );
        const second = yield* Fiber.join(requested);
        const third = yield* Fiber.join(again);
        assert.deepEqual(second, third, "requests during one pass share the follow-on");
        assert.equal(second?.mode, RETRIEVAL_MODE.HYBRID);
        assert.ok(second && second.embeddedChunks > 0);
        assert.equal(h.store.status().embeddedChunks, h.store.status().chunks);
        assert.equal(plans, 2, "exactly one follow-on pass ran");
        assert.equal(synced, 2);
        const idle = yield* h.memory.sync;
        assert.equal(idle?.indexedFiles, 0);
        assert.equal(plans, 3, "no pass runs that was not asked for");
      }),
    ),
);
