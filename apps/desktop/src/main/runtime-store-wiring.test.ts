import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import { freshBrainState } from "@sidecar/brain";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/realtime";
import {
  CONVERSATION_KIND,
  MAIN_SESSION_KEY,
  type SessionKey,
  sessionKey,
} from "@sidecar/runtime-contracts";
import { type RuntimeStorePort, serveRuntimeStore } from "@sidecar/runtime-store";
import { type ConversationDirectorySnapshot, wireRuntimeStore } from "./runtime-store-wiring";

/**
 * The store wiring over a real database served in-thread: temporary threads
 * live in this process alone and leave nothing for the next launch to find,
 * while durable threads and their lines do.
 */

const NOW = 1_800_000_000_000;

function wiring(root: string) {
  const changed: { sessionKey: SessionKey; entries: readonly ConversationEntry[] }[] = [];
  const directories: ConversationDirectorySnapshot[] = [];
  let ids = 0;
  let clock = NOW;
  const channel = new MessageChannel();
  const wired = wireRuntimeStore({
    persistent: true,
    createWorker: () => {
      // SAFETY: a MessagePort posts and receives structured-clone values on the same events the port contract names.
      serveRuntimeStore(channel.port2 as unknown as RuntimeStorePort);
      // SAFETY: as above, for the client's end of the same channel.
      return channel.port1 as unknown as RuntimeStorePort;
    },
    agentRoot: () => root,
    workspaceDirectory: () => path.join(root, "workspace"),
    ensureDirectory: (directory) => fs.mkdirSync(directory, { recursive: true }),
    now: () => clock,
    createEventId: () => `id-${++ids}`,
    onHistoryChanged: (sessionKey, entries) => {
      changed.push({ sessionKey, entries });
    },
    onDirectoryChanged: (directory) => {
      directories.push(directory);
    },
    report: () => undefined,
  });
  const close = async () => {
    await wired.client().close();
    channel.port1.close();
    channel.port2.close();
  };
  return {
    wired,
    changed,
    directories,
    close,
    tick: () => {
      clock += 1;
      return clock;
    },
  };
}

test("a temporary thread keeps its lines in memory alone and is gone at the next launch; a durable thread and its lines survive", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "luke-wiring-"));
  const first = wiring(root);
  await first.wired.open();
  await first.wired.restore();
  const temporary = await first.wired.createThread(true);
  const durable = await first.wired.createThread(false);
  assert.equal(temporary.temporary, true);
  assert.equal(temporary.kind, CONVERSATION_KIND.THREAD);
  assert.equal(durable.temporary, undefined);
  const line = { kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "only here" } as const;
  assert.equal(await first.wired.recordConversationEntry(line, NOW, temporary.sessionKey), true);
  assert.equal(
    await first.wired.recordConversationEntry(
      { ...line, words: "kept for good" },
      NOW,
      durable.sessionKey,
    ),
    true,
  );
  assert.equal(first.wired.thread(temporary.sessionKey).entries().length, 1);
  // Erasing a temporary thread's history is the same act as a durable one's
  // to the deletion flow: bounded by the instant, answering as published,
  // having nothing to publish. A line recorded after the press stays.
  const other = await first.wired.createThread(true);
  assert.equal(await first.wired.recordConversationEntry(line, NOW, other.sessionKey), true);
  first.wired.thread(other.sessionKey).fence(NOW);
  // The press was at NOW; a line the voice lands a beat later is the conversation's next line.
  const after = first.tick();
  assert.equal(
    await first.wired.recordConversationEntry({ ...line, words: "after" }, after, other.sessionKey),
    true,
  );
  assert.deepEqual(await first.wired.eraseHistory(other.sessionKey, NOW, undefined, undefined), {
    published: true,
  });
  assert.deepEqual(
    first.wired
      .thread(other.sessionKey)
      .entries()
      .map((entry) => entry.words),
    ["after"],
  );
  // Archiving preserves history, and a temporary thread has nowhere to keep
  // it: the ask is refused and the thread stands untouched, unarchived.
  assert.equal(await first.wired.archive(other.sessionKey), false);
  assert.equal(await first.wired.unarchive(other.sessionKey), false);
  assert.equal(first.wired.holds(other.sessionKey), true);
  assert.equal(first.wired.thread(other.sessionKey).entries().length, 1);
  // A temporary thread's envelope is answered from memory: nothing of it reaches the database.
  const memory = first.wired.brainStateRepository(temporary.sessionKey);
  assert.deepEqual(await memory.load(), {});
  assert.equal(await memory.save(freshBrainState("gen-temporary", NOW)), true);
  assert.equal((await memory.load()).state?.generationId, "gen-temporary");
  assert.deepEqual(
    first.wired
      .directory()
      .entries.map((entry) => entry.sessionKey)
      .toSorted(),
    [MAIN_SESSION_KEY, durable.sessionKey, temporary.sessionKey, other.sessionKey].toSorted(),
  );
  // A key the directory does not list takes no line.
  assert.equal(
    await first.wired.recordConversationEntry(line, NOW, sessionKey("agent:main:thread:nope")),
    false,
  );
  await first.close();
  const file = new DatabaseSync(path.join(root, "agent.sqlite"), { readOnly: true });
  // SAFETY: COUNT(*) is one integer column named `count`.
  const sessions = file
    .prepare("SELECT COUNT(*) AS count FROM conversation_sessions WHERE session_key = ?")
    .get(temporary.sessionKey) as { count: number };
  assert.equal(sessions.count, 0);
  file.close();

  const relaunched = wiring(root);
  await relaunched.wired.open();
  await relaunched.wired.restore();
  const keys = relaunched.wired.directory().entries.map((entry) => entry.sessionKey);
  assert.deepEqual(keys.toSorted(), [MAIN_SESSION_KEY, durable.sessionKey].toSorted());
  assert.equal(relaunched.wired.holds(temporary.sessionKey), false);
  assert.deepEqual(
    relaunched.wired
      .thread(durable.sessionKey)
      .entries()
      .map((entry) => entry.words),
    ["kept for good"],
  );
  // Archiving keeps the thread readable; the directory says so.
  assert.equal(await relaunched.wired.archive(durable.sessionKey), true);
  assert.equal(
    relaunched.wired.directory().entries.find((e) => e.sessionKey === durable.sessionKey)
      ?.archivedAt,
    NOW,
  );
  assert.equal(relaunched.wired.thread(durable.sessionKey).entries().length, 1);
  assert.equal(await relaunched.wired.archive(MAIN_SESSION_KEY), false);
  await relaunched.close();
  fs.rmSync(root, { recursive: true, force: true });
});
