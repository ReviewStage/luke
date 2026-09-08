import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationEntry } from "@sidecar/realtime";
import {
  CONVERSATION_KIND,
  type ConversationRecord,
  MAIN_SESSION_KEY,
  RESTORE_OUTCOME,
  type SessionKey,
  threadSessionKey,
} from "@sidecar/runtime-contracts";
import { CONVERSATION_DELETE_OUTCOME } from "#shared/wire/conversation";
import { VOICE_COMMAND } from "#shared/wire/voice-view";
import {
  type ConversationOperationsDependencies,
  conversationOperations,
  HISTORY_MAINTENANCE_INTERVAL_MS,
  startHistoryMaintenance,
} from "./conversation-operations";

const NOW = 1_800_000_000_000;
const THREAD = threadSessionKey("t-1");

function harness(erasePublished = true) {
  const calls: string[] = [];
  const record = (sessionKey: SessionKey): ConversationRecord => ({
    sessionKey,
    kind: CONVERSATION_KIND.THREAD,
    name: "Thread 1",
    createdAt: NOW,
    lastActivityAt: NOW,
  });
  const entries: readonly ConversationEntry[] = [];
  const dependencies: ConversationOperationsDependencies = {
    store: {
      directory: () => ({ entries: [record(THREAD)], archives: [] }),
      holds: (sessionKey) => sessionKey === THREAD || sessionKey === MAIN_SESSION_KEY,
      // SAFETY: the operations reach the thread for its lines and its fence alone.
      thread: (sessionKey) =>
        ({
          entries: () => entries,
          fence: (deletedAt: number) => {
            calls.push(`fence:${sessionKey}:${deletedAt}`);
          },
        }) as unknown as ReturnType<ConversationOperationsDependencies["store"]["thread"]>,
      createThread: async (temporary) => {
        calls.push(`create:${temporary}`);
        return record(THREAD);
      },
      archive: async (sessionKey) => {
        calls.push(`archive:${sessionKey}`);
        return true;
      },
      unarchive: async (sessionKey) => {
        calls.push(`unarchive:${sessionKey}`);
        return true;
      },
      eraseHistory: async (sessionKey, now) => {
        calls.push(`erase:${sessionKey}:${now}`);
        return { published: erasePublished };
      },
      restoreArchive: async (archiveId) => {
        calls.push(`restore:${archiveId}`);
        return RESTORE_OUTCOME.RESTORED;
      },
    },
    brain: {
      openConversation: async (sessionKey) => {
        calls.push(`open:${sessionKey}`);
      },
      closeConversation: async (sessionKey) => {
        calls.push(`close:${sessionKey}`);
      },
      resetConversation: async (sessionKey) => {
        calls.push(`reset:${sessionKey}`);
        return true;
      },
    },
    retireVoiceTurns: (command) => {
      calls.push(`voice:${command}`);
    },
    now: () => NOW,
    report: (message) => {
      calls.push(`report:${message}`);
    },
  };
  return { operations: conversationOperations(dependencies), calls };
}

test("a new thread opens a brain over it, and archiving retires the brain first; main cannot be archived", async () => {
  const { operations, calls } = harness();
  assert.equal(await operations.createThread(false), THREAD);
  assert.equal(await operations.archive(THREAD), true);
  assert.equal(await operations.archive(MAIN_SESSION_KEY), false);
  assert.equal(await operations.unarchive(THREAD), true);
  assert.deepEqual(calls, [
    "create:false",
    `open:${THREAD}`,
    `close:${THREAD}`,
    `archive:${THREAD}`,
    `unarchive:${THREAD}`,
    `open:${THREAD}`,
  ]);
});

test("Start fresh retires main's turns in the voice window and no other conversation's", async () => {
  const { operations, calls } = harness();
  assert.equal(await operations.startFresh(THREAD), true);
  assert.equal(await operations.startFresh(MAIN_SESSION_KEY), true);
  assert.deepEqual(calls, [
    `reset:${THREAD}`,
    `reset:${MAIN_SESSION_KEY}`,
    `voice:${VOICE_COMMAND.RETIRE_TURNS}`,
  ]);
});

test("Delete history fences, retires the brain, erases, and rebuilds, in that order, telling the voice window about main alone", async () => {
  const { operations, calls } = harness();
  assert.equal(await operations.deleteHistory(THREAD), CONVERSATION_DELETE_OUTCOME.COMPLETE);
  assert.deepEqual(calls, [
    `fence:${THREAD}:${NOW}`,
    `close:${THREAD}`,
    `erase:${THREAD}:${NOW}`,
    `open:${THREAD}`,
  ]);
  calls.length = 0;
  assert.equal(
    await operations.deleteHistory(MAIN_SESSION_KEY),
    CONVERSATION_DELETE_OUTCOME.COMPLETE,
  );
  assert.deepEqual(calls.slice(0, 2), [
    `fence:${MAIN_SESSION_KEY}:${NOW}`,
    `voice:${VOICE_COMMAND.CLEAR_CONVERSATION}`,
  ]);
  const unpublished = harness(false);
  assert.equal(
    await unpublished.operations.deleteHistory(THREAD),
    CONVERSATION_DELETE_OUTCOME.INCOMPLETE,
  );
  assert.ok(unpublished.calls.some((call) => call.startsWith("report:Delete history incomplete")));
});

test("maintenance runs at once and then on its clock, preserving the busy conversations, until stopped", () => {
  const runs: (readonly SessionKey[])[] = [];
  let scheduled: { work: () => void; ms: number } | undefined;
  const handle = setTimeout(() => undefined, 0);
  let cleared = 0;
  const stop = startHistoryMaintenance({
    store: {
      runMaintenance: async (preserve) => {
        runs.push(preserve);
        return undefined;
      },
    },
    brain: { busyConversations: () => [THREAD] },
    timers: {
      setInterval: (work, ms) => {
        scheduled = { work, ms };
        return handle;
      },
      clearInterval: (timer) => {
        assert.equal(timer, handle);
        cleared += 1;
      },
    },
  });
  assert.deepEqual(runs, [[THREAD]]);
  assert.equal(scheduled?.ms, HISTORY_MAINTENANCE_INTERVAL_MS);
  scheduled?.work();
  assert.equal(runs.length, 2);
  stop();
  assert.equal(cleared, 1);
});
