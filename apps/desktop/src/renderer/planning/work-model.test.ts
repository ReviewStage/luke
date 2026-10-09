import assert from "node:assert/strict";
import {
  PLAN_WORK_PART,
  PLAN_WORK_STATE,
  PLAN_WORK_TOOL,
  type PlanWorkPart,
  type PlanWorkState,
  type PlanWorkTool,
  type PlanWorkTurn,
} from "@sidecar/hosted/planning-view";
import { test } from "vitest";
import { openedWorker, WORK_BLOCK, type WorkBlock, workRowsOf } from "./work-model";

/** A call of `tool` about `subject`, at `state`. */
function call(
  id: string,
  tool: PlanWorkTool,
  subject: string | undefined,
  state: PlanWorkState = PLAN_WORK_STATE.DONE,
): Extract<PlanWorkPart, { type: typeof PLAN_WORK_PART.TOOL }> {
  return {
    type: PLAN_WORK_PART.TOOL,
    id,
    tool,
    name: tool,
    state,
    ...(subject === undefined ? undefined : { subject }),
    input: "{}",
  };
}

function words(text: string): PlanWorkPart {
  return { type: PLAN_WORK_PART.TEXT, text };
}

function turn(state: PlanWorkState, parts: readonly PlanWorkPart[]): PlanWorkTurn {
  return { turnId: "turn-1", startedAt: 0, state, earlierOmitted: false, parts };
}

/** The blocks as a reader scans them: each block's kind, and what it holds. */
function scanned(blocks: readonly WorkBlock[]): unknown[] {
  return blocks.map((block) => {
    if (block.kind === WORK_BLOCK.TEXT || block.kind === WORK_BLOCK.REASONING) {
      return [block.kind, block.text];
    }
    if (block.kind === WORK_BLOCK.CALL || block.kind === WORK_BLOCK.WORKER) {
      return [block.kind, block.call.subject];
    }
    if (block.kind === WORK_BLOCK.GROUP) {
      return [block.kind, block.calls.map((inner) => inner.subject), block.open];
    }
    return [block.kind, block.summary, scanned(block.blocks)];
  });
}

function blocksOf(turns: readonly PlanWorkTurn[], callLive = true): readonly WorkBlock[] {
  const [row] = workRowsOf(turns, callLive);
  assert.ok(row);
  return row.blocks;
}

test("calls next to one another fold under one line once the model moves on, and the latest group stays open while the turn moves", () => {
  const blocks = blocksOf([
    turn(PLAN_WORK_STATE.RUNNING, [
      call("a", PLAN_WORK_TOOL.REPOSITORY, "ls"),
      call("b", PLAN_WORK_TOOL.REPOSITORY, "cat a.ts"),
      words("Invites live in one file."),
      call("c", PLAN_WORK_TOOL.REPOSITORY, "cat b.ts", PLAN_WORK_STATE.RUNNING),
    ]),
  ]);

  assert.deepEqual(scanned(blocks), [
    [WORK_BLOCK.GROUP, ["ls", "cat a.ts"], false],
    [WORK_BLOCK.TEXT, "Invites live in one file."],
    [WORK_BLOCK.GROUP, ["cat b.ts"], true],
  ]);
});

test("a finished turn folds everything ahead of its last words into one line saying what it holds", () => {
  const blocks = blocksOf([
    turn(PLAN_WORK_STATE.DONE, [
      call("a", PLAN_WORK_TOOL.REPOSITORY, "ls"),
      words("Looking at the invites."),
      call("b", PLAN_WORK_TOOL.SEARCH_WEB, "invite expiry"),
      call("c", PLAN_WORK_TOOL.READ_WEB_PAGE, "https://example.com/docs/"),
      words("Seven days is common."),
    ]),
  ]);

  assert.deepEqual(scanned(blocks), [
    [
      WORK_BLOCK.FOLDED,
      "3 tool calls, 1 message",
      [
        [WORK_BLOCK.CALL, "ls"],
        [WORK_BLOCK.TEXT, "Looking at the invites."],
        [WORK_BLOCK.GROUP, ["invite expiry", "example.com/docs"], false],
      ],
    ],
    [WORK_BLOCK.TEXT, "Seven days is common."],
  ]);
});

test("the worker stands on its own row, the one call still turning while its turn waits on it", () => {
  const [row] = workRowsOf(
    [
      turn(PLAN_WORK_STATE.RUNNING, [
        call("w", PLAN_WORK_TOOL.WORKER, "Compare the queues.", PLAN_WORK_STATE.RUNNING),
        words("The worker is on it."),
      ]),
    ],
    true,
  );
  assert.ok(row);
  const [worker] = row.blocks;
  assert.ok(worker?.kind === WORK_BLOCK.WORKER);
  assert.equal(worker.call.verb, "Asked the worker");
  assert.equal(worker.call.running, true);
});

test("a turn its call left running is drawn as stopped, with nothing on it still turning", () => {
  const [row] = workRowsOf(
    [
      turn(PLAN_WORK_STATE.RUNNING, [
        call("a", PLAN_WORK_TOOL.REPOSITORY, "ls", PLAN_WORK_STATE.RUNNING),
      ]),
    ],
    false,
  );
  assert.ok(row);
  assert.equal(row.state, PLAN_WORK_STATE.FAILED);
  const [group] = row.blocks;
  assert.ok(group?.kind === WORK_BLOCK.CALL);
  assert.equal(group.call.running, false);
});

test("each call says what it did, the subject set apart as code where it is code, and a tool this build does not know by its own name", () => {
  const blocks = blocksOf(
    [
      turn(PLAN_WORK_STATE.DONE, [
        call("a", PLAN_WORK_TOOL.REPOSITORY, "ls"),
        call("b", PLAN_WORK_TOOL.QUEUE_QUESTION, "Who can invite?"),
        { ...call("c", PLAN_WORK_TOOL.OTHER, undefined), name: "summon_reviewer" },
      ]),
    ],
    false,
  );
  const [group] = blocks;
  assert.ok(group?.kind === WORK_BLOCK.GROUP);
  assert.deepEqual(
    group.calls.map((inner) => [inner.verb, inner.subject, inner.subjectIsCode]),
    [
      ["Ran", "ls", true],
      ["Queued a question", "Who can invite?", false],
      ["Used", "summon_reviewer", true],
    ],
  );
});

test("a worker's session is walked into blocks the way a turn is, each call on its own line, and opening it finds it inside a finished turn's fold", () => {
  const worker = {
    ...call("w", PLAN_WORK_TOOL.WORKER, "Compare the queues."),
    session: {
      earlierOmitted: false,
      parts: [
        call("s1", PLAN_WORK_TOOL.SEARCH_WEB, "queue revoke api"),
        call("s2", PLAN_WORK_TOOL.READ_WEB_PAGE, "https://example.com/queue-a"),
        words("Queue A lets an admin revoke."),
      ],
    },
  };
  const rows = workRowsOf(
    [turn(PLAN_WORK_STATE.DONE, [worker, words("Queue A is the one to use.")])],
    false,
  );

  const opened = openedWorker(rows, ["w"]);
  assert.ok(opened?.session);
  assert.deepEqual(scanned(opened.session.blocks), [
    [WORK_BLOCK.CALL, "queue revoke api"],
    [WORK_BLOCK.CALL, "example.com/queue-a"],
    [WORK_BLOCK.TEXT, "Queue A lets an admin revoke."],
  ]);
  assert.equal(openedWorker(rows, ["w", "gone"]), undefined);
  assert.equal(openedWorker(rows, ["gone"]), undefined);
});
