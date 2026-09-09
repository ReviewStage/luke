import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { MEMORY_SOURCE, RETRIEVAL_MODE } from "@sidecar/memory";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/realtime";
import { temporaryDirectory } from "@sidecar/runtime/testing";
import {
  type ConversationRecord,
  conversationKindOf,
  DEFAULT_AGENT_ID,
  type EmbeddingAdapter,
  MAIN_CONVERSATION_NAME,
  MAIN_SESSION_KEY,
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type SessionKey,
  threadSessionKey,
} from "@sidecar/runtime/vocabulary";
import {
  RuntimeStoreClient,
  type RuntimeStorePort,
  serveRuntimeStore,
} from "@sidecar/runtime-store";
import { isRecord, type WireRecord } from "@sidecar/wire";
import { composeNotebookMemory, type NotebookMemoryDependencies } from "./notebook-memory.js";

const NOW = 1_800_000_000_000;

function agentRoot(t: TestContext) {
  const root = temporaryDirectory(t, "luke-notebook-memory-");
  fs.mkdirSync(path.join(root, "workspace", "memory"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "workspace", "MEMORY.md"),
    "# MEMORY.md\n\nDeploys go out on Tuesday afternoons.\nThe staging cluster lives in Frankfurt.\n",
  );
  return root;
}

function client() {
  const channel = new MessageChannel();
  // SAFETY: a MessagePort posts and receives structured-clone values on the same events the port contract names.
  serveRuntimeStore(channel.port2 as unknown as RuntimeStorePort);
  // SAFETY: as above, for the client's end of the same channel.
  const store = new RuntimeStoreClient(channel.port1 as unknown as RuntimeStorePort);
  return {
    store,
    close: () => {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

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

async function harness(t: TestContext, overrides: Partial<NotebookMemoryDependencies> = {}) {
  const root = agentRoot(t);
  const { store, close } = client();
  await store.open({
    agentRoot: root,
    workspaceDirectory: path.join(root, "workspace"),
    agentId: DEFAULT_AGENT_ID,
    sessionKey: MAIN_SESSION_KEY,
    conversationName: MAIN_CONVERSATION_NAME,
    now: NOW,
  });
  const thread = threadSessionKey("11111111-1111-1111-1111-111111111111");
  const temporary = threadSessionKey("22222222-2222-2222-2222-222222222222");
  await store.createConversation({
    agentId: DEFAULT_AGENT_ID,
    sessionKey: thread,
    name: "Thread",
    now: NOW,
  });
  await store.createConversation({
    agentId: DEFAULT_AGENT_ID,
    sessionKey: temporary,
    name: "Temp",
    now: NOW,
  });
  const records: ConversationRecord[] = [MAIN_SESSION_KEY, thread, temporary].map((sessionKey) => ({
    sessionKey,
    kind: conversationKindOf(sessionKey),
    name: sessionKey,
    createdAt: NOW,
    lastActivityAt: NOW,
  }));
  const history = new Map<SessionKey, ConversationEntry[]>();
  const embedding = adapter();
  const reports: string[] = [];
  const wiring = composeNotebookMemory({
    client: () => store,
    embeddingAdapter: () => embedding,
    workspaceDirectory: () => path.join(root, "workspace"),
    conversationDirectory: () => records,
    isTemporary: (sessionKey) => sessionKey === temporary,
    now: () => NOW + 10,
    report: (message) => reports.push(message),
    ...overrides,
  });
  return { root, store, close, wiring, thread, temporary, history, embedding, reports };
}

function resultsOf(answer: WireRecord): WireRecord[] {
  return Array.isArray(answer.results) ? answer.results.filter(isRecord) : [];
}

test("a sync indexes the notebook with vectors, a search runs hybrid, and a hand edit is picked up by the next sync", async (t) => {
  const h = await harness(t);
  const first = await h.wiring.sync();
  assert.equal(first?.mode, RETRIEVAL_MODE.HYBRID);
  assert.ok(first && first.embeddedChunks > 0 && first.embeddedChunks === first.indexedChunks);
  const access = h.wiring.accessFor(MAIN_SESSION_KEY);
  assert.ok(access);
  const searched = await access.search({
    query: "frankfurt cluster",
    signal: new AbortController().signal,
  });
  assert.equal(searched.mode, RETRIEVAL_MODE.HYBRID);
  const hits = resultsOf(searched);
  assert.equal(hits[0]?.path, "MEMORY.md");
  assert.equal(hits[0]?.source, MEMORY_SOURCE.MEMORY);
  assert.ok(isRecord(hits[0]?.provenance) && hits[0].provenance.path === "MEMORY.md");
  fs.writeFileSync(
    path.join(h.root, "workspace", "MEMORY.md"),
    "# MEMORY.md\n\nThe team drinks espresso.\n",
  );
  const second = await h.wiring.sync();
  assert.equal(second?.indexedFiles, 1);
  const again = resultsOf(
    await access.search({ query: "frankfurt", signal: new AbortController().signal }),
  );
  assert.equal(again.filter((hit) => hit.source === MEMORY_SOURCE.MEMORY).length, 0);
  const read = await access.get({ path: "MEMORY.md", from: 3, lines: 1 });
  assert.equal(read.text, "The team drinks espresso.");
  const refused = await access.get({ path: "../settings.json" });
  assert.equal(refused.status, "rejected");
  h.close();
});

test("an embedding outage degrades an automatic provider to keyword-only, and the search says so", async (t) => {
  const failing = adapter({ fail: true });
  const h = await harness(t, { embeddingAdapter: () => failing });
  const report = await h.wiring.sync();
  assert.equal(report?.mode, RETRIEVAL_MODE.KEYWORD_ONLY);
  assert.ok(report?.note?.includes("embeddings are down"));
  assert.ok(
    report && report.indexedChunks > 0 && report.embeddedChunks === 0,
    "keyword rows still land",
  );
  const access = h.wiring.accessFor(MAIN_SESSION_KEY);
  assert.ok(access);
  const searched = await access.search({
    query: "frankfurt",
    signal: new AbortController().signal,
  });
  assert.equal(searched.mode, RETRIEVAL_MODE.KEYWORD_ONLY);
  assert.equal(resultsOf(searched).length, 1);
  h.close();
});

test("past-conversation results come from eligible conversations' History alone, never the asking one or a temporary thread", async (t) => {
  const h = await harness(t);
  await h.wiring.sync();
  await h.store.appendHistory(
    MAIN_SESSION_KEY,
    [
      {
        kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
        words: "we chose Tuesday deploys in main",
        recordedAt: NOW,
        eventId: "a",
      },
    ],
    NOW,
  );
  await h.store.appendHistory(
    h.thread,
    [
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
    NOW + 3,
  );
  await h.store.appendHistory(
    h.temporary,
    [
      {
        kind: CONVERSATION_ENTRY_KIND.REPLY,
        words: "tuesday secret in a temporary thread",
        recordedAt: NOW + 2,
        eventId: "c",
      },
    ],
    NOW + 2,
  );
  const fromMain = h.wiring.accessFor(MAIN_SESSION_KEY);
  assert.ok(fromMain);
  const mainHits = resultsOf(
    await fromMain.search({ query: "tuesday", signal: new AbortController().signal }),
  ).filter((hit) => hit.source === MEMORY_SOURCE.CONVERSATIONS);
  assert.deepEqual(
    mainHits.map((hit) => hit.path),
    [`conversation:${h.thread}`, `conversation:${h.thread}`],
    "two lines of one conversation are two results",
  );
  const fromThread = h.wiring.accessFor(h.thread);
  assert.ok(fromThread);
  const threadHits = resultsOf(
    await fromThread.search({ query: "tuesday", signal: new AbortController().signal }),
  ).filter((hit) => hit.source === MEMORY_SOURCE.CONVERSATIONS);
  assert.deepEqual(
    threadHits.map((hit) => hit.path),
    [`conversation:${MAIN_SESSION_KEY}`],
  );
  h.close();
});

test("a launch before any credential indexes keyword-only, and the first credentialed sync backfills the vectors without an edit", async (t) => {
  const embedding = adapter();
  let credential: EmbeddingAdapter | undefined;
  const h = await harness(t, { embeddingAdapter: () => credential });
  const first = await h.wiring.sync();
  assert.equal(first?.mode, RETRIEVAL_MODE.KEYWORD_ONLY);
  assert.equal(first?.embeddedChunks, 0);
  assert.equal((await h.store.memoryIndexStatus()).embeddedChunks, 0);
  credential = embedding;
  const second = await h.wiring.sync();
  assert.equal(second?.mode, RETRIEVAL_MODE.HYBRID);
  assert.ok(
    second && second.indexedFiles > 0,
    "unchanged files are planned again for their vectors",
  );
  const status = await h.store.memoryIndexStatus();
  assert.ok(status.embeddedChunks > 0 && status.embeddedChunks === status.chunks);
  const third = await h.wiring.sync();
  assert.equal(third?.indexedFiles, 0, "once every chunk has a vector the files are left alone");
  h.close();
});

test("a transient embedding failure leaves keyword rows searchable and the next sync retries the vectors", async (t) => {
  const embedding = adapter({ fail: true });
  const h = await harness(t, { embeddingAdapter: () => embedding });
  const failed = await h.wiring.sync();
  assert.equal(failed?.mode, RETRIEVAL_MODE.KEYWORD_ONLY);
  assert.equal((await h.store.memoryIndexStatus()).embeddedChunks, 0);
  const access = h.wiring.accessFor(MAIN_SESSION_KEY);
  assert.ok(access);
  assert.equal(
    resultsOf(await access.search({ query: "frankfurt", signal: new AbortController().signal }))
      .length,
    1,
    "the notebook stays searchable by keyword meanwhile",
  );
  // A pass that fails after another pass stored vectors keeps every one of them.
  embedding.fail = false;
  await h.wiring.sync();
  const before = (await h.store.memoryIndexStatus()).embeddedChunks;
  assert.ok(before > 0);
  fs.writeFileSync(
    path.join(h.root, "workspace", "memory", "note.md"),
    "# note\n\nEspresso thrice.\n",
  );
  embedding.fail = true;
  await h.wiring.sync();
  assert.equal(
    (await h.store.memoryIndexStatus()).embeddedChunks,
    before,
    "a failed pass wipes no vector an earlier pass stored",
  );
  embedding.fail = false;
  const retried = await h.wiring.sync();
  assert.equal(retried?.mode, RETRIEVAL_MODE.HYBRID);
  const status = await h.store.memoryIndexStatus();
  assert.ok(status.embeddedChunks > 0 && status.embeddedChunks === status.chunks);
  h.close();
});
