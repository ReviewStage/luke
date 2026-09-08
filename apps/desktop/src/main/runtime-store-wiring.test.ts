import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/realtime";
import { CONVERSATION_KIND, MAIN_SESSION_KEY, type SessionKey } from "@sidecar/runtime-contracts";
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
    ensureDirectory: (directory) => fs.mkdirSync(directory, { recursive: true }),
    now: () => NOW,
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
  return { wired, changed, directories, close };
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
  assert.deepEqual(
    first.wired
      .directory()
      .entries.map((entry) => entry.sessionKey)
      .toSorted(),
    [MAIN_SESSION_KEY, durable.sessionKey, temporary.sessionKey].toSorted(),
  );
  // A key the directory does not list takes no line.
  assert.equal(
    await first.wired.recordConversationEntry(line, NOW, "agent:main:thread:nope" as SessionKey),
    false,
  );
  await first.close();

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
