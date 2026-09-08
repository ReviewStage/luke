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
import { CONVERSATION_DELETE_OUTCOME } from "./brain/conversation-deletion";
import {
  type ConversationOperationsDependencies,
  conversationOperations,
  HISTORY_MAINTENANCE_INTERVAL_MS,
  startHistoryMaintenance,
} from "./conversation-operations";

const NOW = 1_800_000_000_000;
const THREAD = threadSessionKey("t-1");
/** The cutoff an earlier Clear left, which the deletion's archive must record as the one before its own. */
const EARLIER_CUTOFF = NOW - 5;

function harness(
  erasePublished = true,
  { archives = true, marks = true, readsCutoff = true } = {},
) {
  const calls: string[] = [];
  let generation = "gen-1";
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
        return archives;
      },
      unarchive: async (sessionKey) => {
        calls.push(`unarchive:${sessionKey}`);
        return true;
      },
      historyCutoff: async (sessionKey) => {
        calls.push(`cutoff:${sessionKey}`);
        return readsCutoff ? { value: EARLIER_CUTOFF } : undefined;
      },
      eraseHistory: async (sessionKey, now, keepSessionId, cutoffBefore) => {
        calls.push(`erase:${sessionKey}:${now}:${keepSessionId}:${cutoffBefore}`);
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
      // SAFETY: the deletion reaches the store for its synchronous fence and the successor's id alone.
      store: (sessionKey) =>
        ({
          clear: async (deletedAt: number) => {
            calls.push(`clear:${sessionKey}:${deletedAt}`);
            generation = "gen-2";
            return marks;
          },
          generationId: () => generation,
        }) as unknown as ReturnType<ConversationOperationsDependencies["brain"]["store"]>,
    },
    now: () => NOW,
    report: (message) => {
      calls.push(`report:${message}`);
    },
  };
  return { operations: conversationOperations(dependencies), calls };
}

test("a new thread opens a brain over it, and archiving retires the brain only once the store archived; main cannot be archived", async () => {
  const { operations, calls } = harness();
  assert.equal(await operations.createThread(false), THREAD);
  assert.equal(await operations.archive(THREAD), true);
  assert.equal(await operations.archive(MAIN_SESSION_KEY), false);
  assert.equal(await operations.unarchive(THREAD), true);
  assert.deepEqual(calls, [
    "create:false",
    `open:${THREAD}`,
    `archive:${THREAD}`,
    `close:${THREAD}`,
    `unarchive:${THREAD}`,
    `open:${THREAD}`,
  ]);
});

test("an archive the store refuses leaves the thread's brain standing: an active record is never left with nothing to answer it", async () => {
  const { operations, calls } = harness(true, { archives: false });
  assert.equal(await operations.archive(THREAD), false);
  assert.deepEqual(calls, [`archive:${THREAD}`]);
});

test("Start fresh replaces a conversation's lifetime and tells the voice window nothing: no history was erased", async () => {
  const { operations, calls } = harness();
  assert.equal(await operations.startFresh(THREAD), true);
  assert.equal(await operations.startFresh(MAIN_SESSION_KEY), true);
  assert.deepEqual(calls, [`reset:${THREAD}`, `reset:${MAIN_SESSION_KEY}`]);
});

test("Delete history fences the thread and the brain's generation, then erases what stood at or before the press while the successor lifetime stands; nothing is retired or reopened", async () => {
  const { operations, calls } = harness();
  assert.equal(await operations.deleteHistory(THREAD), CONVERSATION_DELETE_OUTCOME.COMPLETE);
  assert.deepEqual(calls, [
    `fence:${THREAD}:${NOW}`,
    `cutoff:${THREAD}`,
    `clear:${THREAD}:${NOW}`,
    `erase:${THREAD}:${NOW}:gen-2:${EARLIER_CUTOFF}`,
  ]);
  const unpublished = harness(false);
  assert.equal(
    await unpublished.operations.deleteHistory(THREAD),
    CONVERSATION_DELETE_OUTCOME.INCOMPLETE,
  );
  assert.ok(unpublished.calls.some((call) => call.startsWith("report:Delete history incomplete")));
});

test("a marker the store will not write refuses the deletion with the fences standing and nothing erased", async () => {
  const { operations, calls } = harness(true, { marks: false });
  assert.equal(await operations.deleteHistory(THREAD), CONVERSATION_DELETE_OUTCOME.REFUSED);
  assert.deepEqual(
    calls.filter((call) => !call.startsWith("report:")),
    [`fence:${THREAD}:${NOW}`, `cutoff:${THREAD}`, `clear:${THREAD}:${NOW}`],
  );
  assert.ok(calls.some((call) => call.includes("could not be marked erased")));
});

test("a cutoff the store cannot read refuses the deletion after the marker, with nothing erased: an archive never records a guessed cutoff", async () => {
  const { operations, calls } = harness(true, { readsCutoff: false });
  assert.equal(await operations.deleteHistory(THREAD), CONVERSATION_DELETE_OUTCOME.REFUSED);
  assert.deepEqual(
    calls.filter((call) => !call.startsWith("report:")),
    [`fence:${THREAD}:${NOW}`, `cutoff:${THREAD}`, `clear:${THREAD}:${NOW}`],
  );
  assert.ok(calls.some((call) => call.includes("earlier cutoff could not be read")));
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
