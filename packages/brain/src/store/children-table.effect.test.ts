import assert from "node:assert/strict";
import * as Client from "@effect/sql/SqlClient";
import { describe, it } from "@effect/vitest";
import {
  CHILD_CLEANUP,
  CHILD_CONTEXT_MODE,
  CHILD_RUN_STATUS,
  type ChildCompletionRecord,
  type ChildRunRecord,
  COMPLETION_DELIVERY_STATUS,
  childSessionKey,
  completionIdFor,
  DEFAULT_AGENT_ID,
  MAIN_SESSION_KEY,
} from "@sidecar/runtime/vocabulary";
import { Effect } from "effect";
import {
  deleteChildCompletionEffect,
  deleteChildRunEffect,
  listChildCompletionsEffect,
  listChildRunsEffect,
  putChildCompletionEffect,
  putChildRunEffect,
} from "./children-table.js";
import { NOW, overStore } from "./testing.js";

function child(childId: string, overrides: Partial<ChildRunRecord> = {}): ChildRunRecord {
  return {
    childId,
    agentId: DEFAULT_AGENT_ID,
    requesterSessionKey: MAIN_SESSION_KEY,
    requesterRunId: "run-1",
    childSessionKey: childSessionKey(childId),
    childRunId: `${childId}-run`,
    task: "look into the failing build",
    depth: 1,
    requestedContext: CHILD_CONTEXT_MODE.ISOLATED,
    context: CHILD_CONTEXT_MODE.ISOLATED,
    policy: { allowed: ["read_transcript"], denied: ["announce"] },
    timeoutMs: 0,
    cleanup: CHILD_CLEANUP.KEEP,
    completionDestination: MAIN_SESSION_KEY,
    expectsCompletion: true,
    status: CHILD_RUN_STATUS.ACCEPTED,
    acceptedAt: NOW,
    ...overrides,
  };
}

describe("child runs and their completions over the client", () => {
  it.effect(
    "child runs are written whole, updated in place, read back through the contracts' validator, and deleted by id",
    () =>
      overStore(
        Effect.gen(function* () {
          assert.deepEqual(yield* listChildRunsEffect, []);
          const accepted = child("c1");
          assert.equal(yield* putChildRunEffect(accepted), true);
          assert.deepEqual(yield* listChildRunsEffect, [accepted]);
          const running = { ...accepted, status: CHILD_RUN_STATUS.RUNNING, startedAt: NOW + 1 };
          assert.equal(yield* putChildRunEffect(running), true);
          const completed = {
            ...running,
            status: CHILD_RUN_STATUS.COMPLETED,
            settledAt: NOW + 5,
            resultText: "the build fails on a missing import",
            performedActions: 0,
            unknownActions: 0,
          };
          assert.equal(yield* putChildRunEffect(completed), true);
          assert.deepEqual(yield* listChildRunsEffect, [completed]);
          const sql = yield* Client.SqlClient;
          const rows =
            yield* sql`SELECT status, settled_at FROM child_runs WHERE child_id = ${"c1"}`;
          assert.equal(rows.length, 1);
          assert.equal(rows[0]?.status, CHILD_RUN_STATUS.COMPLETED);
          assert.equal(rows[0]?.settled_at, NOW + 5);
          yield* sql`UPDATE child_runs SET payload = ${"{}"} WHERE child_id = ${"c1"}`;
          assert.deepEqual(yield* listChildRunsEffect, []);
          assert.equal(yield* deleteChildRunEffect("c1"), true);
          assert.equal(yield* deleteChildRunEffect("c1"), false);
        }),
      ),
  );

  it.effect("completions stand in their own table apart from the child's row", () =>
    overStore(
      Effect.gen(function* () {
        const completion: ChildCompletionRecord = {
          completionId: completionIdFor("c1"),
          childId: "c1",
          destination: MAIN_SESSION_KEY,
          status: CHILD_RUN_STATUS.COMPLETED,
          resultText: "done",
          createdAt: NOW,
          delivery: COMPLETION_DELIVERY_STATUS.PENDING,
          attempts: 0,
        };
        assert.equal(yield* putChildCompletionEffect(completion), true);
        assert.deepEqual(yield* listChildCompletionsEffect, [completion]);
        const retried = {
          ...completion,
          attempts: 1,
          firstAttemptAt: NOW + 1,
          nextAttemptAt: NOW + 15_001,
          lastError: "busy",
        };
        assert.equal(yield* putChildCompletionEffect(retried), true);
        assert.deepEqual(yield* listChildCompletionsEffect, [retried]);
        assert.deepEqual(yield* listChildRunsEffect, []);
        assert.equal(yield* deleteChildCompletionEffect(completion.completionId), true);
        assert.deepEqual(yield* listChildCompletionsEffect, []);
      }),
    ),
  );
});
