import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { MessageChannel, Worker } from "node:worker_threads";
import { BrainStateStore, brainStateRecord } from "@sidecar/brain";
import {
  DEFAULT_AGENT_ID,
  MAIN_CONVERSATION_NAME,
  MAIN_SESSION_KEY,
} from "@sidecar/runtime-contracts";
import { RuntimeStoreClient } from "./client.js";
import { RuntimeDatabase } from "./database.js";
import type { RuntimeStorePort } from "./protocol.js";
import { line, NOW, populatedState } from "./testing.js";
import { serveRuntimeStore } from "./worker-host.js";

function agentRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "luke-store-"));
  fs.mkdirSync(path.join(root, "agents", "main"), { recursive: true });
  return path.join(root, "agents", "main");
}

/** Both ends of a channel in one thread: the client on one port, the host on the other. */
function inThread() {
  const channel = new MessageChannel();
  // SAFETY: a MessagePort posts and receives structured-clone values on the same events the port contract names.
  const host = channel.port2 as unknown as RuntimeStorePort;
  serveRuntimeStore(host, { openDatabase: (location) => RuntimeDatabase.open(location) });
  // SAFETY: as above, for the client's end of the same channel.
  const client = new RuntimeStoreClient(channel.port1 as unknown as RuntimeStorePort);
  return {
    client,
    close: () => {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

test("the protocol answers every request once, opens with the import, and serves the brain store and the thread", async () => {
  const root = agentRoot();
  const legacyRoot = path.dirname(path.dirname(root));
  const legacy = {
    brainState: path.join(legacyRoot, "brain-state.json"),
    conversation: path.join(legacyRoot, "conversation.json"),
    personalFacts: path.join(legacyRoot, "memory.json"),
  };
  fs.writeFileSync(legacy.brainState, brainStateRecord(populatedState("gen-legacy", NOW - 1)));
  const { client, close } = inThread();
  const report = await client.open({
    agentRoot: root,
    agentId: DEFAULT_AGENT_ID,
    sessionKey: MAIN_SESSION_KEY,
    conversationName: MAIN_CONVERSATION_NAME,
    legacy,
    now: NOW,
  });
  assert.equal(report.brainState?.outcome, "imported");
  assert.equal(fs.existsSync(path.join(root, "agent.sqlite")), true);
  let ids = 0;
  const store = new BrainStateStore({
    repository: client.brainStateRepository(MAIN_SESSION_KEY),
    createGenerationId: () => `gen-${++ids}`,
    now: () => NOW,
  });
  const loaded = await store.load();
  assert.equal(loaded.generationId, "gen-legacy");
  const lease = store.lease();
  assert.equal(
    await store.write(lease, "gen-legacy", (state) => ({
      ...state,
      cursors: { codex: { s: "c" } },
    })),
    true,
  );
  const appended = await client.appendHistory(
    MAIN_SESSION_KEY,
    [line("hello", NOW, { eventId: "h" })],
    NOW,
  );
  assert.equal(appended.changed, true);
  assert.deepEqual(await client.listHistory(MAIN_SESSION_KEY, NOW), appended.entries);
  assert.equal(await client.replacePersonalFacts([{ id: "f", words: "w" }]), true);
  assert.deepEqual(await client.personalFacts(), [{ id: "f", words: "w" }]);
  assert.equal(await client.clearHistoryAtOrBefore(MAIN_SESSION_KEY, NOW), true);
  assert.deepEqual(await client.listHistory(MAIN_SESSION_KEY, NOW), []);
  assert.equal(await client.eraseRecovery(), true);
  assert.equal(fs.existsSync(path.join(root, "recovery")), false);
  assert.equal(await client.close(), true);
  // A request against a closed database is an error answer, not a hang.
  await assert.rejects(client.listHistory(MAIN_SESSION_KEY, NOW), /not open/);
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
  const port: RuntimeStorePort = {
    postMessage: () => undefined,
    on: (event, listener) => {
      if (event !== "exit") return;
      // SAFETY: the "exit" listener takes the code this test fires; the others are never called.
      exit = listener as (code: number) => void;
    },
  };
  const client = new RuntimeStoreClient(port);
  const pending = client.listHistory(MAIN_SESSION_KEY, NOW);
  exit?.(1);
  await assert.rejects(pending, /exited with code 1/);
  await assert.rejects(client.listHistory(MAIN_SESSION_KEY, NOW), /exited with code 1/);
  assert.match(client.failed()?.message ?? "", /exited/);
});

test("the real worker entry serves the same protocol on its own thread", async () => {
  const worker = new Worker(new URL("./worker-entry.ts", import.meta.url), {
    execArgv: ["--import", "tsx"],
  });
  // SAFETY: a Worker posts and receives structured-clone values on the same events the port contract names.
  const client = new RuntimeStoreClient(worker as unknown as RuntimeStorePort);
  try {
    const root = agentRoot();
    await client.open({
      agentRoot: root,
      agentId: DEFAULT_AGENT_ID,
      sessionKey: MAIN_SESSION_KEY,
      conversationName: MAIN_CONVERSATION_NAME,
      now: NOW,
    });
    const appended = await client.appendHistory(
      MAIN_SESSION_KEY,
      [line("hi", NOW, { eventId: "x" })],
      NOW,
    );
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
