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
import { CALL_KIND, TURN_ROW, type TurnRow } from "./turn-rows";
import { WORK_BLOCK, type WorkBlock, workerOf, workRowsOf } from "./work-model";

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

function thought(text: string): PlanWorkPart {
  return { type: PLAN_WORK_PART.REASONING, text };
}

function turn(state: PlanWorkState, parts: readonly PlanWorkPart[]): PlanWorkTurn {
  return { turnId: "turn-1", startedAt: 0, state, earlierOmitted: false, parts };
}

/** A block as a reader scans it: its kind, and what it holds. */
function scannedBlock(block: WorkBlock): [string, string | undefined] {
  return block.kind === WORK_BLOCK.TEXT || block.kind === WORK_BLOCK.REASONING
    ? [block.kind, block.text]
    : [block.kind, block.call.subject];
}

/** The rows as a reader scans them: each block, each group's calls and whether it opens, each fold's line and what it holds. */
function scanned(rows: readonly TurnRow<WorkBlock>[]): unknown[] {
  return rows.map((row) => {
    if (row.kind === TURN_ROW.BLOCK) return scannedBlock(row.block);
    if (row.kind === TURN_ROW.GROUP) {
      return [row.kind, row.blocks.map((block) => scannedBlock(block)[1]), row.open];
    }
    return [row.kind, row.summary, scanned(row.rows)];
  });
}

function rowsOf(turns: readonly PlanWorkTurn[], callLive = true): readonly TurnRow<WorkBlock>[] {
  const [row] = workRowsOf(turns, callLive);
  assert.ok(row);
  return row.rows;
}

test("calls next to one another fold under one line once the model moves on, and the latest group stays open while the turn moves", () => {
  const rows = rowsOf([
    turn(PLAN_WORK_STATE.RUNNING, [
      call("a", PLAN_WORK_TOOL.REPOSITORY, "ls"),
      call("b", PLAN_WORK_TOOL.REPOSITORY, "cat a.ts"),
      words("Invites live in one file."),
      call("c", PLAN_WORK_TOOL.REPOSITORY, "cat b.ts", PLAN_WORK_STATE.RUNNING),
    ]),
  ]);

  assert.deepEqual(scanned(rows), [
    [TURN_ROW.GROUP, ["ls", "cat a.ts"], false],
    [WORK_BLOCK.TEXT, "Invites live in one file."],
    [TURN_ROW.GROUP, ["cat b.ts"], true],
  ]);
});

test("a finished turn folds everything ahead of its last words into one line saying what it holds", () => {
  const rows = rowsOf([
    turn(PLAN_WORK_STATE.DONE, [
      call("a", PLAN_WORK_TOOL.REPOSITORY, "ls"),
      words("Looking at the invites."),
      call("b", PLAN_WORK_TOOL.SEARCH_WEB, "invite expiry"),
      call("c", PLAN_WORK_TOOL.READ_WEB_PAGE, "https://example.com/docs/"),
      words("Seven days is common."),
    ]),
  ]);

  assert.deepEqual(scanned(rows), [
    [
      TURN_ROW.FOLDED,
      "3 tool calls, 1 message",
      [
        [WORK_BLOCK.CALL, "ls"],
        [WORK_BLOCK.TEXT, "Looking at the invites."],
        [WORK_BLOCK.CALL, "invite expiry"],
        [WORK_BLOCK.CALL, "example.com/docs"],
      ],
    ],
    [WORK_BLOCK.TEXT, "Seven days is common."],
  ]);
});

test("a finished turn's calls ahead of its words are folded once, under the lead's line, never a group inside it, whether they ran in one step or across several", () => {
  const rows = rowsOf([
    turn(PLAN_WORK_STATE.DONE, [
      call("a", PLAN_WORK_TOOL.LIST_AGENTS, undefined),
      call("b", PLAN_WORK_TOOL.READ_AGENT, "agent-1"),
      call("c", PLAN_WORK_TOOL.READ_AGENT, "agent-2"),
      words("Both agents are done."),
    ]),
  ]);

  assert.deepEqual(scanned(rows), [
    [
      TURN_ROW.FOLDED,
      "3 tool calls",
      [
        [WORK_BLOCK.CALL, undefined],
        [WORK_BLOCK.CALL, "agent-1"],
        [WORK_BLOCK.CALL, "agent-2"],
      ],
    ],
    [WORK_BLOCK.TEXT, "Both agents are done."],
  ]);
});

test("a finished turn's fold names its subagents apart from its other calls, in the singular for one, and a subagent still running reads no differently", () => {
  const summaryOf = (parts: readonly PlanWorkPart[]) => {
    const [fold] = rowsOf([turn(PLAN_WORK_STATE.DONE, parts)]);
    assert.ok(fold?.kind === TURN_ROW.FOLDED);
    return fold.summary;
  };

  assert.equal(
    summaryOf([
      call("a", PLAN_WORK_TOOL.REPOSITORY, "ls"),
      call("w1", PLAN_WORK_TOOL.WORKER, "Compare the queues."),
      call("w2", PLAN_WORK_TOOL.WORKER, "Find the admin check.", PLAN_WORK_STATE.RUNNING),
      call("b", PLAN_WORK_TOOL.WORKER_WAIT, undefined),
      words("Both workers are on it."),
      call("c", PLAN_WORK_TOOL.REPOSITORY, "cat invites.ts"),
      words("Queue A is the one to use."),
    ]),
    "3 tool calls, 2 subagents, 1 message",
  );
  assert.equal(
    summaryOf([
      call("a", PLAN_WORK_TOOL.REPOSITORY, "ls"),
      call("w", PLAN_WORK_TOOL.WORKER, "Compare the queues."),
      words("Queue A is the one to use."),
    ]),
    "1 tool call, 1 subagent",
  );
  assert.equal(
    summaryOf([
      call("w", PLAN_WORK_TOOL.WORKER, "Compare the queues."),
      words("Queue A is the one to use."),
    ]),
    "1 subagent",
  );
});

test("a finished turn with no call ahead of its last words folds nothing: its thought and words stand at the top level", () => {
  const rows = rowsOf([
    turn(PLAN_WORK_STATE.DONE, [
      thought("They said hello."),
      words("Hello."),
      thought("Nothing to look up."),
      words("What are we building?"),
    ]),
  ]);

  assert.deepEqual(scanned(rows), [
    [WORK_BLOCK.REASONING, "They said hello."],
    [WORK_BLOCK.TEXT, "Hello."],
    [WORK_BLOCK.REASONING, "Nothing to look up."],
    [WORK_BLOCK.TEXT, "What are we building?"],
  ]);
});

test("a finished turn's thought between its calls folds with them under the lead's line", () => {
  const rows = rowsOf([
    turn(PLAN_WORK_STATE.DONE, [
      thought("Find the invites."),
      call("a", PLAN_WORK_TOOL.REPOSITORY, "ls"),
      thought("Read the one file."),
      call("b", PLAN_WORK_TOOL.REPOSITORY, "cat invites.ts"),
      words("Invites live in one file."),
    ]),
  ]);

  assert.deepEqual(scanned(rows), [
    [
      TURN_ROW.FOLDED,
      "2 tool calls",
      [
        [WORK_BLOCK.REASONING, "Find the invites."],
        [WORK_BLOCK.CALL, "ls"],
        [WORK_BLOCK.REASONING, "Read the one file."],
        [WORK_BLOCK.CALL, "cat invites.ts"],
      ],
    ],
    [WORK_BLOCK.TEXT, "Invites live in one file."],
  ]);
});

test("the same calls while their turn still moves are one open group, and no lead is folded yet", () => {
  const rows = rowsOf([
    turn(PLAN_WORK_STATE.RUNNING, [
      call("a", PLAN_WORK_TOOL.LIST_AGENTS, undefined),
      call("b", PLAN_WORK_TOOL.READ_AGENT, "agent-1"),
      call("c", PLAN_WORK_TOOL.READ_AGENT, "agent-2", PLAN_WORK_STATE.RUNNING),
    ]),
  ]);

  assert.deepEqual(scanned(rows), [[TURN_ROW.GROUP, [undefined, "agent-1", "agent-2"], true]]);
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
  const [worker] = row.rows;
  assert.ok(worker?.kind === TURN_ROW.BLOCK && worker.block.kind === WORK_BLOCK.WORKER);
  assert.equal(worker.block.call.kind, CALL_KIND.WORKER);
  assert.equal(worker.block.call.running, true);
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
  const [left] = row.rows;
  assert.ok(left?.kind === TURN_ROW.BLOCK && left.block.kind === WORK_BLOCK.CALL);
  assert.equal(left.block.call.running, false);
});

test("each call is its kind with its subject, a command's body the command itself, and a tool this build does not know by its own name", () => {
  const rows = rowsOf(
    [
      turn(PLAN_WORK_STATE.DONE, [
        { ...call("a", PLAN_WORK_TOOL.REPOSITORY, "ls"), input: '{ "command": "ls" }' },
        call("b", PLAN_WORK_TOOL.QUEUE_QUESTION, "Who can invite?"),
        { ...call("c", PLAN_WORK_TOOL.OTHER, undefined), name: "summon_reviewer" },
      ]),
    ],
    false,
  );
  const [group] = rows;
  assert.ok(group?.kind === TURN_ROW.GROUP);
  const calls = group.blocks.flatMap((block) =>
    block.kind === WORK_BLOCK.CALL ? [block.call] : [],
  );
  assert.deepEqual(
    calls.map((inner) => [inner.kind, inner.subject, inner.input]),
    [
      [CALL_KIND.COMMAND, "ls", { kind: "command", text: "ls" }],
      [CALL_KIND.QUEUE_QUESTION, "Who can invite?", { kind: "text", text: "{}" }],
      [CALL_KIND.OTHER, "summon_reviewer", { kind: "text", text: "{}" }],
    ],
  );
});

test("a worker's session is walked into blocks the way a turn is, each call on its own line, and its tab finds it inside a finished turn's fold", () => {
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

  const opened = workerOf(rows, "w");
  assert.ok(opened?.session);
  assert.deepEqual(scanned(opened.session.rows), [
    [WORK_BLOCK.CALL, "queue revoke api"],
    [WORK_BLOCK.CALL, "example.com/queue-a"],
    [WORK_BLOCK.TEXT, "Queue A lets an admin revoke."],
  ]);
  assert.equal(workerOf(rows, "gone"), undefined);
});

test("a worker's task is the whole message it was handed, which its subject cuts, and its job where the input carries none", () => {
  const message = `Compare the queues. ${"Read each README in full. ".repeat(20)}`;
  const handed = {
    ...call("w", PLAN_WORK_TOOL.WORKER, `${message.slice(0, 40)}…`),
    input: JSON.stringify({ message }, null, 2),
  };
  const unread = call("v", PLAN_WORK_TOOL.WORKER, "Find the admin check.");
  const rows = workRowsOf([turn(PLAN_WORK_STATE.RUNNING, [handed, unread])], true);

  assert.equal(workerOf(rows, "w")?.task, message);
  assert.equal(workerOf(rows, "v")?.task, "Find the admin check.");
});
