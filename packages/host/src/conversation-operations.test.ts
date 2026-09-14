import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  CONVERSATION_KIND,
  type ConversationRecord,
  type SessionKey,
  threadSessionKey,
} from "@sidecar/runtime/vocabulary";
import { Effect } from "effect";
import { CONVERSATION_DELETE_OUTCOME } from "./brain/conversation-deletion.js";
import {
  type ConversationOperationsDependencies,
  conversationOperations,
} from "./conversation-operations.js";

const NOW = 1_800_000_000_000;
const THREAD = threadSessionKey("t-1");

function harness({ marks = true } = {}) {
  const calls: string[] = [];
  let generation = "gen-1";
  const record = (sessionKey: SessionKey): ConversationRecord => ({
    sessionKey,
    kind: CONVERSATION_KIND.THREAD,
    name: "Thread 1",
    createdAt: NOW,
    lastActivityAt: NOW,
  });
  const dependencies: ConversationOperationsDependencies = {
    conversations: {
      directory: () => [record(THREAD)],
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

it.effect(
  "Delete conversation fences the brain's generation and completes once the successor's marker stands; nothing is retired or reopened",
  () =>
    Effect.gen(function* () {
      const { operations, calls } = harness();
      assert.equal(
        yield* operations.deleteConversation(THREAD),
        CONVERSATION_DELETE_OUTCOME.COMPLETE,
      );
      assert.deepEqual(calls, [`clear:${THREAD}:${NOW}`]);
      assert.deepEqual(
        operations.directory().map((record) => record.sessionKey),
        [THREAD],
      );
    }),
);

it.effect(
  "a marker the brain's store will not write refuses the deletion with the fence standing",
  () =>
    Effect.gen(function* () {
      const { operations, calls } = harness({ marks: false });
      assert.equal(
        yield* operations.deleteConversation(THREAD),
        CONVERSATION_DELETE_OUTCOME.REFUSED,
      );
      assert.deepEqual(calls, [
        `clear:${THREAD}:${NOW}`,
        "report:Delete conversation incomplete: the brain's memory could not be marked erased",
      ]);
    }),
);
