import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import {
  DEFAULT_AGENT_ID,
  MAIN_CONVERSATION_NAME,
  MAIN_SESSION_KEY,
} from "@sidecar/runtime/vocabulary";
import { test } from "vitest";
import { BrainStateStore } from "../state-store.js";
import { StoreWorkerGone, storeClient, workerStoreTransport } from "./store-client.js";
import type { StoreOpenOptions } from "./store-operations.js";
import { line, NOW, populatedState } from "./testing.js";
import { inProcessStoreTransport } from "./worker-host.js";

function agentRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "luke-store-"));
  fs.mkdirSync(path.join(root, "agents", "main"), { recursive: true });
  return path.join(root, "agents", "main");
}

function openOptions(root: string): StoreOpenOptions {
  return {
    agentRoot: root,
    agentId: DEFAULT_AGENT_ID,
    sessionKey: MAIN_SESSION_KEY,
    conversationName: MAIN_CONVERSATION_NAME,
    now: NOW,
  };
}

/** The tag a rejected ask carries, or nothing where the rejection is not a tagged failure. */
async function rejectedTag(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof Error && "_tag" in error ? String(error._tag) : undefined;
  }
}

/** The rejection of an ask as the failure it is, or nothing where it settled or failed some other way. */
async function rejectedWith<Failure extends Error>(
  promise: Promise<unknown>,
  kind: new (...args: never[]) => Failure,
): Promise<Failure | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof kind ? error : undefined;
  }
}

/** The client over the real worker entry, on its own thread. */
function overWorker() {
  let spawned: Worker | undefined;
  const client = storeClient(
    workerStoreTransport(() => {
      spawned = new Worker(new URL("./worker-entry.ts", import.meta.url), {
        execArgv: ["--import", "tsx"],
      });
      return spawned;
    }),
  );
  return { client, worker: () => spawned };
}

test("the group answers every request once and serves the brain store, the thread, the notebook, and the index", async () => {
  const root = agentRoot();
  const client = storeClient(inProcessStoreTransport());
  assert.equal(await client.open(openOptions(root)), true);
  assert.equal(fs.existsSync(path.join(root, "agent.sqlite")), true);
  let ids = 0;
  const store = new BrainStateStore({
    repository: client.brainStateRepository(MAIN_SESSION_KEY),
    createGenerationId: () => `gen-${++ids}`,
    now: () => NOW,
  });
  const loaded = await store.load();
  assert.equal(loaded.generationId, "gen-1");
  const lease = store.lease();
  assert.equal(
    await store.write(lease, "gen-1", (state) => ({
      ...state,
      cursors: { codex: { s: "c" } },
    })),
    true,
  );
  const appended = await client.ask("conversation.append", {
    sessionKey: MAIN_SESSION_KEY,
    entries: [line("hello", NOW, { eventId: "h" })],
    now: NOW,
  });
  assert.equal(appended.changed, true);
  assert.deepEqual(
    await client.ask("conversation.list", { sessionKey: MAIN_SESSION_KEY, now: NOW }),
    appended.entries,
  );
  const remembered = await client.ask("notebook.remember", { id: "f", words: "w", now: NOW });
  assert.equal(remembered.ok, true);
  assert.deepEqual(
    (await client.ask("notebook.list", { now: NOW })).map((entry) => [entry.id, entry.words]),
    [["f", "w"]],
  );
  assert.equal(fs.existsSync(path.join(root, "workspace", "USER.md")), true);
  const plan = await client.ask("memory.plan-sync", { now: NOW });
  assert.deepEqual(
    plan.changed.map((file) => file.path),
    ["USER.md"],
  );
  await client.ask("memory.apply-sync", {
    changed: plan.changed,
    removed: plan.removed,
    embeddings: [],
    now: NOW,
  });
  assert.equal((await client.ask("memory.search", { query: "w", now: NOW })).results.length, 1);
  assert.equal(
    (await client.ask("memory.get", { path: "USER.md", from: 1, lines: 1 }))?.text,
    "# USER.md",
  );
  assert.deepEqual(
    await client.ask("conversation.search", {
      sessionKeys: [MAIN_SESSION_KEY],
      query: "hello",
      limit: 5,
      now: NOW,
    }),
    [{ sessionKey: MAIN_SESSION_KEY, entry: appended.entries[0] }],
  );
  const deleted = await client.ask("conversations.delete", {
    sessionKey: MAIN_SESSION_KEY,
    now: NOW,
  });
  assert.equal(deleted?.published, true);
  assert.deepEqual(
    await client.ask("conversation.list", { sessionKey: MAIN_SESSION_KEY, now: NOW }),
    [],
  );
  assert.equal(await client.close(), true);
  // A request against a closed client is a typed refusal, not a hang.
  assert.equal(
    await rejectedTag(client.ask("conversation.list", { sessionKey: MAIN_SESSION_KEY, now: NOW })),
    "StoreNotOpen",
  );
});

test("a request before any open is refused, and an open at a schema this build cannot reach names the version", async () => {
  const client = storeClient(inProcessStoreTransport());
  assert.equal(await rejectedTag(client.ask("conversations.list", {})), "StoreNotOpen");
  const root = agentRoot();
  const raw = new DatabaseSync(path.join(root, "agent.sqlite"));
  raw.exec("CREATE TABLE schema_version (version INTEGER NOT NULL)");
  raw.exec("INSERT INTO schema_version (version) VALUES (99)");
  raw.close();
  const refused = client.open(openOptions(root));
  assert.equal(await rejectedTag(refused), "StoreSchemaRefused");
  // The worker stayed up but holds no store, so an operation is the worker's own refusal.
  assert.equal(await rejectedTag(client.ask("conversations.list", {})), "StoreOperationFailed");
  await client.close();
});

test("two handles over the boundary: a stale checkpoint cannot replace the newer generation", async () => {
  const root = agentRoot();
  const client = storeClient(inProcessStoreTransport());
  await client.open(openOptions(root));
  const first = client.brainStateRepository(MAIN_SESSION_KEY);
  const second = client.brainStateRepository(MAIN_SESSION_KEY);
  const gen1 = populatedState("gen-1");
  assert.equal(await first.save(gen1), true);
  await second.load();
  const gen2 = populatedState("gen-2", NOW + 1);
  assert.equal(await second.save(gen2), true);
  assert.equal(await first.save({ ...gen1, cursors: {} }), false);
  assert.equal(await first.save(populatedState("gen-3", NOW + 2)), false);
  assert.deepEqual((await second.load()).state, gen2);
  await client.close();
});

test("asks fired without awaiting land in the order they were made", async () => {
  const root = agentRoot();
  const client = storeClient(inProcessStoreTransport());
  await client.open(openOptions(root));
  const eventIds = Array.from({ length: 24 }, (_, index) => `event-${index}`);
  const appends = eventIds.map((eventId) =>
    client.ask("conversation.append", {
      sessionKey: MAIN_SESSION_KEY,
      entries: [line("w", NOW, { eventId })],
      now: NOW,
    }),
  );
  const listed = client.ask("conversation.list", { sessionKey: MAIN_SESSION_KEY, now: NOW });
  await Promise.all(appends);
  assert.deepEqual(
    (await listed).map((entry) => entry.eventId),
    eventIds,
  );
  await client.close();
});

test("a worker that dies before it is ready fails the open typed and refuses every later ask", async () => {
  const client = storeClient(
    workerStoreTransport(() => new Worker("process.exit(3)", { eval: true })),
  );
  const opened = client.open(openOptions(agentRoot()));
  assert.equal((await rejectedWith(opened, StoreWorkerGone))?.code, 3);
  assert.equal(
    await rejectedTag(client.ask("conversation.list", { sessionKey: MAIN_SESSION_KEY, now: NOW })),
    "StoreWorkerGone",
  );
  assert.equal(await client.close(), true);
});

test("a worker that dies with a request in flight settles it as a failure, not a hang", async () => {
  const { client, worker } = overWorker();
  const root = agentRoot();
  await client.open(openOptions(root));
  const pending = client.ask("maintenance.run", { now: NOW, preserve: [] });
  await worker()?.terminate();
  const tag = await rejectedTag(pending);
  assert.equal(["StoreWorkerGone", "RpcClientError"].includes(tag ?? ""), true);
  assert.equal(await rejectedTag(client.ask("conversations.list", {})), "StoreWorkerGone");
});

test("the real worker entry serves the same group on its own thread and ends with the close", async () => {
  const { client, worker } = overWorker();
  const root = agentRoot();
  await client.open(openOptions(root));
  const appended = await client.ask("conversation.append", {
    sessionKey: MAIN_SESSION_KEY,
    entries: [line("hi", NOW, { eventId: "x" })],
    now: NOW,
  });
  assert.equal(appended.entries.length, 1);
  const exited = new Promise<number>((resolve) => worker()?.once("exit", resolve));
  assert.equal(await client.close(), true);
  assert.equal(await exited, 0);
});

test("over the worker boundary an unreadable generation keeps its compare token, so the repair lands and a stale save does not", async () => {
  const root = agentRoot();
  const client = storeClient(inProcessStoreTransport());
  await client.open(openOptions(root));
  const stale = client.brainStateRepository(MAIN_SESSION_KEY);
  await stale.load();
  assert.equal(await stale.save(populatedState("gen-old")), true);
  const raw = new DatabaseSync(path.join(root, "agent.sqlite"));
  raw.prepare("UPDATE runtime_checkpoints SET item = '{not json' WHERE sequence = 0").run();
  raw.close();
  let ids = 0;
  const store = new BrainStateStore({
    repository: client.brainStateRepository(MAIN_SESSION_KEY),
    createGenerationId: () => `repaired-${++ids}`,
    now: () => NOW,
    report: () => undefined,
  });
  const fresh = await store.load();
  await store.flush();
  assert.equal(fresh.generationId, "repaired-1");
  assert.equal(
    await store.write(store.lease(), "repaired-1", (state) => ({
      ...state,
      cursors: { codex: { s: "c" } },
    })),
    true,
  );
  assert.equal(await stale.save({ ...populatedState("gen-old"), cursors: {} }), false);
  const reader = client.brainStateRepository(MAIN_SESSION_KEY);
  assert.deepEqual((await reader.load()).state?.cursors, { codex: { s: "c" } });
  await client.close();
});
