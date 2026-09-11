import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MessageChannel } from "node:worker_threads";
import { type StorePort, serveStore } from "@sidecar/brain/store";
import {
  CONVERSATION_KIND,
  type ConversationRecord,
  MAIN_SESSION_KEY,
  type SessionKey,
  sessionKey,
  threadSessionKey,
} from "@sidecar/runtime/vocabulary";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/session";
import { test } from "vitest";
import { wireStore } from "./store-wiring.js";
import { temporaryDirectory } from "./testing/temporary-directory.js";

/**
 * The store wiring over a real database served in-thread: a conversation the
 * runtime lists, its lines, and its archived row survive the next launch,
 * and an erasure is bounded by the instant it was asked at.
 */

const NOW = 1_800_000_000_000;
const DURABLE = threadSessionKey("durable");
const OTHER = threadSessionKey("other");

function wiring(root: string) {
  const changed: { sessionKey: SessionKey; entries: readonly ConversationEntry[] }[] = [];
  const directories: (readonly ConversationRecord[])[] = [];
  let ids = 0;
  let clock = NOW;
  const channel = new MessageChannel();
  const wired = wireStore({
    persistent: true,
    createWorker: () => {
      // SAFETY: a MessagePort posts and receives structured-clone values on the same events the port contract names.
      serveStore(channel.port2 as unknown as StorePort);
      // SAFETY: as above, for the client's end of the same channel.
      return channel.port1 as unknown as StorePort;
    },
    agentRoot: () => root,
    workspaceDirectory: () => path.join(root, "workspace"),
    ensureDirectory: (directory) => fs.mkdirSync(directory, { recursive: true }),
    now: () => clock,
    createEventId: () => `id-${++ids}`,
    onConversationChanged: (sessionKey, entries) => {
      changed.push({ sessionKey, entries });
    },
    onDirectoryChanged: (entries) => {
      directories.push(entries);
    },
    report: () => undefined,
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
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

const LINE = { kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "kept for good" } as const;

test("a listed conversation and its lines survive the next launch; archiving keeps the thread readable and main cannot be archived", async (t) => {
  const root = await temporaryDirectory(t, "luke-wiring-");
  const first = wiring(root);
  t.onTestFinished(() => first.close());
  await first.wired.open();
  await first.wired.restore();
  const durable = await first.wired.ensureConversation(DURABLE, CONVERSATION_KIND.THREAD, "Thread");
  assert.equal(durable.kind, CONVERSATION_KIND.THREAD);
  assert.equal(await first.wired.recordConversationEntry(LINE, NOW, DURABLE), true);
  assert.deepEqual(
    first.wired
      .directory()
      .map((entry) => entry.sessionKey)
      .toSorted(),
    [MAIN_SESSION_KEY, DURABLE].toSorted(),
  );
  // A key the directory does not list takes no line.
  assert.equal(
    await first.wired.recordConversationEntry(LINE, NOW, sessionKey("agent:main:thread:nope")),
    false,
  );
  await first.close();

  const relaunched = wiring(root);
  t.onTestFinished(() => relaunched.close());
  await relaunched.wired.open();
  await relaunched.wired.restore();
  assert.deepEqual(
    relaunched.wired
      .thread(DURABLE)
      .entries()
      .map((entry) => entry.words),
    [LINE.words],
  );
  // Archiving keeps the thread readable; the directory says so.
  assert.equal(await relaunched.wired.archive(DURABLE), true);
  assert.equal(
    relaunched.wired.directory().find((entry) => entry.sessionKey === DURABLE)?.archivedAt,
    NOW,
  );
  assert.equal(relaunched.wired.thread(DURABLE).entries().length, 1);
  assert.equal(await relaunched.wired.archive(MAIN_SESSION_KEY), false);
  // Listing it again brings the archived row back, so its thread takes lines.
  await relaunched.wired.ensureConversation(DURABLE, CONVERSATION_KIND.THREAD, "Thread");
  assert.equal(
    relaunched.wired.directory().find((entry) => entry.sessionKey === DURABLE)?.archivedAt,
    undefined,
  );
});

test("an erasure takes what stood at the instant it was asked at; a line recorded after the press is the conversation's next line", async (t) => {
  const root = await temporaryDirectory(t, "luke-wiring-");
  const c = wiring(root);
  t.onTestFinished(() => c.close());
  await c.wired.open();
  await c.wired.restore();
  await c.wired.ensureConversation(OTHER, CONVERSATION_KIND.THREAD, "Thread");
  assert.equal(await c.wired.recordConversationEntry(LINE, NOW, OTHER), true);
  c.wired.thread(OTHER).fence(NOW);
  // The press was at NOW; a line the voice lands a beat later is the conversation's next line.
  const after = c.tick();
  assert.equal(
    await c.wired.recordConversationEntry({ ...LINE, words: "after" }, after, OTHER),
    true,
  );
  assert.equal(
    (await c.wired.eraseConversation(OTHER, NOW, undefined, undefined))?.published,
    true,
  );
  assert.deepEqual(
    c.wired
      .thread(OTHER)
      .entries()
      .map((entry) => entry.words),
    ["after"],
  );
});
