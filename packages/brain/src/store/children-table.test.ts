import assert from "node:assert/strict";
import test from "node:test";
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
import {
  deleteChildCompletion,
  deleteChildRun,
  listChildCompletions,
  listChildRuns,
  putChildCompletion,
  putChildRun,
} from "./children-table.js";
import { NOW, openTestDatabase } from "./testing.js";

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

test("child runs are written whole, updated in place, read back through the contracts' validator, and deleted by id", () => {
  const database = openTestDatabase();
  assert.deepEqual(listChildRuns(database), []);
  const accepted = child("c1");
  assert.equal(putChildRun(database, accepted), true);
  assert.deepEqual(listChildRuns(database), [accepted]);
  const running = { ...accepted, status: CHILD_RUN_STATUS.RUNNING, startedAt: NOW + 1 };
  assert.equal(putChildRun(database, running), true);
  const completed = {
    ...running,
    status: CHILD_RUN_STATUS.COMPLETED,
    settledAt: NOW + 5,
    resultText: "the build fails on a missing import",
    performedActs: 0,
    unknownActs: 0,
  };
  assert.equal(putChildRun(database, completed), true);
  assert.deepEqual(listChildRuns(database), [completed]);
  // SAFETY: the columns selected are the ones the row type names.
  const row = database
    .prepare("SELECT status, settled_at FROM child_runs WHERE child_id = ?")
    .get("c1") as { status: string; settled_at: number };
  assert.equal(row.status, CHILD_RUN_STATUS.COMPLETED);
  assert.equal(row.settled_at, NOW + 5);
  database.prepare("UPDATE child_runs SET payload = '{}' WHERE child_id = ?").run("c1");
  assert.deepEqual(listChildRuns(database), []);
  assert.equal(deleteChildRun(database, "c1"), true);
  assert.equal(deleteChildRun(database, "c1"), false);
});

test("completions stand in their own table apart from the child's row", () => {
  const database = openTestDatabase();
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
  assert.equal(putChildCompletion(database, completion), true);
  assert.deepEqual(listChildCompletions(database), [completion]);
  const retried = {
    ...completion,
    attempts: 1,
    firstAttemptAt: NOW + 1,
    nextAttemptAt: NOW + 15_001,
    lastError: "busy",
  };
  assert.equal(putChildCompletion(database, retried), true);
  assert.deepEqual(listChildCompletions(database), [retried]);
  assert.deepEqual(listChildRuns(database), []);
  assert.equal(deleteChildCompletion(database, completion.completionId), true);
  assert.deepEqual(listChildCompletions(database), []);
});
