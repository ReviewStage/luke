import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { BOARD_ELEMENT_TYPE, DRAW_ON_BOARD_TOOL_NAME } from "@sidecar/hosted/board-vocabulary";
import {
  PLAN_WORK_BOUNDS,
  PLAN_WORK_PART,
  PLAN_WORK_STATE,
  PLAN_WORK_TOOL,
  type PlanWorkPart,
  type PlanWorkTurn,
} from "@sidecar/hosted/planning-view";
import type { WireRecord } from "@sidecar/wire";
import { Effect } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { afterAll, test } from "vitest";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import { hostTurnId } from "../server/hosted/brain-host/ids";
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
import { READ_WEB_PAGE_TOOL, SEARCH_WEB_TOOL } from "../server/hosted/public-research";
import { QUEUE_QUESTION_TOOL } from "../server/hosted/queue-question";
import { REPOSITORY_SHELL_STATUS, RUN_IN_REPOSITORY_TOOL } from "../server/hosted/repository-shell";
import { SHOW_CODE_TOOL } from "../server/hosted/show-code";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import { planWorkOf } from "../server/voice/plan-work";
import { stampedEveEvent } from "./support/eve-events";
import { FIRST_EVE_TURN, parkedTurn, resumedTurn } from "./support/eve-turns";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation } from "./support/store-rows";

/**
 * One planning turn's work as the Work tab is sent it, over the real
 * migrations on PGlite: eve's events relayed through the store writer as the
 * hosted brain relays them, and the work projected from the turn row and its
 * journal as they stand. Synthetic throughout: no real repository, page, or
 * spoken word.
 */

const NOW = 1_800_000_000_000;

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await database.run(storeWriter({ tools: HOSTED_TOOL_SET }));
const relay = new StreamRelay({
  writer,
  asks: askRecord(),
  stopTurn: () => Effect.void,
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
const VALID_INPUT: ReadonlyMap<string, WireRecord> = new Map<string, WireRecord>([
  [RUN_IN_REPOSITORY_TOOL.name, { command: "ls" }],
  [SEARCH_WEB_TOOL.name, { query: "queue library comparison" }],
  [READ_WEB_PAGE_TOOL.name, { url: "https://example.com/docs" }],
  [SHOW_CODE_TOOL.name, { path: "src/invite.ts" }],
  [QUEUE_QUESTION_TOOL.name, { question: "Who can invite?", recommendation: "Admins only." }],
  [
    DRAW_ON_BOARD_TOOL_NAME,
    { elements: [{ type: BOARD_ELEMENT_TYPE.RECTANGLE, id: "api", x: 0, y: 0, label: "API" }] },
  ],
  [EVE_DELEGATION_TOOL.WORKER, { message: "Compare the two queue libraries." }],
  [EVE_DELEGATION_TOOL.TASK_CANCEL, { taskId: "task-1" }],
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
