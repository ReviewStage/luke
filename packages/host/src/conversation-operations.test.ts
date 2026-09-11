import assert from "node:assert/strict";
import {
  CONVERSATION_KIND,
  type ConversationRecord,
  MAIN_SESSION_KEY,
  type SessionKey,
  threadSessionKey,
} from "@sidecar/runtime/vocabulary";
import type { ConversationEntry } from "@sidecar/session";
import { test } from "vitest";
import { CONVERSATION_DELETE_OUTCOME } from "./brain/conversation-deletion.js";
import {
  type ConversationOperationsDependencies,
  conversationOperations,
  startConversationMaintenance,
} from "./conversation-operations.js";

const NOW = 1_800_000_000_000;
const THREAD = threadSessionKey("t-1");
/** The cutoff an earlier Clear left, which the deletion's archive must record as the one before its own. */
const EARLIER_CUTOFF = NOW - 5;

function harness(erasePublished = true, { marks = true, readsCutoff = true } = {}) {
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
      directory: () => [record(THREAD)],
      holds: (sessionKey) => sessionKey === THREAD || sessionKey === MAIN_SESSION_KEY,
      // SAFETY: the operations reach the thread for its lines and its fence alone.
      thread: (sessionKey) =>
        ({
          entries: () => entries,
          fence: (deletedAt: number) => {
            calls.push(`fence:${sessionKey}:${deletedAt}`);
          },
        }) as unknown as ReturnType<ConversationOperationsDependencies["store"]["thread"]>,
      conversationCutoff: async (sessionKey) => {
        calls.push(`cutoff:${sessionKey}`);
        return readsCutoff ? { value: EARLIER_CUTOFF } : undefined;
      },
      eraseConversation: async (sessionKey, now, keepSessionId, cutoffBefore) => {
        calls.push(`erase:${sessionKey}:${now}:${keepSessionId}:${cutoffBefore}`);
        return { published: erasePublished };
      },
    },
    brain: {
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

test("Delete conversation fences the thread and the brain's generation, then erases what stood at or before the press while the successor lifetime stands; nothing is retired or reopened", async () => {
  const { operations, calls } = harness();
  assert.equal(await operations.deleteConversation(THREAD), CONVERSATION_DELETE_OUTCOME.COMPLETE);
  assert.deepEqual(calls, [
    `fence:${THREAD}:${NOW}`,
    `cutoff:${THREAD}`,
    `clear:${THREAD}:${NOW}`,
    `erase:${THREAD}:${NOW}:gen-2:${EARLIER_CUTOFF}`,
  ]);
  const unpublished = harness(false);
  assert.equal(
    await unpublished.operations.deleteConversation(THREAD),
    CONVERSATION_DELETE_OUTCOME.INCOMPLETE,
  );
});

test("a marker the store will not write refuses the deletion with the fences standing and nothing erased", async () => {
  const { operations } = harness(true, { marks: false });
  assert.equal(await operations.deleteConversation(THREAD), CONVERSATION_DELETE_OUTCOME.REFUSED);
});

test("a cutoff the store cannot read refuses the deletion after the marker, with nothing erased: an archive never records a guessed cutoff", async () => {
  const { operations } = harness(true, { readsCutoff: false });
  assert.equal(await operations.deleteConversation(THREAD), CONVERSATION_DELETE_OUTCOME.REFUSED);
});

test("maintenance runs at the launch, preserving the busy conversations, and stops with its clock", () => {
  const runs: (readonly SessionKey[])[] = [];
  const stop = startConversationMaintenance({
    store: {
      runMaintenance: async (preserve) => {
        runs.push(preserve);
        return undefined;
      },
    },
    brain: { busyConversations: () => [THREAD] },
  });
  assert.deepEqual(runs, [[THREAD]]);
  stop();
});
