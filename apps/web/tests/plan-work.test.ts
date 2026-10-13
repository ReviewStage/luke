import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@sidecar/database/core/query";
import { askRecord } from "@sidecar/database/models/asks";
import { fillChildTitle } from "@sidecar/database/models/child-titles";
import { childConversationId, hostTurnId } from "@sidecar/database/models/ids";
import { listJournals } from "@sidecar/database/models/message-reads";
import { openPlanConversation } from "@sidecar/database/models/plan-store";
import { type ConversationTarget, storeWriter } from "@sidecar/database/models/writer";
import { messages, turns } from "@sidecar/database/schemas/storage";
import { BOARD_ELEMENT_TYPE, DRAW_ON_BOARD_TOOL_NAME } from "@sidecar/hosted/board-vocabulary";
import { TURN_ENDING } from "@sidecar/hosted/coding-agent-wire";
import { SHOW_PAGE_TOOL_NAME } from "@sidecar/hosted/page-wire";
import {
  PLAN_WORK_BOUNDS,
  PLAN_WORK_PART,
  PLAN_WORK_STATE,
  PLAN_WORK_TOOL,
  type PlanWorkAnswer,
  type PlanWorkPart,
  type PlanWorkTurn,
} from "@sidecar/hosted/planning-view";
import type { WireRecord } from "@sidecar/wire";
import { eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { afterAll, test } from "vitest";
import { ASK_ORIGIN, MESSAGE_AUTHOR, MESSAGE_CHANNEL, MESSAGE_ROLE } from "../server/core";
import { BRAIN_HOST_TURN, RELAY_TURN } from "../server/hosted/brain-host/bounds";
import { openChildConversation } from "../server/hosted/brain-host/conversation";
import {
  EVE_DELEGATION_TOOL,
  planningToolDeclarations,
} from "../server/hosted/brain-host/planning";
import {
  memoryRelayState,
  type RelayStanding,
  StreamRelay,
} from "../server/hosted/brain-host/relay";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import {
  MESSAGE_CODING_AGENT_TOOL,
  READ_CODING_AGENT_TOOL,
  START_CODING_AGENT_TOOL,
} from "../server/hosted/coding-agent-tools";
import { readPlanWork } from "../server/hosted/plan-work-store";
import { READ_WEB_PAGE_TOOL, SEARCH_WEB_TOOL } from "../server/hosted/public-research";
import { QUEUE_QUESTION_TOOL, WITHDRAW_QUESTION_TOOL } from "../server/hosted/queue-question";
import { REPOSITORY_SHELL_STATUS, RUN_IN_REPOSITORY_TOOL } from "../server/hosted/repository-shell";
import { SHOW_CODE_TOOL } from "../server/hosted/show-code";
import { planWorkOf } from "../server/voice/plan-work";
import { stampedEveEvent } from "./support/eve-events";
import {
  FIRST_EVE_TURN,
  parkedTurn,
  resumedTurn,
  spokenTurn,
  steeredTurn,
} from "./support/eve-turns";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation } from "./support/store-rows";
import { joinWorkspace, startPlan } from "./support/workspaces";

/**
 * One planning turn's work as the Work tab is sent it, over the real
 * migrations on PGlite: eve's events relayed through the store writer as the
 * hosted brain relays them, and the work projected from the turn row and its
 * journal as they stand. Synthetic throughout: no real repository, page, or
 * spoken word.
 */

const NOW = 1_800_000_000_000;

/** A worker's input as the tab reads it: JSON carrying the message it was handed. */
const decodeWorkerInput = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ message: Schema.String })),
);

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await database.run(storeWriter({ tools: HOSTED_TOOL_SET }));
const relay = new StreamRelay({
  writer,
  asks: { binding: askRecord(), stopTurn: () => Effect.void },
  now: () => NOW,
  report: () => undefined,
});

const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
  stampedEveEvent(event, NOW);

/** One tool call of a scripted step: its tool, its input, and the output it answers with, where it answers. */
interface Call {
  readonly toolName: string;
  readonly input: WireRecord;
  readonly output?: unknown;
}

const SEQUENCE = 0;

/** A step that calls the tools named, each answered where its call has an output. */
function callingStep(turnId: string, stepIndex: number, calls: readonly Call[]) {
  const ids = calls.map((_, index) => `call-${stepIndex}-${index}`);
  return [
    stamped({
      type: "step.started",
      data: { turnId, sequence: SEQUENCE, stepIndex, modelId: "m" },
    }),
    stamped({
      type: "actions.requested",
      data: {
        turnId,
        sequence: SEQUENCE,
        stepIndex,
        actions: calls.map((call, index) => ({
          kind: "tool-call" as const,
          callId: ids[index] ?? "",
          toolName: call.toolName,
          input: call.input,
        })),
      },
    }),
    ...calls.flatMap((call, index) =>
      call.output === undefined
        ? []
        : [
            stamped({
              type: "action.result",
              data: {
                turnId,
                sequence: SEQUENCE,
                stepIndex,
                status: "completed",
                result: {
                  kind: "tool-result",
                  callId: ids[index] ?? "",
                  toolName: call.toolName,
                  output: call.output,
                },
              },
            }),
          ],
    ),
  ];
}

/** The rest of a turn after its calls: one step of words, and the end. */
function answeringStep(turnId: string, stepIndex: number, words: string) {
  return [
    stamped({
      type: "step.started",
      data: { turnId, sequence: SEQUENCE, stepIndex, modelId: "m" },
    }),
    stamped({
      type: "message.completed",
      data: { turnId, sequence: SEQUENCE, stepIndex, finishReason: "stop", message: words },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence: SEQUENCE, stepIndex, finishReason: "stop" },
    }),
    stamped({ type: "turn.completed", data: { turnId, sequence: SEQUENCE } }),
  ];
}

function opening(turnId: string) {
  return [
    stamped({ type: "turn.started", data: { turnId, sequence: SEQUENCE } }),
    stamped({ type: "message.received", data: { turnId, sequence: SEQUENCE, message: "q" } }),
  ];
}

async function conversation(): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  return { userId, conversationId };
}

function standingFor(target: ConversationTarget): RelayStanding {
  return {
    sessionId: `wrun_${randomUUID()}`,
    target,
    turn: BRAIN_HOST_TURN.SPOKEN,
    model: "scripted-model",
    state: memoryRelayState(),
  };
}

async function play(events: readonly MessageStreamEvent[], standing: RelayStanding) {
  for (const event of events) await database.run(relay.handle(event, standing));
}

/** The turn's work as its record and journal now stand, read the way the voice session reads them. */
async function worked(target: ConversationTarget, standing: RelayStanding): Promise<PlanWorkTurn> {
  const turnId = hostTurnId(standing.sessionId, FIRST_EVE_TURN);
  const [turn] = await database.run(database.store.turns.named(target.userId, [turnId]));
  assert.ok(turn);
  const journal = await database.run(
    database.store.messages.byClientId(
      target.userId,
      turn.conversationId,
      HOSTED_TOOL_SET,
      turn.id,
    ),
  );
  assert.ok(journal.ok);
  return planWorkOf(turn, journal.value[0]?.message);
}

/** An input each tool's own schema takes, so the writer journals every call of a step that names them all. */
const AGENT_ID = "5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f";

const VALID_INPUT: ReadonlyMap<string, WireRecord> = new Map<string, WireRecord>([
  [RUN_IN_REPOSITORY_TOOL.name, { command: "ls" }],
  [SEARCH_WEB_TOOL.name, { query: "queue library comparison" }],
  [READ_WEB_PAGE_TOOL.name, { url: "https://example.com/docs" }],
  [SHOW_CODE_TOOL.name, { path: "src/invite.ts" }],
  [QUEUE_QUESTION_TOOL.name, { question: "Who can invite?", recommendation: "Admins only." }],
  [WITHDRAW_QUESTION_TOOL.name, { question: "Who can invite?" }],
  [
    DRAW_ON_BOARD_TOOL_NAME,
    { elements: [{ type: BOARD_ELEMENT_TYPE.RECTANGLE, id: "api", x: 0, y: 0, label: "API" }] },
  ],
  [EVE_DELEGATION_TOOL.WORKER, { message: "Compare the two queue libraries." }],
  [EVE_DELEGATION_TOOL.TASK_CANCEL, { taskId: "task-1" }],
  [READ_CODING_AGENT_TOOL.name, { agentId: AGENT_ID }],
  [MESSAGE_CODING_AGENT_TOOL.name, { agentId: AGENT_ID, text: "Also add tests." }],
  [START_CODING_AGENT_TOOL.name, { task: "Fix the invite email." }],
  [SHOW_PAGE_TOOL_NAME, { title: "Invite funnel", html: "<!doctype html><p>Funnel</p>" }],
]);

/** A part as a reader of the tab takes it in: its kind, and its words or its call's kind, subject, state, and output. */
function read(part: PlanWorkPart) {
  if (part.type !== PLAN_WORK_PART.TOOL) return [part.type, part.text];
  return [part.tool, part.subject, part.state, part.output];
}

test("a repository command reads as its command while it runs, then with its output and the exit code it failed with, and the words after it follow", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const call: Call = {
    toolName: RUN_IN_REPOSITORY_TOOL.name,
    input: { command: "grep -rn invite src" },
    output: {
      status: REPOSITORY_SHELL_STATUS.RAN,
      exitCode: 2,
      stdout: "src/invite.ts:4:export function invite()",
      stderr: "grep: src/vendor: Permission denied",
    },
  };
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [{ ...call, output: undefined }]),
    ],
    standing,
  );

  const running = await worked(target, standing);
  assert.equal(running.state, PLAN_WORK_STATE.RUNNING);
  assert.deepEqual(running.parts.map(read), [
    [PLAN_WORK_TOOL.REPOSITORY, "grep -rn invite src", PLAN_WORK_STATE.RUNNING, undefined],
  ]);

  const answer = callingStep(FIRST_EVE_TURN, 0, [call]).at(-1);
  assert.ok(answer);
  await play([answer, ...answeringStep(FIRST_EVE_TURN, 1, "Invites live in one file.")], standing);

  const done = await worked(target, standing);
  assert.equal(done.state, PLAN_WORK_STATE.DONE);
  assert.deepEqual(done.parts.map(read), [
    [
      PLAN_WORK_TOOL.REPOSITORY,
      "grep -rn invite src",
      PLAN_WORK_STATE.DONE,
      "src/invite.ts:4:export function invite()\ngrep: src/vendor: Permission denied\nExit code 2",
    ],
    [PLAN_WORK_PART.TEXT, "Invites live in one file."],
  ]);
});

test("every tool a planning turn is offered reads as a kind of its own, and a board look shows no image as its output", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const names = [
    ...planningToolDeclarations().map((tool) => tool.name),
    ...Object.values(EVE_DELEGATION_TOOL),
  ];
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(
        FIRST_EVE_TURN,
        0,
        names.map((toolName) => ({
          toolName,
          input: VALID_INPUT.get(toolName) ?? {},
          output: { image: "iVBORw0KGgo" },
        })),
      ),
    ],
    standing,
  );

  const parts = (await worked(target, standing)).parts;
  assert.deepEqual(
    parts.map((part) => part.type === PLAN_WORK_PART.TOOL && part.name),
    names,
  );
  for (const part of parts) {
    assert.equal(part.type, PLAN_WORK_PART.TOOL);
    if (part.type !== PLAN_WORK_PART.TOOL) continue;
    assert.notEqual(part.tool, PLAN_WORK_TOOL.OTHER, `${part.name} has no kind of its own`);
    if (part.tool === PLAN_WORK_TOOL.LOOK_AT_BOARD) assert.equal(part.output, undefined);
  }
});

test("a file put on screen reads as its path and lines, and a long output is cut to the bound and marked where it was cut", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const long = "x".repeat(PLAN_WORK_BOUNDS.TEXT_CHARS + 50);
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        {
          toolName: SHOW_CODE_TOOL.name,
          input: { path: "src/invite.ts", startLine: 4, endLine: 9 },
          output: { status: "accepted" },
        },
        {
          toolName: RUN_IN_REPOSITORY_TOOL.name,
          input: { command: "cat src/big.ts" },
          output: { status: REPOSITORY_SHELL_STATUS.RAN, exitCode: 0, stdout: long, stderr: "" },
        },
      ]),
    ],
    standing,
  );

  const [shown, ran] = (await worked(target, standing)).parts;
  assert.equal(shown?.type === PLAN_WORK_PART.TOOL && shown.subject, "src/invite.ts:4-9");
  assert.ok(ran?.type === PLAN_WORK_PART.TOOL);
  assert.equal(ran.output?.length, PLAN_WORK_BOUNDS.TEXT_CHARS);
  assert.ok(ran.output?.endsWith("x…"));
});

test("a page shown reads as its title, and its call carries no HTML to the Mac", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        {
          toolName: SHOW_PAGE_TOOL_NAME,
          input: { title: "Invite funnel", html: "<!doctype html><p>secret-looking page body</p>" },
          output: { status: "accepted", page: { id: "page-1", version: 1 } },
        },
      ]),
    ],
    standing,
  );

  const [shown] = (await worked(target, standing)).parts;
  assert.ok(shown?.type === PLAN_WORK_PART.TOOL);
  assert.deepEqual([shown.tool, shown.subject], [PLAN_WORK_TOOL.SHOW_PAGE, "Invite funnel"]);
  assert.ok(!shown.input.includes("page body"));
});

test("a worker handed a task longer than the bound carries it cut inside its input, so the input still reads as the message, marked where it was cut", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  // Quotes and line breaks, which the JSON escapes, so the cut has to leave room for the escapes too.
  const message = 'Compare the "two" queue libraries.\n'.repeat(
    Math.ceil(PLAN_WORK_BOUNDS.TEXT_CHARS / 20),
  );
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        { toolName: EVE_DELEGATION_TOOL.WORKER, input: { message } },
      ]),
    ],
    standing,
  );

  const [worker] = (await worked(target, standing)).parts;
  assert.ok(worker?.type === PLAN_WORK_PART.TOOL);
  assert.equal(worker.tool, PLAN_WORK_TOOL.WORKER);
  assert.ok(worker.input.length <= PLAN_WORK_BOUNDS.TEXT_CHARS);
  const { message: carried } = decodeWorkerInput(worker.input);
  assert.ok(carried.endsWith("…"));
  assert.ok(message.startsWith(carried.slice(0, -1)));
  assert.ok(carried.length > PLAN_WORK_BOUNDS.SUBJECT_CHARS, "more of the task than its subject");
});

test("a turn of more calls than a frame carries keeps its newest and says older ones were left out", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const count = PLAN_WORK_BOUNDS.PARTS + 3;
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(
        FIRST_EVE_TURN,
        0,
        Array.from({ length: count }, (_, index) => ({
          toolName: RUN_IN_REPOSITORY_TOOL.name,
          input: { command: `cat file-${index}` },
        })),
      ),
    ],
    standing,
  );

  const work = await worked(target, standing);
  assert.equal(work.earlierOmitted, true);
  assert.equal(work.parts.length, PLAN_WORK_BOUNDS.PARTS);
  const [first] = work.parts;
  assert.equal(first?.type === PLAN_WORK_PART.TOOL && first.subject, "cat file-3");
});

test("the worker reads as running while its turn is parked on it, and as done once its findings resume the turn", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  await play(parkedTurn(FIRST_EVE_TURN, SEQUENCE, NOW), standing);

  const parked = await worked(target, standing);
  assert.deepEqual(
    parked.parts.map((part) => read(part).slice(0, 3)),
    [
      [PLAN_WORK_TOOL.WORKER, "Compare the two queue libraries.", PLAN_WORK_STATE.RUNNING],
      [PLAN_WORK_PART.TEXT, "The worker is on it."],
    ],
  );

  await play(resumedTurn(FIRST_EVE_TURN, SEQUENCE, 2, NOW), standing);
  const resumed = await worked(target, standing);
  assert.equal(resumed.state, PLAN_WORK_STATE.DONE);
  assert.deepEqual(
    resumed.parts.map((part) => (part.type === PLAN_WORK_PART.TOOL ? part.state : part.text)),
    [PLAN_WORK_STATE.DONE, "The worker is on it.", "Found it."],
  );
});

test("a worker's start and the stop of its task carry the task, so the stop names the subagent it stopped; a call that touches no task carries none", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        {
          toolName: EVE_DELEGATION_TOOL.WORKER,
          input: { message: "Read the styling setup." },
          output:
            "Started task worker-13zmbg. Its result will arrive in a <task_result> message. To send it another message, call worker again with taskId worker-13zmbg.",
        },
      ]),
      ...callingStep(FIRST_EVE_TURN, 1, [
        { toolName: START_CODING_AGENT_TOOL.name, input: { task: "Investigate." }, output: {} },
        {
          toolName: EVE_DELEGATION_TOOL.TASK_CANCEL,
          input: { taskId: "worker-13zmbg" },
          output: "Stopped worker-13zmbg's current work; it won't report back.",
        },
      ]),
      ...answeringStep(FIRST_EVE_TURN, 2, "Started Opus 5.5 on it."),
    ],
    standing,
  );

  const work = await worked(target, standing);
  assert.deepEqual(
    work.parts.map((part) => (part.type === PLAN_WORK_PART.TOOL ? [part.tool, part.task] : [])),
    [
      [PLAN_WORK_TOOL.WORKER, "worker-13zmbg"],
      [PLAN_WORK_TOOL.START_AGENT, undefined],
      [PLAN_WORK_TOOL.WORKER_CANCEL, "worker-13zmbg"],
      [],
    ],
  );
});

test("a turn says when it ended once it has, and no end while it runs", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        { toolName: RUN_IN_REPOSITORY_TOOL.name, input: { command: "ls" } },
      ]),
    ],
    standing,
  );
  await askedAt(standing, NOW - 78_000);
  const running = await worked(target, standing);
  assert.equal(running.startedAt, NOW - 78_000);
  assert.equal(running.endedAt, undefined);

  const answer = callingStep(FIRST_EVE_TURN, 0, [
    {
      toolName: RUN_IN_REPOSITORY_TOOL.name,
      input: { command: "ls" },
      output: { status: REPOSITORY_SHELL_STATUS.RAN, exitCode: 0, stdout: "src", stderr: "" },
    },
  ]).at(-1);
  assert.ok(answer);
  await play([answer, ...answeringStep(FIRST_EVE_TURN, 1, "One folder.")], standing);
  const done = await worked(target, standing);
  assert.equal(done.state, PLAN_WORK_STATE.DONE);
  assert.equal(done.endedAt, NOW);
});

/** A step of words whose model counted the tokens given, and the end given after it. */
function countedStep(turnId: string, end: MessageStreamEvent): MessageStreamEvent[] {
  return [
    stamped({
      type: "step.started",
      data: { turnId, sequence: SEQUENCE, stepIndex: 0, modelId: "m" },
    }),
    stamped({
      type: "message.completed",
      data: { turnId, sequence: SEQUENCE, stepIndex: 0, finishReason: "stop", message: "Done." },
    }),
    stamped({
      type: "step.completed",
      data: {
        turnId,
        sequence: SEQUENCE,
        stepIndex: 0,
        finishReason: "stop",
        usage: {
          inputTokens: 1_200,
          outputTokens: 80,
          cacheReadTokens: 1_000,
          cacheWriteTokens: 150,
        },
      },
    }),
    end,
  ];
}

test("a finished turn's work says the model and effort it ran on and the tokens it spent, and how it ended where it did not simply answer", async () => {
  const endedWith = async (end: MessageStreamEvent) => {
    const target = await conversation();
    const standing: RelayStanding = {
      ...standingFor(target),
      model: "gpt-6.1-sol",
      reasoningEffort: "high",
    };
    await play([...opening(FIRST_EVE_TURN), ...countedStep(FIRST_EVE_TURN, end)], standing);
    const { model, effort, tokens, ending } = await worked(target, standing);
    return { model, effort, tokens, ending };
  };
  const tokens = {
    inputTokens: 1_200,
    outputTokens: 80,
    cachedInputTokens: 1_000,
    cacheWriteTokens: 150,
  };

  assert.deepEqual(
    await endedWith(
      stamped({ type: "turn.completed", data: { turnId: FIRST_EVE_TURN, sequence: SEQUENCE } }),
    ),
    { model: "openai/gpt-6.1-sol", effort: "high", tokens, ending: undefined },
  );
  assert.equal(
    (
      await endedWith(
        stamped({ type: "turn.cancelled", data: { turnId: FIRST_EVE_TURN, sequence: SEQUENCE } }),
      )
    ).ending,
    TURN_ENDING.STOPPED,
  );
  assert.equal(
    (
      await endedWith(
        stamped({
          type: "turn.failed",
          data: {
            turnId: FIRST_EVE_TURN,
            sequence: SEQUENCE,
            code: "model_error",
            message: "upstream failed",
          },
        }),
      )
    ).ending,
    TURN_ENDING.FAILED,
  );
});

test("a turn still running says the model it runs on but no tokens and no ending yet", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  await play(opening(FIRST_EVE_TURN), standing);
  const running = await worked(target, standing);
  assert.equal(running.model, "openai/scripted-model");
  assert.equal(running.tokens, undefined);
  assert.equal(running.ending, undefined);
});

test("a call the turn ended without answering says it may have run rather than that it failed, and the turn reads as failed", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        { toolName: RUN_IN_REPOSITORY_TOOL.name, input: { command: "ls" } },
      ]),
      stamped({
        type: "turn.failed",
        data: {
          turnId: FIRST_EVE_TURN,
          sequence: SEQUENCE,
          code: "model_error",
          message: "upstream failed",
        },
      }),
    ],
    standing,
  );

  const work = await worked(target, standing);
  assert.equal(work.state, PLAN_WORK_STATE.FAILED);
  const [call] = work.parts;
  assert.ok(call?.type === PLAN_WORK_PART.TOOL);
  assert.equal(call.state, PLAN_WORK_STATE.DONE);
  assert.match(call.output ?? "", /it may have run/);
});

test("a worker's call carries the worker's own session, read from its child conversation: what it searched, read, and ran, and its findings, running while the worker does", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  await play(parkedTurn(FIRST_EVE_TURN, SEQUENCE, NOW), standing);
  const [worker] = (await worked(target, standing)).parts;
  assert.ok(worker?.type === PLAN_WORK_PART.TOOL);

  // The worker's session, relayed into the child conversation of the call that started it.
  const child = {
    userId: target.userId,
    conversationId: childConversationId(target.conversationId, worker.id),
  };
  await database.run(openChildConversation(target, child.conversationId, "worker"));
  const childStanding: RelayStanding = { ...standingFor(child), turn: RELAY_TURN.CHILD };
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        {
          toolName: SEARCH_WEB_TOOL.name,
          input: { query: "invite revoke api" },
          output: { status: "found" },
        },
        { toolName: RUN_IN_REPOSITORY_TOOL.name, input: { command: "ls vendor" } },
      ]),
    ],
    childStanding,
  );
  const childJournals = async () => {
    const read = await database.run(
      listJournals(child.userId, child.conversationId, HOSTED_TOOL_SET, 10),
    );
    assert.ok(read.ok);
    return read.value;
  };
  const projected = async () => {
    const turnId = hostTurnId(standing.sessionId, FIRST_EVE_TURN);
    const [turn] = await database.run(database.store.turns.named(target.userId, [turnId]));
    assert.ok(turn);
    const journal = await database.run(
      database.store.messages.byClientId(
        target.userId,
        turn.conversationId,
        HOSTED_TOOL_SET,
        turn.id,
      ),
    );
    assert.ok(journal.ok);
    const [drawn] = planWorkOf(
      turn,
      journal.value[0]?.message,
      new Map([[worker.id, await childJournals()]]),
    ).parts;
    assert.ok(drawn?.type === PLAN_WORK_PART.TOOL);
    return drawn.session?.parts.map((part) =>
      part.type === PLAN_WORK_PART.TOOL
        ? [part.tool, part.subject, part.state]
        : [part.type, part.text],
    );
  };

  assert.deepEqual(await projected(), [
    [PLAN_WORK_TOOL.SEARCH_WEB, "invite revoke api", PLAN_WORK_STATE.DONE],
    [PLAN_WORK_TOOL.REPOSITORY, "ls vendor", PLAN_WORK_STATE.RUNNING],
  ]);

  await play(
    answeringStep(FIRST_EVE_TURN, 1, "Both libraries let an admin revoke."),
    childStanding,
  );
  const findings = await projected();
  assert.deepEqual(findings?.at(-1), [PLAN_WORK_PART.TEXT, "Both libraries let an admin revoke."]);
});

test("a worker's session says when its task began, which a running worker counts from, and when it answered once it has", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  await play(parkedTurn(FIRST_EVE_TURN, SEQUENCE, NOW), standing);
  const [worker] = (await worked(target, standing)).parts;
  assert.ok(worker?.type === PLAN_WORK_PART.TOOL);
  const child = {
    userId: target.userId,
    conversationId: childConversationId(target.conversationId, worker.id),
  };
  await database.run(openChildConversation(target, child.conversationId, "worker"));
  const childStanding: RelayStanding = { ...standingFor(child), turn: RELAY_TURN.CHILD };
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        { toolName: RUN_IN_REPOSITORY_TOOL.name, input: { command: "ls vendor" } },
      ]),
    ],
    childStanding,
  );
  // The journal's stamps are the writer's clock, which this database leaves real, so the test sets them.
  const stamp = (set: { createdAt?: Date; finishedAt?: Date }) =>
    database.run(
      db.update(messages).set(set).where(eq(messages.conversationId, child.conversationId)),
    );
  const session = async () => {
    const turnId = hostTurnId(standing.sessionId, FIRST_EVE_TURN);
    const [turn] = await database.run(database.store.turns.named(target.userId, [turnId]));
    assert.ok(turn);
    const journal = await database.run(
      database.store.messages.byClientId(
        target.userId,
        turn.conversationId,
        HOSTED_TOOL_SET,
        turnId,
      ),
    );
    const journals = await database.run(
      listJournals(child.userId, child.conversationId, HOSTED_TOOL_SET, 10),
    );
    assert.ok(journal.ok && journals.ok);
    const [drawn] = planWorkOf(
      turn,
      journal.value[0]?.message,
      new Map([[worker.id, journals.value]]),
    ).parts;
    assert.ok(drawn?.type === PLAN_WORK_PART.TOOL);
    return drawn.session;
  };

  await stamp({ createdAt: new Date(NOW - 42_000) });
  const running = await session();
  assert.equal(running?.startedAt, NOW - 42_000);
  assert.equal(running?.endedAt, undefined);

  await play(answeringStep(FIRST_EVE_TURN, 1, "Vendor holds two libraries."), childStanding);
  await stamp({ finishedAt: new Date(NOW) });
  const answered = await session();
  assert.equal(answered?.startedAt, NOW - 42_000);
  assert.equal(answered?.endedAt, NOW);
});

/** Lines a `show_code` call answered with, as its journal keeps them. */
function shownAt(path: string, line: string) {
  return {
    ref: { path, startLine: 1, endLine: 1 },
    repository: "acme/web",
    firstLine: 1,
    lineCount: 1,
    lines: [line],
  };
}

/** A plan of a new account, with the conversation its planning model runs in. */
async function planConversation(): Promise<
  ConversationTarget & { planId: string; workspaceId: string }
> {
  const userId = await database.createUser();
  const plan = await database.run(startPlan(userId, { name: "Teammate invitations" }));
  const opened = await database.run(openPlanConversation(userId, plan.id));
  assert.ok(Option.isSome(opened));
  return {
    userId,
    conversationId: opened.value.conversationId,
    planId: plan.id,
    workspaceId: plan.workspaceId,
  };
}

/**
 * Stamps a played turn as asked and started at `at`, so the turns of a plan
 * read in the order they were asked; the row's own queue stamp is the
 * database's clock, which a test does not hold.
 */
async function askedAt(standing: RelayStanding, at: number): Promise<void> {
  await database.run(
    db
      .update(turns)
      .set({ queuedAt: new Date(at), startedAt: new Date(at) })
      .where(eq(turns.id, hostTurnId(standing.sessionId, FIRST_EVE_TURN))),
  );
}

/** The code a read answered, by the call and turn that showed it, as the tab would tell them apart. */
function shownBy(read: Option.Option<PlanWorkAnswer>) {
  assert.ok(Option.isSome(read));
  return (read.value.code ?? []).map(({ callId, turnId, code }) => [callId, turnId, code]);
}

test("a plan's work reads back from its conversation after the call: its turns oldest first and every code shown with Luke's note, several of one file included, for the account that owns it alone", async () => {
  const target = await planConversation();
  const first = standingFor(target);
  const second = standingFor(target);
  const old = shownAt("src/old.ts", "old");
  const note = "Every invite starts here, so expiry belongs in this function.";
  const invite = { ...shownAt("src/invite.ts", "export function invite() {}"), note };
  const revoke = shownAt("src/invite.ts", "export function revoke() {}");
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        // A call journaled before notes were asked for carries none, and still reads.
        {
          toolName: SHOW_CODE_TOOL.name,
          input: { path: "src/old.ts" },
          output: { status: "accepted", code: old },
        },
        {
          toolName: SHOW_CODE_TOOL.name,
          input: { path: "src/invite.ts", note },
          output: { status: "accepted", code: invite },
        },
      ]),
      ...answeringStep(FIRST_EVE_TURN, 1, "Invites live in one file."),
    ],
    first,
  );
  await askedAt(first, NOW - 60_000);
  // A showing that was refused shows nothing, and the one after it shows the same file again.
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        {
          toolName: SHOW_CODE_TOOL.name,
          input: { path: "src/missing.ts" },
          output: { status: "rejected", reason: "Not shown: no such file in the repository." },
        },
        {
          toolName: SHOW_CODE_TOOL.name,
          input: { path: "src/invite.ts" },
          output: { status: "accepted", code: revoke },
        },
      ]),
      ...answeringStep(FIRST_EVE_TURN, 1, "Expiry is seven days."),
    ],
    second,
  );
  await askedAt(second, NOW);

  const read = await database.run(readPlanWork(target.userId, target.planId, undefined));
  assert.ok(Option.isSome(read));
  assert.deepEqual(
    read.value.turns.map((turn) => [turn.state, turn.parts.at(-1)]),
    [
      [PLAN_WORK_STATE.DONE, { type: PLAN_WORK_PART.TEXT, text: "Invites live in one file." }],
      [PLAN_WORK_STATE.DONE, { type: PLAN_WORK_PART.TEXT, text: "Expiry is seven days." }],
    ],
  );
  assert.equal(read.value.earlier, undefined);
  const firstTurn = hostTurnId(first.sessionId, FIRST_EVE_TURN);
  const secondTurn = hostTurnId(second.sessionId, FIRST_EVE_TURN);
  assert.deepEqual(shownBy(read), [
    ["call-0-0", firstTurn, old],
    ["call-0-1", firstTurn, invite],
    ["call-0-1", secondTurn, revoke],
  ]);
  const stranger = await database.createUser();
  assert.ok(Option.isNone(await database.run(readPlanWork(stranger, target.planId, undefined))));
});

/**
 * A spoken ask on the plan's conversation, as the voice leaves it: the ask
 * under its delegation's id, dispatched into the standing's eve session, and
 * the developer's lines the delegation was about, written and attached to it.
 */
async function spokenAsk(
  target: ConversationTarget,
  standing: RelayStanding,
  lines: readonly (readonly [rowId: string, text: string, fromMs: number])[],
): Promise<void> {
  const delegationId = `dl_${randomUUID()}`;
  const record = askRecord();
  const ask = await database.run(
    record.record({
      ...target,
      clientId: delegationId,
      origin: ASK_ORIGIN.SPOKEN,
      createdAt: new Date(NOW),
    }),
  );
  await database.run(
    record.dispatchOnce(target, ask.id, () =>
      Effect.succeed({ sessionId: standing.sessionId, deliveryId: delegationId }),
    ),
  );
  for (const [clientId, text, fromMs] of lines) {
    await database.run(
      writer.upsertSpokenRow(target, {
        role: MESSAGE_ROLE.USER,
        clientId,
        text,
        metadata: {
          author: MESSAGE_AUTHOR.DEVELOPER,
          channel: MESSAGE_CHANNEL.VOICE,
          from_ms: fromMs,
          to_ms: fromMs + 900,
        },
      }),
    );
  }
  await database.run(
    writer.attachSpokenAsk(target, { delegationId, rowIds: lines.map(([rowId]) => rowId) }),
  );
  await play(spokenTurn(FIRST_EVE_TURN, NOW, [delegationId]), standing);
}

test("a plan's work read back names the developer's spoken lines each turn took as its ask, in the order they were said however late one was written, and a turn no spoken line opened names none", async () => {
  const target = await planConversation();
  const spoken = standingFor(target);
  const typed = { ...standingFor(target), turn: BRAIN_HOST_TURN.TYPED };
  // The later line is written first, as a fragment of the earlier one arriving late leaves them.
  await spokenAsk(target, spoken, [
    ["row-check", "Check how removal works.", 4_000],
    ["row-who", "Who can withdraw an invite?", 1_000],
  ]);
  await askedAt(spoken, NOW - 60_000);
  await play([...opening(FIRST_EVE_TURN), ...answeringStep(FIRST_EVE_TURN, 0, "Done.")], typed);
  await askedAt(typed, NOW);

  const read = await database.run(readPlanWork(target.userId, target.planId, undefined));
  assert.ok(Option.isSome(read));
  assert.deepEqual(
    read.value.turns.map((turn) => turn.asked),
    [["row-who", "row-check"], undefined],
  );
  const stranger = await database.createUser();
  const turnId = hostTurnId(spoken.sessionId, FIRST_EVE_TURN);
  const theirs = await database.run(
    database.store.messages.spokenAskRows(stranger, target.conversationId, [turnId]),
  );
  assert.equal(theirs.size, 0, "another account reads none of the plan's lines");
});

test("a plan's work reads the same for every member of its workspace, whichever member opened its conversation", async () => {
  const target = await planConversation();
  const teammate = await database.createUser();
  await database.run(joinWorkspace(target.workspaceId, teammate));
  const shown = shownAt("src/invite.ts", "export function invite() {}");
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        {
          toolName: SHOW_CODE_TOOL.name,
          input: { path: "src/invite.ts" },
          output: { status: "accepted", code: shown },
        },
      ]),
      ...answeringStep(FIRST_EVE_TURN, 1, "Invites live in one file."),
    ],
    standingFor(target),
  );

  const opener = await database.run(readPlanWork(target.userId, target.planId, undefined));
  const member = await database.run(readPlanWork(teammate, target.planId, undefined));
  assert.ok(Option.isSome(member));
  assert.deepEqual(
    member.value.turns.map((turn) => turn.parts.at(-1)),
    [{ type: PLAN_WORK_PART.TEXT, text: "Invites live in one file." }],
  );
  assert.deepEqual(
    (member.value.code ?? []).map((each) => each.code),
    [shown],
  );
  assert.deepEqual(member, opener);
});

test("a plan of more turns than a page reads its newest first, then each older page before the oldest turn read, every code coming with the newest", async () => {
  const target = await planConversation();
  const count = PLAN_WORK_BOUNDS.TURNS + 2;
  const standings = Array.from({ length: count }, () => standingFor(target));
  for (const [index, standing] of standings.entries()) {
    await play(
      [
        ...opening(FIRST_EVE_TURN),
        ...callingStep(FIRST_EVE_TURN, 0, [
          {
            toolName: SHOW_CODE_TOOL.name,
            input: { path: "src/invite.ts" },
            output: { status: "accepted", code: shownAt("src/invite.ts", `line ${index}`) },
          },
        ]),
        ...answeringStep(FIRST_EVE_TURN, 1, `Turn ${index}.`),
      ],
      standing,
    );
    await askedAt(standing, NOW + index * 1_000);
  }
  const words = (read: Option.Option<PlanWorkAnswer>) => {
    assert.ok(Option.isSome(read));
    return read.value.turns.map((turn) => {
      const last = turn.parts.at(-1);
      return last?.type === PLAN_WORK_PART.TEXT ? last.text : undefined;
    });
  };

  const newest = await database.run(readPlanWork(target.userId, target.planId, undefined));
  assert.ok(Option.isSome(newest));
  assert.deepEqual(
    words(newest),
    Array.from({ length: PLAN_WORK_BOUNDS.TURNS }, (_, at) => `Turn ${at + 2}.`),
  );
  assert.equal(shownBy(newest).length, count);
  const older = await database.run(
    readPlanWork(target.userId, target.planId, newest.value.earlier),
  );
  assert.deepEqual(words(older), ["Turn 0.", "Turn 1."]);
  assert.ok(Option.isSome(older));
  assert.equal(older.value.earlier, undefined);
  assert.equal(older.value.code, undefined);
});

test("a plan never planned on reads as no work, and a secret file a journal holds is not read back as code", async () => {
  const userId = await database.createUser();
  const fresh = await database.run(startPlan(userId, { name: "Billing export" }));
  assert.deepEqual(
    await database.run(readPlanWork(userId, fresh.id, undefined)),
    Option.some({ turns: [], code: [] }),
  );

  const target = await planConversation();
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        {
          toolName: SHOW_CODE_TOOL.name,
          input: { path: ".env.local" },
          output: { status: "accepted", code: shownAt(".env.local", "SECRET=synthetic") },
        },
      ]),
    ],
    standingFor(target),
  );
  const read = await database.run(readPlanWork(target.userId, target.planId, undefined));
  assert.ok(Option.isSome(read));
  assert.equal(read.value.turns.length, 1);
  assert.deepEqual(read.value.code, []);
});

test("a plan's work read back carries each worker's own session from its child conversation", async () => {
  const target = await planConversation();
  const standing = standingFor(target);
  await play(parkedTurn(FIRST_EVE_TURN, SEQUENCE, NOW), standing);
  const [worker] = (await worked(target, standing)).parts;
  assert.ok(worker?.type === PLAN_WORK_PART.TOOL);
  const child = {
    userId: target.userId,
    conversationId: childConversationId(target.conversationId, worker.id),
  };
  await database.run(openChildConversation(target, child.conversationId, "worker"));
  await play(
    [...opening(FIRST_EVE_TURN), ...answeringStep(FIRST_EVE_TURN, 0, "Both libraries revoke.")],
    { ...standingFor(child), turn: RELAY_TURN.CHILD },
  );

  const read = await database.run(readPlanWork(target.userId, target.planId, undefined));
  assert.ok(Option.isSome(read));
  const [drawn] = read.value.turns[0]?.parts ?? [];
  assert.ok(drawn?.type === PLAN_WORK_PART.TOOL);
  assert.deepEqual(drawn.session?.parts.at(-1), {
    type: PLAN_WORK_PART.TEXT,
    text: "Both libraries revoke.",
  });
});

test("a plan's work read back names the model a worker's newest task ran on, as the catalog names it, and none for a worker whose turn named none", async () => {
  const sessionOn = async (model: string | undefined) => {
    const target = await planConversation();
    const standing = standingFor(target);
    await play(parkedTurn(FIRST_EVE_TURN, SEQUENCE, NOW), standing);
    const [worker] = (await worked(target, standing)).parts;
    assert.ok(worker?.type === PLAN_WORK_PART.TOOL);
    const child = {
      userId: target.userId,
      conversationId: childConversationId(target.conversationId, worker.id),
    };
    await database.run(openChildConversation(target, child.conversationId, "worker"));
    const { model: _scripted, ...childStanding } = standingFor(child);
    await play(
      [...opening(FIRST_EVE_TURN), ...answeringStep(FIRST_EVE_TURN, 0, "Both libraries revoke.")],
      {
        ...childStanding,
        ...(model === undefined ? undefined : { model }),
        turn: RELAY_TURN.CHILD,
      },
    );
    const read = await database.run(readPlanWork(target.userId, target.planId, undefined));
    assert.ok(Option.isSome(read));
    const [drawn] = read.value.turns[0]?.parts ?? [];
    assert.ok(drawn?.type === PLAN_WORK_PART.TOOL && drawn.session !== undefined);
    return drawn.session;
  };

  assert.equal((await sessionOn("gpt-6.1-sol")).model, "openai/gpt-6.1-sol");
  assert.equal((await sessionOn(undefined)).model, undefined);
});

test("a plan's work read back says what a worker's finished task spent and how it ended", async () => {
  const target = await planConversation();
  const standing = standingFor(target);
  await play(parkedTurn(FIRST_EVE_TURN, SEQUENCE, NOW), standing);
  const [worker] = (await worked(target, standing)).parts;
  assert.ok(worker?.type === PLAN_WORK_PART.TOOL);
  const child = {
    userId: target.userId,
    conversationId: childConversationId(target.conversationId, worker.id),
  };
  await database.run(openChildConversation(target, child.conversationId, "worker"));
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...countedStep(
        FIRST_EVE_TURN,
        stamped({ type: "turn.cancelled", data: { turnId: FIRST_EVE_TURN, sequence: SEQUENCE } }),
      ),
    ],
    { ...standingFor(child), reasoningEffort: "low", turn: RELAY_TURN.CHILD },
  );

  const read = await database.run(readPlanWork(target.userId, target.planId, undefined));
  assert.ok(Option.isSome(read));
  const [drawn] = read.value.turns[0]?.parts ?? [];
  assert.ok(drawn?.type === PLAN_WORK_PART.TOOL && drawn.session !== undefined);
  const { effort, tokens, ending } = drawn.session;
  assert.deepEqual(
    { effort, tokens, ending },
    {
      effort: "low",
      tokens: {
        inputTokens: 1_200,
        outputTokens: 80,
        cachedInputTokens: 1_000,
        cacheWriteTokens: 150,
      },
      ending: TURN_ENDING.STOPPED,
    },
  );
});

test("a plan's work read back carries a worker's title from its child conversation, on the call that started it and on a later call steering the same task; an untitled worker carries none", async () => {
  const target = await planConversation();
  const first = standingFor(target);
  await play(parkedTurn(FIRST_EVE_TURN, SEQUENCE, NOW), first);
  await askedAt(first, NOW - 1_000);
  const later = standingFor(target);
  await play(steeredTurn(FIRST_EVE_TURN, SEQUENCE, NOW), later);
  await askedAt(later, NOW);
  const [starter] = (await worked(target, first)).parts;
  assert.ok(starter?.type === PLAN_WORK_PART.TOOL);
  const child = {
    userId: target.userId,
    conversationId: childConversationId(target.conversationId, starter.id),
  };
  await database.run(openChildConversation(target, child.conversationId, "worker"));
  await play(
    [...opening(FIRST_EVE_TURN), ...answeringStep(FIRST_EVE_TURN, 0, "Both libraries revoke.")],
    { ...standingFor(child), turn: RELAY_TURN.CHILD },
  );
  const sessionTitles = async () => {
    const read = await database.run(readPlanWork(target.userId, target.planId, undefined));
    assert.ok(Option.isSome(read));
    return read.value.turns.map((turn) => {
      const [drawn] = turn.parts;
      return drawn?.type === PLAN_WORK_PART.TOOL ? drawn.session?.title : undefined;
    });
  };
  assert.deepEqual(await sessionTitles(), [undefined, undefined]);

  await database.run(fillChildTitle(target, child.conversationId, "Token revocation libraries"));
  assert.deepEqual(await sessionTitles(), [
    "Token revocation libraries",
    "Token revocation libraries",
  ]);
});

test("a worker sent more work in a later turn reads the session of the call that started its task, where eve records that work", async () => {
  const target = await planConversation();
  const first = standingFor(target);
  await play(parkedTurn(FIRST_EVE_TURN, SEQUENCE, NOW), first);
  await askedAt(first, NOW - 1_000);
  const [starter] = (await worked(target, first)).parts;
  assert.ok(starter?.type === PLAN_WORK_PART.TOOL);

  // A later turn steers the same task, and eve hands the work to the task's standing session.
  const later = standingFor(target);
  await play(steeredTurn(FIRST_EVE_TURN, SEQUENCE, NOW), later);
  await askedAt(later, NOW);
  const child = {
    userId: target.userId,
    conversationId: childConversationId(target.conversationId, starter.id),
  };
  await database.run(openChildConversation(target, child.conversationId, "worker"));
  const childStanding: RelayStanding = { ...standingFor(child), turn: RELAY_TURN.CHILD };
  await play(
    [...opening(FIRST_EVE_TURN), ...answeringStep(FIRST_EVE_TURN, 0, "Both libraries revoke.")],
    childStanding,
  );
  await play(
    [...opening("turn_1"), ...answeringStep("turn_1", 0, "Only the second one batches.")],
    childStanding,
  );

  const read = await database.run(readPlanWork(target.userId, target.planId, undefined));
  assert.ok(Option.isSome(read));
  const [, steered] = read.value.turns;
  const [drawn] = steered?.parts ?? [];
  assert.ok(drawn?.type === PLAN_WORK_PART.TOOL);
  assert.equal(drawn.tool, PLAN_WORK_TOOL.WORKER);
  assert.deepEqual(drawn.session?.parts.at(-1), {
    type: PLAN_WORK_PART.TEXT,
    text: "Only the second one batches.",
  });
});

test("a skill the planning model loads is written and reaches the Work tab as a call every desktop reads, named load_skill with the skill as its subject", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const turnId = FIRST_EVE_TURN;
  const data = { turnId, sequence: SEQUENCE, stepIndex: 0 };
  await play(
    [
      ...opening(turnId),
      stamped({ type: "step.started", data: { ...data, modelId: "m" } }),
      stamped({
        type: "actions.requested",
        data: {
          ...data,
          actions: [
            { kind: "load-skill", callId: "call-skill", input: { skill: "release-notes" } },
          ],
        },
      }),
      stamped({
        type: "action.result",
        data: {
          ...data,
          status: "completed",
          result: {
            kind: "load-skill-result",
            callId: "call-skill",
            output: "One line per change.",
          },
        },
      }),
      stamped({ type: "step.completed", data: { ...data, finishReason: "tool-calls" } }),
      ...answeringStep(turnId, 1, "Loaded the release notes skill."),
    ],
    standing,
  );

  const turn = await worked(target, standing);
  const loads = turn.parts.filter((part) => part.type === PLAN_WORK_PART.TOOL);
  assert.deepEqual(
    loads.map((part) =>
      part.type === PLAN_WORK_PART.TOOL ? [part.tool, part.name, part.subject, part.state] : [],
    ),
    [[PLAN_WORK_TOOL.OTHER, "load_skill", "release-notes", PLAN_WORK_STATE.DONE]],
  );
});
