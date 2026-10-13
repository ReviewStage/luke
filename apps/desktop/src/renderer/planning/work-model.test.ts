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
import { TOOL_STATE } from "../ai-elements/tool";
import { AGENT_PART, type AgentPart, agentParts, agentRows, delegates } from "./coding-agent-model";
import { toolCallView } from "./tool-call-model";
import { CALL_KIND, TURN_ROW, type TurnRow } from "./turn-rows";
import { workerOf, workRowsOf } from "./work-model";

/** What a reader scans a part as: words, a thought, a call, or a subagent. */
const SCANNED = {
  TEXT: "text",
  REASONING: "reasoning",
  CALL: "call",
  WORKER: "worker",
} as const;

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

/** A part as a reader scans it: its kind, and what it holds. */
function scannedBlock(part: AgentPart): [string, string | undefined] {
  if (part.kind === AGENT_PART.TEXT) return [SCANNED.TEXT, part.text];
  if (part.kind === AGENT_PART.REASONING) return [SCANNED.REASONING, part.text];
  assert.ok(part.kind === AGENT_PART.TOOL);
  return [delegates(part) ? SCANNED.WORKER : SCANNED.CALL, part.said?.subject];
}

/** The rows as a reader scans them: each part, each group's calls and whether it opens, each fold's line and what it holds. */
function scanned(rows: readonly TurnRow<AgentPart>[]): unknown[] {
  return rows.map((row) => {
    if (row.kind === TURN_ROW.BLOCK) return scannedBlock(row.block);
    if (row.kind === TURN_ROW.GROUP) {
      return [row.kind, row.blocks.map((block) => scannedBlock(block)[1]), row.open];
    }
    return [row.kind, row.summary, scanned(row.rows)];
  });
}

/** The first turn's rows as the agent tab draws Luke's message for it. */
function rowsOf(turns: readonly PlanWorkTurn[], callLive = true): readonly TurnRow<AgentPart>[] {
  const [row] = workRowsOf(turns, callLive);
  assert.ok(row);
  return agentRows(row.message, row.moving);
}

/** The turn's calls, as the agent tab reads its parts. */
function callsOf(turns: readonly PlanWorkTurn[], callLive = true) {
  const [row] = workRowsOf(turns, callLive);
  assert.ok(row);
  return agentParts(row.message).flatMap((part) => (part.kind === AGENT_PART.TOOL ? [part] : []));
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
    [SCANNED.TEXT, "Invites live in one file."],
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
        [SCANNED.CALL, "ls"],
        [SCANNED.TEXT, "Looking at the invites."],
        [SCANNED.CALL, "invite expiry"],
        [SCANNED.CALL, "example.com/docs"],
      ],
    ],
    [SCANNED.TEXT, "Seven days is common."],
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
        [SCANNED.CALL, undefined],
        [SCANNED.CALL, "agent-1"],
        [SCANNED.CALL, "agent-2"],
      ],
    ],
    [SCANNED.TEXT, "Both agents are done."],
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

test("a stop names the subagent it stopped by that subagent's job, a start in an earlier turn included, and a stop of a task no turn here started names none, though a call sent it more work", () => {
  const started = turn(PLAN_WORK_STATE.DONE, [
    { ...call("w", PLAN_WORK_TOOL.WORKER, "Read the styling setup."), task: "worker-1" },
    {
      ...call("r", PLAN_WORK_TOOL.WORKER, "Also read the build."),
      task: "worker-0",
      input: JSON.stringify({ message: "Also read the build.", taskId: "worker-0" }),
    },
    words("A worker is reading it."),
  ]);
  const stopping = {
    ...turn(PLAN_WORK_STATE.RUNNING, [
      { ...call("c1", PLAN_WORK_TOOL.WORKER_CANCEL, undefined), task: "worker-1" },
      { ...call("c2", PLAN_WORK_TOOL.WORKER_CANCEL, undefined), task: "worker-0" },
      call("c3", PLAN_WORK_TOOL.WORKER_CANCEL, undefined),
    ]),
    turnId: "turn-2",
  };

  const [, later] = workRowsOf([started, stopping], true);
  assert.ok(later);
  assert.deepEqual(scanned(agentRows(later.message, later.moving)), [
    [TURN_ROW.GROUP, ["Read the styling setup.", undefined, undefined], true],
  ]);
});

test("a finished turn's fold names the coding agents it started apart from its tool calls and its subagents, and a start refused is a tool call", () => {
  const summaryOf = (parts: readonly PlanWorkPart[]) => {
    const [fold] = rowsOf([turn(PLAN_WORK_STATE.DONE, parts)]);
    assert.ok(fold?.kind === TURN_ROW.FOLDED);
    return fold.summary;
  };
  const started = (id: string, agent: string) => ({
    ...call(id, PLAN_WORK_TOOL.START_AGENT, "Investigate a Tailwind migration."),
    output: JSON.stringify({ status: "accepted", agent: { id: agent, modelName: "Opus 5.5" } }),
  });
  const refused = {
    ...call("r", PLAN_WORK_TOOL.START_AGENT, "Fix the invite emails."),
    output: JSON.stringify({ status: "rejected", reason: "The plan has no repository." }),
  };

  assert.equal(
    summaryOf([
      call("a", PLAN_WORK_TOOL.REPOSITORY, "ls"),
      call("w", PLAN_WORK_TOOL.WORKER, "Read the styling setup."),
      started("s", "agent-1"),
      call("c", PLAN_WORK_TOOL.WORKER_CANCEL, undefined),
      words("Started Opus 5.5 on the investigation."),
    ]),
    "2 tool calls, 1 subagent, 1 coding agent",
  );
  assert.equal(
    summaryOf([started("s1", "agent-1"), started("s2", "agent-2"), words("Started two agents.")]),
    "2 coding agents",
  );
  assert.equal(summaryOf([refused, words("That did not start.")]), "1 tool call");
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
    [SCANNED.REASONING, "They said hello."],
    [SCANNED.TEXT, "Hello."],
    [SCANNED.REASONING, "Nothing to look up."],
    [SCANNED.TEXT, "What are we building?"],
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
        [SCANNED.REASONING, "Find the invites."],
        [SCANNED.CALL, "ls"],
        [SCANNED.REASONING, "Read the one file."],
        [SCANNED.CALL, "cat invites.ts"],
      ],
    ],
    [SCANNED.TEXT, "Invites live in one file."],
  ]);
});

test("the worker stands on its own row, the one call still turning while its turn waits on it", () => {
  const rows = rowsOf([
    turn(PLAN_WORK_STATE.RUNNING, [
      call("w", PLAN_WORK_TOOL.WORKER, "Compare the queues.", PLAN_WORK_STATE.RUNNING),
      words("The worker is on it."),
    ]),
  ]);
  const [worker] = rows;
  assert.ok(worker?.kind === TURN_ROW.BLOCK && worker.block.kind === AGENT_PART.TOOL);
  assert.equal(delegates(worker.block), true);
  assert.equal(worker.block.said?.kind, CALL_KIND.WORKER);
  assert.equal(worker.block.state, TOOL_STATE.INPUT_AVAILABLE);
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
  assert.equal(row.moving, false);
  const [left] = callsOf(
    [
      turn(PLAN_WORK_STATE.RUNNING, [
        call("a", PLAN_WORK_TOOL.REPOSITORY, "ls", PLAN_WORK_STATE.RUNNING),
      ]),
    ],
    false,
  );
  assert.equal(left?.state, TOOL_STATE.OUTPUT_AVAILABLE);
});

test("each call is its kind with its subject, a command's body the command itself, and a tool this build does not know by its own name", () => {
  const calls = callsOf(
    [
      turn(PLAN_WORK_STATE.DONE, [
        { ...call("a", PLAN_WORK_TOOL.REPOSITORY, "ls"), input: '{ "command": "ls" }' },
        call("b", PLAN_WORK_TOOL.QUEUE_QUESTION, "Who can invite?"),
        { ...call("c", PLAN_WORK_TOOL.OTHER, undefined), name: "summon_reviewer" },
      ]),
    ],
    false,
  );
  assert.deepEqual(
    calls.map((inner) => {
      const view = toolCallView(inner);
      return [view.kind, view.subject, view.input];
    }),
    [
      [CALL_KIND.COMMAND, "ls", { kind: "command", text: "ls" }],
      [CALL_KIND.QUEUE_QUESTION, "Who can invite?", { kind: "json", text: "{}" }],
      [CALL_KIND.OTHER, "summon_reviewer", { kind: "json", text: "{}" }],
    ],
  );
});

test("a worker's session is read into parts the way a turn is, each call on its own line, and its tab finds it among the turns", () => {
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
  assert.deepEqual(scanned(agentRows(opened.session.message, false, false)), [
    [SCANNED.CALL, "queue revoke api"],
    [SCANNED.CALL, "example.com/queue-a"],
    [SCANNED.TEXT, "Queue A lets an admin revoke."],
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

test("a skill load, which the wire says as another tool named load_skill, is read as the skill it loaded", () => {
  const [load] = callsOf(
    [
      turn(PLAN_WORK_STATE.DONE, [
        {
          ...call("k", PLAN_WORK_TOOL.OTHER, "release-notes"),
          name: "load_skill",
          input: JSON.stringify({ skill: "release-notes" }),
        },
        { ...call("o", PLAN_WORK_TOOL.OTHER, undefined), name: "summon_reviewer" },
      ]),
    ],
    false,
  );
  assert.deepEqual(load?.said, { kind: CALL_KIND.LOAD_SKILL, subject: "release-notes" });
});
