import assert from "node:assert/strict";
import {
  ARCHIVE_REASON,
  CONVERSATION_KIND,
  MAIN_SESSION_KEY,
  type SessionKey,
  sessionKey,
  threadSessionKey,
} from "@sidecar/runtime/vocabulary";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/session";
import { test } from "vitest";
import { wireHeldConversations } from "./held-conversations.js";

const NOW = 1_800_000_000_000;
const OPENED = threadSessionKey("opened");
const LINE = { kind: CONVERSATION_ENTRY_KIND.ASK, words: "kept for the run" } as const;

function wiring() {
  const changed: { sessionKey: SessionKey; entries: readonly ConversationEntry[] }[] = [];
  let ids = 0;
  let clock = NOW;
  const held = wireHeldConversations({
    now: () => clock,
    createEventId: () => `id-${++ids}`,
    onConversationChanged: (sessionKey, entries) => {
      changed.push({ sessionKey, entries });
    },
    report: () => undefined,
  });
  return {
    held,
    changed,
    tick: () => {
      clock += 1;
      return clock;
    },
  };
}

test("main is listed from the start; a conversation the brain opens is listed as this run's, takes lines, and a key not listed takes none", async () => {
  const { held, changed } = wiring();
  assert.deepEqual(
    held.directory().map((record) => record.sessionKey),
    [MAIN_SESSION_KEY],
  );
  assert.equal(held.isTemporary(MAIN_SESSION_KEY), false);
  const opened = await held.ensureConversation(OPENED, CONVERSATION_KIND.THREAD, "Thread");
  assert.deepEqual(opened, {
    sessionKey: OPENED,
    kind: CONVERSATION_KIND.THREAD,
    name: "Thread",
    createdAt: NOW,
    lastActivityAt: NOW,
    temporary: true,
  });
  assert.equal(held.isTemporary(OPENED), true);
  assert.equal(held.holds(OPENED), true);
  assert.equal(await held.recordConversationEntry(LINE, NOW, OPENED), true);
  assert.deepEqual(held.thread(OPENED).entries(), [{ ...LINE, eventId: "id-1", recordedAt: NOW }]);
  assert.deepEqual(changed, [{ sessionKey: OPENED, entries: held.thread(OPENED).entries() }]);
  assert.equal(
    await held.recordConversationEntry(LINE, NOW, sessionKey("agent:main:thread:nope")),
    false,
  );
  assert.equal(await held.recordConversationEntry(LINE, NOW), true);
  assert.equal(held.thread().entries().length, 1);
});

test("archiving retires a listed record and keeps its thread; main is never archived; listing an archived record brings it back", async () => {
  const { held, tick } = wiring();
  await held.ensureConversation(OPENED, CONVERSATION_KIND.CHILD, "Child");
  await held.recordConversationEntry(LINE, NOW, OPENED);
  const archivedAt = tick();
  assert.equal(await held.archive(OPENED), true);
  assert.deepEqual(
    held.directory().find((record) => record.sessionKey === OPENED),
    {
      sessionKey: OPENED,
      kind: CONVERSATION_KIND.CHILD,
      name: "Child",
      createdAt: NOW,
      lastActivityAt: NOW,
      temporary: true,
      archivedAt,
      archiveReason: ARCHIVE_REASON.USER,
    },
  );
  assert.equal(held.thread(OPENED).entries().length, 1);
  assert.equal(await held.archive(OPENED), false, "an archived record is not archived twice");
  assert.equal(await held.archive(MAIN_SESSION_KEY), false);
  assert.equal(await held.archive(threadSessionKey("never-opened")), false);
  const relisted = tick();
  const back = await held.ensureConversation(OPENED, CONVERSATION_KIND.CHILD, "Renamed");
  assert.deepEqual(back, {
    sessionKey: OPENED,
    kind: CONVERSATION_KIND.CHILD,
    name: "Child",
    createdAt: NOW,
    lastActivityAt: relisted,
    temporary: true,
  });
});

test("an erasure takes the lines recorded at or before the instant and leaves a later line as the conversation's next", async () => {
  const { held, tick } = wiring();
  await held.ensureConversation(OPENED, CONVERSATION_KIND.THREAD, "Thread");
  assert.equal(await held.recordConversationEntry(LINE, NOW, OPENED), true);
  held.thread(OPENED).fence(NOW);
  const after = tick();
  assert.equal(
    await held.recordConversationEntry({ ...LINE, words: "after" }, after, OPENED),
    true,
  );
  held.erase(OPENED, NOW);
  assert.deepEqual(
    held
      .thread(OPENED)
      .entries()
      .map((entry) => entry.words),
    ["after"],
  );
  // Erasing a conversation with no thread yet is nothing to do, not a failure.
  held.erase(threadSessionKey("never-opened"), NOW);
});

test("each conversation's envelope is one repository for the run, held across saves and shared between the brains built over it", () => {
  const { held } = wiring();
  const repository = held.brainStateRepository(OPENED);
  assert.equal(held.brainStateRepository(OPENED), repository);
  assert.notEqual(held.brainStateRepository(), repository);
  assert.deepEqual(repository.load(), {});
  // SAFETY: the repository keeps what it is handed and hands it back; the envelope's shape is the brain's to read.
  const state = { generationId: "gen-1" } as unknown as Parameters<typeof repository.save>[0];
  assert.equal(repository.save(state), true);
  assert.deepEqual(repository.load(), { state });
  assert.deepEqual(held.brainStateRepository().load(), {});
});
