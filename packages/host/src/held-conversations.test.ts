import assert from "node:assert/strict";
import {
  ARCHIVE_REASON,
  CONVERSATION_KIND,
  MAIN_SESSION_KEY,
  sessionKey,
  threadSessionKey,
} from "@sidecar/runtime/vocabulary";
import { test } from "vitest";
import { wireHeldConversations } from "./held-conversations.js";

const NOW = 1_800_000_000_000;
const OPENED = threadSessionKey("opened");

function wiring() {
  let clock = NOW;
  const held = wireHeldConversations({ now: () => clock });
  return {
    held,
    tick: () => {
      clock += 1;
      return clock;
    },
  };
}

test("main is listed from the start, and a conversation the brain opens is listed as this run's", async () => {
  const { held } = wiring();
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
  assert.equal(held.holds(sessionKey("agent:main:thread:nope")), false);
});

test("archiving retires a listed record; main is never archived; listing an archived record brings it back", async () => {
  const { held, tick } = wiring();
  await held.ensureConversation(OPENED, CONVERSATION_KIND.CHILD, "Child");
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
