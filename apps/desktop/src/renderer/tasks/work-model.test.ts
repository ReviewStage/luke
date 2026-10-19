import assert from "node:assert/strict";
import { AGENT_TOOL, EVE_TOOL, RETIRED_TOOL } from "@luke/features/agent-tools";
import {
  TASK_WORK_STATE,
  type TaskWorkState,
  type TaskWorkTurn,
  type TaskWorkWorker,
} from "@luke/features/tasks-view";
import { TURN_ROW, type TurnRow } from "@luke/features/turn-rows";
import { TOOL_STATE } from "@luke/panel/ai-elements/tool";
import {
  conversationOf,
  thought,
  toolCall,
  words,
  worker,
  workerCall,
  workTurn,
} from "@luke/panel/testing/task-work";
import type { WireRecord } from "@luke/wire";
import { test } from "vitest";
import { AGENT_PART, type AgentPart, agentParts, agentRows, delegates } from "./coding-agent-model";
import { delegationView, toolCallView } from "./tool-call-model";
import { sidebarCallIds, workerOf, workFailed, workRowsOf } from "./work-model";

/** What a reader scans a part as: words, a thought, a call, or a subagent. */
const SCANNED = {
  TEXT: "text",
  REASONING: "reasoning",
  CALL: "call",
  WORKER: "worker",
} as const;

/** A repository command, answered with `stdout` where it has answered. */
function command(id: string, line: string, stdout?: string): WireRecord {
  return toolCall(
    AGENT_TOOL.RUN_IN_REPOSITORY,
    id,
    { command: line },
    stdout === undefined ? {} : { output: { status: "ran", exitCode: 0, stdout, stderr: "" } },
  );
}

/** A part as a reader scans it: its kind, and what its row names. */
function scannedBlock(part: AgentPart): [string, string | undefined] {
  if (part.kind === AGENT_PART.TEXT) return [SCANNED.TEXT, part.text];
  if (part.kind === AGENT_PART.REASONING) return [SCANNED.REASONING, part.text];
  assert.ok(part.kind === AGENT_PART.TOOL);
  if (delegates(part)) return [SCANNED.WORKER, delegationView(part, undefined).task];
  return [SCANNED.CALL, toolCallView(part).subject];
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
function rowsOf(turns: readonly TaskWorkTurn[]): readonly TurnRow<AgentPart>[] {
  const [row] = workRowsOf(conversationOf(turns));
  assert.ok(row);
  return agentRows(row.message, row.moving);
}

/** The turn's calls, as the agent tab reads its parts. */
function callsOf(turns: readonly TaskWorkTurn[]) {
  const [row] = workRowsOf(conversationOf(turns));
  assert.ok(row);
  return agentParts(row.message).flatMap((part) => (part.kind === AGENT_PART.TOOL ? [part] : []));
}

test("calls next to one another fold under one line once the model moves on, and the latest group stays open while the turn moves", () => {
  const rows = rowsOf([
    workTurn(TASK_WORK_STATE.RUNNING, [
      command("a", "ls", "src"),
      command("b", "cat a.ts", "export {}"),
      words("Invites live in one file."),
      command("c", "cat b.ts"),
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
    workTurn(TASK_WORK_STATE.DONE, [
      command("a", "ls", "src"),
      words("Looking at the invites."),
      toolCall(AGENT_TOOL.SEARCH_WEB, "b", { query: "invite expiry" }, { output: {} }),
      toolCall(
        AGENT_TOOL.READ_WEB_PAGE,
        "c",
        { url: "https://example.com/docs/" },
        { output: { status: "read", text: "Seven days." } },
      ),
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
    workTurn(TASK_WORK_STATE.DONE, [
      toolCall(AGENT_TOOL.LIST_AGENTS, "a", {}, { output: [] }),
      toolCall(AGENT_TOOL.READ_AGENT, "b", { agentId: "agent-1" }, { output: {} }),
      toolCall(AGENT_TOOL.READ_AGENT, "c", { agentId: "agent-2" }, { output: {} }),
      words("Both agents are done."),
    ]),
  ]);

  assert.deepEqual(scanned(rows), [
    [
      TURN_ROW.FOLDED,
      "3 tool calls",
      [
        [SCANNED.CALL, ""],
        [SCANNED.CALL, "agent-1"],
        [SCANNED.CALL, "agent-2"],
      ],
    ],
    [SCANNED.TEXT, "Both agents are done."],
  ]);
});

test("a finished turn's fold names its subagents apart from its other calls, in the singular for one, and a subagent still running reads no differently", () => {
  const summaryOf = (turn: TaskWorkTurn) => {
    const [fold] = rowsOf([turn]);
    assert.ok(fold?.kind === TURN_ROW.FOLDED);
    return fold.summary;
  };
  const compare = worker("w1", "Compare the queues.");
  const find = worker("w2", "Find the admin check.", { state: TASK_WORK_STATE.RUNNING });

  assert.equal(
    summaryOf(
      workTurn(
        TASK_WORK_STATE.DONE,
        [
          command("a", "ls", "src"),
          workerCall(compare),
          workerCall(find),
          toolCall(EVE_TOOL.TASK_WAIT, "b", {}, { output: "1 task settled." }),
          words("Both workers are on it."),
          command("c", "cat invites.ts", "export {}"),
          words("Queue A is the one to use."),
        ],
        { workers: [compare, find] },
      ),
    ),
    "3 tool calls, 2 subagents, 1 message",
  );
  assert.equal(
    summaryOf(
      workTurn(
        TASK_WORK_STATE.DONE,
        [command("a", "ls", "src"), workerCall(compare), words("Queue A is the one to use.")],
        { workers: [compare] },
      ),
    ),
    "1 tool call, 1 subagent",
  );
  assert.equal(
    summaryOf(
      workTurn(TASK_WORK_STATE.DONE, [workerCall(compare), words("Queue A is the one to use.")], {
        workers: [compare],
      }),
    ),
    "1 subagent",
  );
});

test("a finished turn's fold names the coding agents it started apart from its tool calls and its subagents, and a start refused is a tool call", () => {
  const summaryOf = (turn: TaskWorkTurn) => {
    const [fold] = rowsOf([turn]);
    assert.ok(fold?.kind === TURN_ROW.FOLDED);
    return fold.summary;
  };
  const started = (id: string, agent: string) =>
    toolCall(
      AGENT_TOOL.START_AGENT,
      id,
      { task: "Investigate a Tailwind migration." },
      { output: { status: "accepted", agent: { id: agent, modelName: "Opus 5.5" } } },
    );
  // A start journaled under the tool's earlier name reads as one.
  const refused = toolCall(
    RETIRED_TOOL.START_CODING_AGENT,
    "r",
    { task: "Fix the invite emails." },
    { output: { status: "rejected", reason: "The plan has no repository." } },
  );
  const styling = worker("w", "Read the styling setup.");

  assert.equal(
    summaryOf(
      workTurn(
        TASK_WORK_STATE.DONE,
        [
          command("a", "ls", "src"),
          workerCall(styling),
          started("s", "agent-1"),
          toolCall(EVE_TOOL.TASK_CANCEL, "c", { taskId: "worker-1" }, { output: "Stopped." }),
          words("Started Opus 5.5 on the investigation."),
        ],
        { workers: [styling] },
      ),
    ),
    "2 tool calls, 1 subagent, 1 coding agent",
  );
  assert.equal(
    summaryOf(
      workTurn(TASK_WORK_STATE.DONE, [
        started("s1", "agent-1"),
        started("s2", "agent-2"),
        words("Started two agents."),
      ]),
    ),
    "2 coding agents",
  );
  assert.equal(
    summaryOf(workTurn(TASK_WORK_STATE.DONE, [refused, words("That did not start.")])),
    "1 tool call",
  );
});

test("a finished turn with no call ahead of its last words folds nothing: its thought and words stand at the top level", () => {
  const rows = rowsOf([
    workTurn(TASK_WORK_STATE.DONE, [
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
    workTurn(TASK_WORK_STATE.DONE, [
      thought("Find the invites."),
      command("a", "ls", "src"),
      thought("Read the one file."),
      command("b", "cat invites.ts", "export {}"),
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
  const comparing = worker("w", "Compare the queues.", {
    taskId: "worker-1",
    state: TASK_WORK_STATE.RUNNING,
  });
  const rows = rowsOf([
    workTurn(TASK_WORK_STATE.RUNNING, [workerCall(comparing), words("The worker is on it.")], {
      workers: [comparing],
    }),
  ]);
  const [row] = rows;
  assert.ok(row?.kind === TURN_ROW.BLOCK && row.block.kind === AGENT_PART.TOOL);
  assert.equal(delegates(row.block), true);
  assert.equal(row.block.state, TOOL_STATE.INPUT_AVAILABLE);
});

test("a turn still running once the call is hung up is drawn as still working, never as stopped, since Luke goes on with no call up", () => {
  const working = [workTurn(TASK_WORK_STATE.RUNNING, [command("a", "ls")])];
  const [row] = workRowsOf(conversationOf(working));
  assert.ok(row);
  assert.equal(row.state, TASK_WORK_STATE.RUNNING);
  assert.equal(row.moving, true);
});

test("a worker's session is read into parts the way a turn is, each call on its own line, and its tab finds it among the turns", () => {
  const comparing = worker("w", "Compare the queues.", {
    journal: [
      toolCall(AGENT_TOOL.SEARCH_WEB, "s1", { query: "queue revoke api" }, { output: {} }),
      toolCall(
        AGENT_TOOL.READ_WEB_PAGE,
        "s2",
        { url: "https://example.com/queue-a" },
        { output: { status: "read", text: "Admins revoke." } },
      ),
      words("Queue A lets an admin revoke."),
    ],
  });
  const rows = workRowsOf(
    conversationOf([
      workTurn(TASK_WORK_STATE.DONE, [workerCall(comparing), words("Queue A is the one to use.")], {
        workers: [comparing],
      }),
    ]),
  );

  assert.equal(workerOf(rows, "w")?.task, comparing.task);
  assert.equal(workerOf(rows, "gone"), undefined);
});

/** A worker the turn delegated to in the background, as a service that sends its own session sends it. */
function delegated(state: TaskWorkState, journal: TaskWorkWorker["journal"]): TaskWorkWorker {
  return {
    callId: "call-1",
    taskId: "delegate-7k2m9q",
    task: "Compare the two queue libraries.",
    state,
    earlierOmitted: false,
    journal,
    startedAt: 5,
    model: "openai/gpt-5.5",
    effort: "low",
  };
}

/** A turn as a service that sends its own journal sends it: the parts as the AI SDK stored them, and its workers beside them. */
function journaled(
  state: TaskWorkState,
  journal: TaskWorkTurn["journal"],
  workers: readonly TaskWorkWorker[] = [],
): TaskWorkTurn {
  return workTurn(state, journal, { workers });
}

/** The brain's background delegate as eve stores it: answered at its receipt. */
const DELEGATE_CALL = {
  type: "tool-delegate",
  toolCallId: "call-1",
  state: "output-available",
  input: { task: "Compare the two queue libraries." },
  output: "Started task delegate-7k2m9q. Its result will arrive in a <task_result> message.",
};

test("a worker delegated in the background reads as running while its own session runs, though its call answered at its receipt, and keeps running past the turn that started it", () => {
  const session = [
    {
      type: "tool-run_in_repository",
      toolCallId: "w-1",
      state: "input-available",
      input: { command: "ls vendor" },
    },
  ];
  const turns = [
    journaled(
      TASK_WORK_STATE.DONE,
      [
        DELEGATE_CALL,
        { type: "text", text: "I've asked a worker to compare them.", state: "done" },
      ],
      [delegated(TASK_WORK_STATE.RUNNING, session)],
    ),
  ];

  const [running] = callsOf(turns);
  assert.ok(running !== undefined && delegates(running));
  assert.equal(running.state, TOOL_STATE.INPUT_AVAILABLE);
  const worker = workerOf(workRowsOf(conversationOf(turns)), "call-1");
  assert.equal(worker?.call.running, true);
});

test("a worker delegated in the background names the pair its session ran on, and reads as failed where its session failed", () => {
  const turns = (state: TaskWorkState) => [
    journaled(TASK_WORK_STATE.DONE, [DELEGATE_CALL], [delegated(state, [])]),
  ];

  const [done] = callsOf(turns(TASK_WORK_STATE.DONE));
  assert.ok(done !== undefined);
  assert.equal(done.state, TOOL_STATE.OUTPUT_AVAILABLE);
  assert.deepEqual(delegationView(done, undefined).choice, {
    model: "openai/gpt-5.5",
    effort: "low",
  });

  const [failed] = callsOf(turns(TASK_WORK_STATE.FAILED));
  assert.equal(failed?.state, TOOL_STATE.OUTPUT_ERROR);
});

test("a call a turn's journal holds unanswered reads as running while the turn moves, and as having run once the turn ended, never as failed", () => {
  const turns = (state: TaskWorkState) => [
    journaled(state, [
      {
        type: "tool-run_in_repository",
        toolCallId: "a",
        state: "input-available",
        input: { command: "ls" },
      },
    ]),
  ];

  assert.deepEqual(
    callsOf(turns(TASK_WORK_STATE.RUNNING)).map((part) => [part.tool, part.state]),
    [["run_in_repository", TOOL_STATE.INPUT_AVAILABLE]],
  );
  assert.deepEqual(
    callsOf(turns(TASK_WORK_STATE.DONE)).map((part) => [part.tool, part.state]),
    [["run_in_repository", TOOL_STATE.OUTPUT_AVAILABLE]],
  );
});

test("a turn whose older steps the service left out says so, and a worker whose own session failed reads as failed rather than stopped", () => {
  const failing = worker("w", "Read the styling setup.", {
    state: TASK_WORK_STATE.FAILED,
    model: "openai/gpt-5.5",
    effort: "low",
  });
  const [row] = workRowsOf(
    conversationOf([
      workTurn(TASK_WORK_STATE.DONE, [workerCall(failing), words("It failed.")], {
        earlierOmitted: true,
        workers: [failing],
      }),
    ]),
  );

  assert.equal(row?.earlierOmitted, true);
  assert.equal(workFailed(workerOf(row === undefined ? [] : [row], "w")?.session?.record), true);
});

test("the starts of Luke's work that made a new task and his accepted section and task change calls are named by call id once answered, and no other start, refused section or task change call, call still out, or unread work names one", () => {
  const made = { status: "accepted", agent: { id: "agent-2" }, newTask: { id: "task-2" } };
  const onTask = { status: "accepted", agent: { id: "agent-3" } };
  const conversation = conversationOf([
    workTurn(TASK_WORK_STATE.DONE, [
      toolCall(AGENT_TOOL.START_AGENT, "c1", { newTask: "Expiry" }, { output: made }),
      toolCall(AGENT_TOOL.START_AGENT, "c2", {}, { output: onTask }),
      toolCall(AGENT_TOOL.START_AGENT, "c3", { newTask: "Billing" }),
      toolCall(AGENT_TOOL.ARCHIVE_AGENT, "c4", {}, { output: made }),
      toolCall(AGENT_TOOL.DELETE_SECTION, "c5", {}, { output: { status: "accepted" } }),
      toolCall(AGENT_TOOL.CREATE_SECTION, "c6", {}, { output: { status: "rejected" } }),
      toolCall(AGENT_TOOL.MOVE_TASK, "c7", {}),
      toolCall(AGENT_TOOL.UPDATE_TASK, "c8", {}, { output: { status: "accepted" } }),
      toolCall(AGENT_TOOL.UPDATE_TASK, "c9", {}, { output: { status: "rejected" } }),
    ]),
  ]);

  assert.deepEqual(sidebarCallIds(conversation), ["c1", "c5", "c8"]);
  assert.deepEqual(sidebarCallIds(undefined), []);
});
