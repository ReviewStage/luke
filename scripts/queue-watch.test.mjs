import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "queue-watch.sh");

const EXIT = { DONE: 0, BLOCKED: 3, EVICTED: 5, DEQUEUED: 6, UNREADABLE: 7 };
const OUTCOME = {
  MERGED: "MERGED",
  READY: "READY",
  CHECK_FAILED: "CHECK_FAILED",
  EVICTED: "EVICTED",
  DEQUEUED: "DEQUEUED",
  UNREADABLE: "UNREADABLE",
};
const EVENT = { ENQUEUED: "ENQUEUED", RETRY: "RETRY" };
const PHASE = { SETTLE: "settle" };
const CALL = { REPO: "repo", READ: "read", ENQUEUE: "enqueue", DEQUEUE: "dequeue" };
const PULL_REQUEST_STATE = { OPEN: "OPEN", MERGED: "MERGED" };
const QUEUE_ENTRY_STATE = { AWAITING_CHECKS: "AWAITING_CHECKS" };
const MERGE_STATE_STATUS = { CLEAN: "CLEAN", UNKNOWN: "UNKNOWN" };
const CONCLUSION = { SUCCESS: "SUCCESS", FAILURE: "FAILURE" };

const PULL_REQUEST_NUMBER = 7;
const HEAD_OID = "0123456789abcdef0123456789abcdef01234567";
const MERGE_OID = "fedcba9876543210fedcba9876543210fedcba98";
const RULESET_CONTEXTS = ["TypeScript checks", "Tests (1/4)"];
const EXTRA_REQUIRED_CHECK = "Review bot";
const UNREADABLE_READ = "UNREADABLE";
const FAKE_DIRECTORY_VARIABLE = "QUEUE_WATCH_FAKE_DIRECTORY";
const READS_FILE = "reads.json";
const CALLS_FILE = "calls.jsonl";
const CURSOR_FILE = "read-cursor";

// The fake answers `gh repo view` and both mutations with canned success, and
// answers each read with the next snapshot of the scenario, repeating the last
// one; a snapshot that is the UNREADABLE marker exits non-zero instead. Every
// invocation is logged by kind, so a test counts presses rather than trusting
// the script's own account of them.
const FAKE_GH = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const directory = process.env.${FAKE_DIRECTORY_VARIABLE};
const args = process.argv.slice(2);
const query = (args.find((argument) => argument.startsWith("query=")) ?? "").slice("query=".length);
const kind =
  args[0] === "repo"
    ? "${CALL.REPO}"
    : query.includes("enqueuePullRequest")
      ? "${CALL.ENQUEUE}"
      : query.includes("dequeuePullRequest")
        ? "${CALL.DEQUEUE}"
        : "${CALL.READ}";
fs.appendFileSync(path.join(directory, "${CALLS_FILE}"), JSON.stringify({ kind, args }) + "\n");
if (kind === "${CALL.REPO}") {
  process.stdout.write(JSON.stringify({ nameWithOwner: "acme/luke" }));
  process.exit(0);
}
if (kind === "${CALL.ENQUEUE}") {
  process.stdout.write(JSON.stringify({
    data: { enqueuePullRequest: { mergeQueueEntry: { id: "MQE_1", state: "${QUEUE_ENTRY_STATE.AWAITING_CHECKS}", position: 1 } } },
  }));
  process.exit(0);
}
if (kind === "${CALL.DEQUEUE}") {
  process.stdout.write(JSON.stringify({ data: { dequeuePullRequest: { mergeQueueEntry: { id: "MQE_1" } } } }));
  process.exit(0);
}
const reads = JSON.parse(fs.readFileSync(path.join(directory, "${READS_FILE}"), "utf8"));
const cursorPath = path.join(directory, "${CURSOR_FILE}");
const index = fs.existsSync(cursorPath) ? Number(fs.readFileSync(cursorPath, "utf8")) : 0;
fs.writeFileSync(cursorPath, String(index + 1));
const answer = reads[Math.min(index, reads.length - 1)];
if (answer === "${UNREADABLE_READ}") {
  process.stderr.write("gh: HTTP 502\n");
  process.exit(1);
}
process.stdout.write(JSON.stringify({ data: { repository: { pullRequest: answer } } }));
`;

function checkRun(name, conclusion) {
  return { __typename: "CheckRun", name, status: "COMPLETED", conclusion };
}

function passingChecks() {
  return [...RULESET_CONTEXTS, EXTRA_REQUIRED_CHECK].map((name) =>
    checkRun(name, CONCLUSION.SUCCESS),
  );
}

function snapshot({
  state = PULL_REQUEST_STATE.OPEN,
  queueEntryState = null,
  unresolvedThreads = 0,
  mergeOid = null,
  checks = passingChecks(),
  mergeStateStatus = MERGE_STATE_STATUS.CLEAN,
} = {}) {
  return {
    id: "PR_1",
    state,
    mergeable: "MERGEABLE",
    mergeStateStatus,
    headRefOid: HEAD_OID,
    mergeCommit: mergeOid === null ? null : { oid: mergeOid },
    mergeQueueEntry: queueEntryState === null ? null : { state: queueEntryState, position: 1 },
    reviewThreads: {
      nodes: Array.from({ length: unresolvedThreads }, () => ({ isResolved: false })),
    },
    baseRef: {
      rules: {
        nodes: [
          {
            type: "REQUIRED_STATUS_CHECKS",
            parameters: {
              requiredStatusChecks: RULESET_CONTEXTS.map((context) => ({ context })),
            },
          },
          { type: "MERGE_QUEUE", parameters: {} },
        ],
      },
    },
    statusCheckRollup: { contexts: { nodes: checks } },
  };
}

// The read on which the queue entry has gone and the pull request still reads
// OPEN. It is one object on purpose: the merge scenario and the eviction
// scenario both pass through it, and only the read after the settle differs.
const OPEN_UNQUEUED = snapshot();
const QUEUED = snapshot({ queueEntryState: QUEUE_ENTRY_STATE.AWAITING_CHECKS });
const QUEUED_WITH_THREAD = snapshot({
  queueEntryState: QUEUE_ENTRY_STATE.AWAITING_CHECKS,
  unresolvedThreads: 1,
});
const OPEN_WITH_THREAD = snapshot({ unresolvedThreads: 1 });
const MERGED = snapshot({
  state: PULL_REQUEST_STATE.MERGED,
  mergeOid: MERGE_OID,
  mergeStateStatus: MERGE_STATE_STATUS.UNKNOWN,
});

function runWatcher(reads, { press = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "queue-watch-"));
  try {
    fs.writeFileSync(path.join(directory, "gh"), FAKE_GH, { mode: 0o755 });
    fs.writeFileSync(path.join(directory, READS_FILE), JSON.stringify(reads));
    const result = spawnSync(
      "bash",
      [scriptPath, ...(press ? ["--press"] : []), "--interval", "0", String(PULL_REQUEST_NUMBER)],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}${path.delimiter}${process.env.PATH}`,
          [FAKE_DIRECTORY_VARIABLE]: directory,
          QUEUE_WATCH_SETTLE_SECONDS: "0",
          QUEUE_WATCH_EXTRA_REQUIRED_CHECKS: EXTRA_REQUIRED_CHECK,
        },
      },
    );
    const callsPath = path.join(directory, CALLS_FILE);
    const calls = fs.existsSync(callsPath)
      ? fs
          .readFileSync(callsPath, "utf8")
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line).kind)
      : [];
    const lines = result.stdout
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => line.split(" "));
    return {
      status: result.status,
      lines,
      outcome: lines.at(-1),
      calls: {
        reads: calls.filter((kind) => kind === CALL.READ).length,
        enqueues: calls.filter((kind) => kind === CALL.ENQUEUE).length,
        dequeues: calls.filter((kind) => kind === CALL.DEQUEUE).length,
      },
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("the read on which the entry vanished is not the read that calls it a merge", () => {
  const run = runWatcher([OPEN_UNQUEUED, QUEUED, OPEN_UNQUEUED, MERGED]);

  assert.equal(run.status, EXIT.DONE);
  assert.deepEqual(run.outcome, [OUTCOME.MERGED, MERGE_OID]);
  assert.deepEqual(run.calls, { reads: 4, enqueues: 1, dequeues: 0 });
});

test("the same vanished read followed by an open pull request is an eviction, retried once", () => {
  const run = runWatcher([
    OPEN_UNQUEUED,
    QUEUED,
    OPEN_UNQUEUED,
    OPEN_UNQUEUED,
    OPEN_UNQUEUED,
    QUEUED,
    OPEN_UNQUEUED,
    OPEN_UNQUEUED,
  ]);

  assert.equal(run.status, EXIT.EVICTED);
  assert.deepEqual(run.outcome, [
    OUTCOME.EVICTED,
    PULL_REQUEST_STATE.OPEN,
    MERGE_STATE_STATUS.CLEAN,
  ]);
  assert.deepEqual(
    run.lines.map((line) => line[0]),
    [EVENT.ENQUEUED, EVENT.RETRY, EVENT.ENQUEUED, OUTCOME.EVICTED],
  );
  assert.deepEqual(run.calls, { reads: 8, enqueues: 2, dequeues: 0 });
});

test("a settle read that fails is its own outcome and decides neither way", () => {
  const run = runWatcher([OPEN_UNQUEUED, QUEUED, OPEN_UNQUEUED, UNREADABLE_READ]);

  assert.equal(run.status, EXIT.UNREADABLE);
  assert.deepEqual(run.outcome, [OUTCOME.UNREADABLE, PHASE.SETTLE]);
  assert.deepEqual(run.calls, { reads: 6, enqueues: 1, dequeues: 0 });
});

test("unarmed, the watcher reports the head it would press and presses nothing", () => {
  const run = runWatcher([OPEN_UNQUEUED], { press: false });

  assert.equal(run.status, EXIT.DONE);
  assert.deepEqual(run.outcome, [OUTCOME.READY, HEAD_OID]);
  assert.deepEqual(run.calls, { reads: 1, enqueues: 0, dequeues: 0 });
});

test("a thread appearing while queued dequeues the entry and the retry presses again once it is resolved", () => {
  const run = runWatcher([
    OPEN_UNQUEUED,
    QUEUED_WITH_THREAD,
    OPEN_WITH_THREAD,
    OPEN_UNQUEUED,
    QUEUED,
    OPEN_UNQUEUED,
    MERGED,
  ]);

  assert.equal(run.status, EXIT.DONE);
  assert.deepEqual(run.outcome, [OUTCOME.MERGED, MERGE_OID]);
  assert.deepEqual(
    run.lines.map((line) => line[0]),
    [EVENT.ENQUEUED, EVENT.RETRY, EVENT.ENQUEUED, OUTCOME.MERGED],
  );
  assert.deepEqual(run.calls, { reads: 7, enqueues: 2, dequeues: 1 });
});

test("a second thread while queued spends the retry and ends the watch", () => {
  const run = runWatcher([OPEN_UNQUEUED, QUEUED_WITH_THREAD, OPEN_UNQUEUED, QUEUED_WITH_THREAD]);

  assert.equal(run.status, EXIT.DEQUEUED);
  assert.deepEqual(run.outcome, [OUTCOME.DEQUEUED, HEAD_OID, "1"]);
  assert.deepEqual(run.calls, { reads: 4, enqueues: 2, dequeues: 2 });
});

test("a failed check outside the ruleset's list still ends the watch when the build requires it", () => {
  const run = runWatcher([
    snapshot({
      checks: [
        ...RULESET_CONTEXTS.map((name) => checkRun(name, CONCLUSION.SUCCESS)),
        checkRun(EXTRA_REQUIRED_CHECK, CONCLUSION.FAILURE),
      ],
    }),
  ]);

  assert.equal(run.status, EXIT.BLOCKED);
  assert.deepEqual(run.outcome, [OUTCOME.CHECK_FAILED, ...EXTRA_REQUIRED_CHECK.split(" ")]);
  assert.deepEqual(run.calls, { reads: 1, enqueues: 0, dequeues: 0 });
});
