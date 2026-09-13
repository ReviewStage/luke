import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { inProcessStoreTransport, storeClient } from "@sidecar/brain/store";
import { MEMORY_SOURCE, RETRIEVAL_MODE } from "@sidecar/memory";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import {
  type ConversationRecord,
  conversationKindOf,
  DEFAULT_AGENT_ID,
  type EmbeddingAdapter,
  MAIN_CONVERSATION_NAME,
  MAIN_SESSION_KEY,
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  threadSessionKey,
} from "@sidecar/runtime/vocabulary";
import { CONVERSATION_ENTRY_KIND } from "@sidecar/session";
import { isRecord, type WireRecord } from "@sidecar/wire";
import { Context, Effect, type FileSystem, type Scope } from "effect";
import { composeNotebookMemory, type NotebookMemoryDependencies } from "./notebook-memory.js";

const NOW = 1_800_000_000_000;

const agentRoot = () =>
  Effect.map(temporaryDirectoryScoped("luke-notebook-memory-"), (root) => {
    fs.mkdirSync(path.join(root, "workspace", "memory"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "workspace", "MEMORY.md"),
      "# MEMORY.md\n\nDeploys go out on Tuesday afternoons.\nThe staging cluster lives in Frankfurt.\n",
    );
    return root;
  });

/** A toy embedding over a fixed vocabulary, deterministic and enough for cosine to rank. */
function embed(text: string): number[] {
  const words = ["tuesday", "deploys", "frankfurt", "cluster", "espresso"];
  const lower = text.toLowerCase();
  return words.map((word) => (lower.includes(word) ? 1 : 0));
}

function adapter(
  behaviour: { fail?: boolean } = {},
): EmbeddingAdapter & { calls: number; fail: boolean } {
  const built = {
    calls: 0,
    fail: behaviour.fail ?? false,
    identity: async () => ({ provider: "fake-embeddings", model: "toy", dimensions: 5 }),
    embed: async (texts: readonly string[]) => {
      built.calls += 1;
      if (built.fail) {
        return {
          outcome: MODEL_RESPONSE_OUTCOME.FAILED,
          failure: MODEL_FAILURE.UPSTREAM,
          reason: "embeddings are down",
        } as const;
      }
      return { outcome: MODEL_RESPONSE_OUTCOME.ANSWERED, vectors: texts.map(embed) } as const;
    },
  };
  return built;
}

function harness(overrides: Partial<NotebookMemoryDependencies> = {}) {
  return Effect.gen(function* () {
    const root = yield* agentRoot();
    const store = storeClient(inProcessStoreTransport(), Context.empty());
    yield* Effect.promise(() =>
      store.open({
        agentRoot: root,
        workspaceDirectory: path.join(root, "workspace"),
        agentId: DEFAULT_AGENT_ID,
        sessionKey: MAIN_SESSION_KEY,
        conversationName: MAIN_CONVERSATION_NAME,
        now: NOW,
      }),
    );
    const thread = threadSessionKey("11111111-1111-1111-1111-111111111111");
    const temporary = threadSessionKey("22222222-2222-2222-2222-222222222222");
    yield* Effect.promise(() =>
      store.ask("conversations.create", {
        agentId: DEFAULT_AGENT_ID,
        sessionKey: thread,
        name: "Thread",
        now: NOW,
      }),
    );
    yield* Effect.promise(() =>
      store.ask("conversations.create", {
        agentId: DEFAULT_AGENT_ID,
        sessionKey: temporary,
        name: "Temp",
        now: NOW,
      }),
    );
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
    const wiring = yield* composeNotebookMemory({
      client: () => store,
      embeddingAdapter: () => embedding,
      workspaceDirectory: () => path.join(root, "workspace"),
      conversationDirectory: () => records,
      isTemporary: (sessionKey) => sessionKey === temporary,
      now: () => NOW + 10,
      report: (message) => reports.push(message),
      ...overrides,
    });
    return {
      root,
      store,
      close: Effect.asVoid(Effect.promise(() => store.close())),
      wiring,
      thread,
      temporary,
      embedding,
      reports,
    };
  });
}

function resultsOf(answer: WireRecord): WireRecord[] {
  return Array.isArray(answer.results) ? answer.results.filter(isRecord) : [];
}

const platform = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Scope.Scope>) =>
  Effect.provide(effect, NodeFileSystem.layer);

const signal = () => new AbortController().signal;

it.effect("a sync and a search run over the real store worker, not a fake", () =>
  platform(
    Effect.gen(function* () {
      const h = yield* harness();
      const first = yield* h.wiring.sync;
      assert.equal(first?.mode, RETRIEVAL_MODE.HYBRID);
      const access = h.wiring.accessFor(MAIN_SESSION_KEY);
      assert.ok(access);
      const searched = yield* access.search({ query: "frankfurt cluster", signal: signal() });
      const hits = resultsOf(searched);
      assert.equal(hits[0]?.path, "MEMORY.md");
      assert.equal(hits[0]?.source, MEMORY_SOURCE.MEMORY);
      yield* h.close;
    }),
  ),
);

it.effect(
  "an embedding outage degrades an automatic provider to keyword-only, and the search says so",
  () =>
    platform(
      Effect.gen(function* () {
        const failing = adapter({ fail: true });
        const h = yield* harness({ embeddingAdapter: () => failing });
        const report = yield* h.wiring.sync;
        assert.equal(report?.mode, RETRIEVAL_MODE.KEYWORD_ONLY);
        assert.ok(
          report && report.indexedChunks > 0 && report.embeddedChunks === 0,
          "keyword rows still land",
        );
        const access = h.wiring.accessFor(MAIN_SESSION_KEY);
        assert.ok(access);
        const searched = yield* access.search({ query: "frankfurt", signal: signal() });
        assert.equal(searched.mode, RETRIEVAL_MODE.KEYWORD_ONLY);
        assert.equal(resultsOf(searched).length, 1);
        yield* h.close;
      }),
    ),
);

it.effect(
  "past-conversation results come from eligible conversations' Conversation alone, never the asking one or a temporary thread",
  () =>
    platform(
      Effect.gen(function* () {
        const h = yield* harness();
        yield* h.wiring.sync;
        yield* Effect.promise(() =>
          h.store.ask("conversation.append", {
            sessionKey: MAIN_SESSION_KEY,
            entries: [
              {
                kind: CONVERSATION_ENTRY_KIND.ASK,
                words: "we chose Tuesday deploys in main",
                recordedAt: NOW,
                eventId: "a",
              },
            ],
            now: NOW,
          }),
        );
        yield* Effect.promise(() =>
          h.store.ask("conversation.append", {
            sessionKey: h.thread,
            entries: [
              {
                kind: CONVERSATION_ENTRY_KIND.REPLY,
                words: "Tuesday it is, said the thread",
                recordedAt: NOW + 1,
                eventId: "b",
              },
              {
                kind: CONVERSATION_ENTRY_KIND.REPLY,
                words: "tuesday again, said the thread",
                recordedAt: NOW + 3,
                eventId: "d",
              },
            ],
            now: NOW + 3,
          }),
        );
        yield* Effect.promise(() =>
          h.store.ask("conversation.append", {
            sessionKey: h.temporary,
            entries: [
              {
                kind: CONVERSATION_ENTRY_KIND.REPLY,
                words: "tuesday secret in a temporary thread",
                recordedAt: NOW + 2,
                eventId: "c",
              },
            ],
            now: NOW + 2,
          }),
        );
        const fromMain = h.wiring.accessFor(MAIN_SESSION_KEY);
        assert.ok(fromMain);
        const mainHits = resultsOf(
          yield* fromMain.search({ query: "tuesday", signal: signal() }),
        ).filter((hit) => hit.source === MEMORY_SOURCE.CONVERSATIONS);
        assert.deepEqual(
          mainHits.map((hit) => hit.path),
          [`conversation:${h.thread}`, `conversation:${h.thread}`],
          "two lines of one conversation are two results",
        );
        const fromThread = h.wiring.accessFor(h.thread);
        assert.ok(fromThread);
        const threadHits = resultsOf(
          yield* fromThread.search({ query: "tuesday", signal: signal() }),
        ).filter((hit) => hit.source === MEMORY_SOURCE.CONVERSATIONS);
        assert.deepEqual(
          threadHits.map((hit) => hit.path),
          [`conversation:${MAIN_SESSION_KEY}`],
        );
        yield* h.close;
      }),
    ),
);

it.effect(
  "a launch before any credential indexes keyword-only, and the first credentialed sync backfills the vectors without an edit",
  () =>
    platform(
      Effect.gen(function* () {
        const embedding = adapter();
        let credential: EmbeddingAdapter | undefined;
        const h = yield* harness({ embeddingAdapter: () => credential });
        const first = yield* h.wiring.sync;
        assert.equal(first?.mode, RETRIEVAL_MODE.KEYWORD_ONLY);
        assert.equal(first?.embeddedChunks, 0);
        assert.equal(
          (yield* Effect.promise(() => h.store.ask("memory.status", {}))).embeddedChunks,
          0,
        );
        credential = embedding;
        const second = yield* h.wiring.sync;
        assert.equal(second?.mode, RETRIEVAL_MODE.HYBRID);
        assert.ok(
          second && second.indexedFiles > 0,
          "unchanged files are planned again for their vectors",
        );
        const status = yield* Effect.promise(() => h.store.ask("memory.status", {}));
        assert.ok(status.embeddedChunks > 0 && status.embeddedChunks === status.chunks);
        const third = yield* h.wiring.sync;
        assert.equal(
          third?.indexedFiles,
          0,
          "once every chunk has a vector the files are left alone",
        );
        yield* h.close;
      }),
    ),
);

it.effect(
  "a transient embedding failure leaves keyword rows searchable and the next sync retries the vectors",
  () =>
    platform(
      Effect.gen(function* () {
        const embedding = adapter({ fail: true });
        const h = yield* harness({ embeddingAdapter: () => embedding });
        const failed = yield* h.wiring.sync;
        assert.equal(failed?.mode, RETRIEVAL_MODE.KEYWORD_ONLY);
        assert.equal(
          (yield* Effect.promise(() => h.store.ask("memory.status", {}))).embeddedChunks,
          0,
        );
        const access = h.wiring.accessFor(MAIN_SESSION_KEY);
        assert.ok(access);
        assert.equal(
          resultsOf(yield* access.search({ query: "frankfurt", signal: signal() })).length,
          1,
          "the notebook stays searchable by keyword meanwhile",
        );
        // A pass that fails after another pass stored vectors keeps every one of them.
        embedding.fail = false;
        yield* h.wiring.sync;
        const before = (yield* Effect.promise(() => h.store.ask("memory.status", {})))
          .embeddedChunks;
        assert.ok(before > 0);
        fs.writeFileSync(
          path.join(h.root, "workspace", "memory", "note.md"),
          "# note\n\nEspresso thrice.\n",
        );
        embedding.fail = true;
        yield* h.wiring.sync;
        assert.equal(
          (yield* Effect.promise(() => h.store.ask("memory.status", {}))).embeddedChunks,
          before,
          "a failed pass wipes no vector an earlier pass stored",
        );
        embedding.fail = false;
        const retried = yield* h.wiring.sync;
        assert.equal(retried?.mode, RETRIEVAL_MODE.HYBRID);
        const status = yield* Effect.promise(() => h.store.ask("memory.status", {}));
        assert.ok(status.embeddedChunks > 0 && status.embeddedChunks === status.chunks);
        yield* h.close;
      }),
    ),
);
