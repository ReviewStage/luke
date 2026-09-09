import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { MessageChannel, Worker } from "node:worker_threads";
import {
  DEFAULT_AGENT_ID,
  MAIN_CONVERSATION_NAME,
  MAIN_SESSION_KEY,
} from "@sidecar/runtime/vocabulary";
import { BrainStateStore } from "../state-store.js";
import { storeClient } from "./store-client.js";
import { line, NOW, populatedState } from "./testing.js";
import type { StorePort } from "./wire.js";
import { serveStore } from "./worker-host.js";

function agentRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "luke-store-"));
  fs.mkdirSync(path.join(root, "agents", "main"), { recursive: true });
  return path.join(root, "agents", "main");
}

/** Both ends of a channel in one thread: the client on one port, the host on the other. */
function inThread() {
  const channel = new MessageChannel();
  // SAFETY: a MessagePort posts and receives structured-clone values on the same events the port contract names.
  const host = channel.port2 as unknown as StorePort;
  serveStore(host);
  // SAFETY: as above, for the client's end of the same channel.
  const client = storeClient(channel.port1 as unknown as StorePort);
  return {
    client,
    close: () => {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

test("the protocol answers every request once and serves the brain store, the thread, the notebook, and the index", async () => {
  const root = agentRoot();
  const { client, close } = inThread();
  const report = await client.open({
    agentRoot: root,
    agentId: DEFAULT_AGENT_ID,
    sessionKey: MAIN_SESSION_KEY,
    conversationName: MAIN_CONVERSATION_NAME,
    now: NOW,
  });
  assert.equal(report, true);
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
  const appended = await client.ask("history.append", {
    sessionKey: MAIN_SESSION_KEY,
    entries: [line("hello", NOW, { eventId: "h" })],
    now: NOW,
  });
  assert.equal(appended.changed, true);
  assert.deepEqual(
    await client.ask("history.list", { sessionKey: MAIN_SESSION_KEY, now: NOW }),
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
    await client.ask("history.search", {
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
    await client.ask("history.list", { sessionKey: MAIN_SESSION_KEY, now: NOW }),
    [],
  );
  assert.equal(await client.close(), true);
  // A request against a closed database is an error answer, not a hang.
  await assert.rejects(
    client.ask("history.list", { sessionKey: MAIN_SESSION_KEY, now: NOW }),
    /not open/,
  );
  close();
});

test("two handles over the boundary: a stale checkpoint cannot replace the newer generation", async () => {
  const root = agentRoot();
  const { client, close } = inThread();
  await client.open({
    agentRoot: root,
    agentId: DEFAULT_AGENT_ID,
    sessionKey: MAIN_SESSION_KEY,
    conversationName: MAIN_CONVERSATION_NAME,
    now: NOW,
  });
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
  close();
});

test("a worker that dies settles every pending request as rejected and refuses later ones", async () => {
  let exit: ((code: number) => void) | undefined;
  const port: StorePort = {
    postMessage: () => undefined,
    on: (event, listener) => {
      if (event !== "exit") return;
      // SAFETY: the "exit" listener takes the code this test fires; the others are never called.
      exit = listener as (code: number) => void;
    },
  };
  const client = storeClient(port);
  const pending = client.ask("history.list", { sessionKey: MAIN_SESSION_KEY, now: NOW });
  exit?.(1);
  await assert.rejects(pending, /exited with code 1/);
  await assert.rejects(
    client.ask("history.list", { sessionKey: MAIN_SESSION_KEY, now: NOW }),
    /exited with code 1/,
  );
});

test("the real worker entry serves the same protocol on its own thread", async () => {
  const worker = new Worker(new URL("./worker-entry.ts", import.meta.url), {
    execArgv: ["--import", "tsx"],
  });
  // SAFETY: a Worker posts and receives structured-clone values on the same events the port contract names.
  const client = storeClient(worker as unknown as StorePort);
  try {
    const root = agentRoot();
    await client.open({
      agentRoot: root,
      agentId: DEFAULT_AGENT_ID,
      sessionKey: MAIN_SESSION_KEY,
      conversationName: MAIN_CONVERSATION_NAME,
      now: NOW,
    });
    const appended = await client.ask("history.append", {
      sessionKey: MAIN_SESSION_KEY,
      entries: [line("hi", NOW, { eventId: "x" })],
      now: NOW,
    });
    assert.equal(appended.entries.length, 1);
    await client.close();
  } finally {
    await worker.terminate();
  }
});

test("over the worker boundary an unreadable generation keeps its compare token, so the repair lands and a stale save does not", async () => {
  const root = agentRoot();
  const { client, close } = inThread();
  await client.open({
    agentRoot: root,
    agentId: DEFAULT_AGENT_ID,
    sessionKey: MAIN_SESSION_KEY,
    conversationName: MAIN_CONVERSATION_NAME,
    now: NOW,
  });
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
  close();
});
