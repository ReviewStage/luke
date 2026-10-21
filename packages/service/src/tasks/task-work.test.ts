import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { askRecord } from "@luke/database/models/asks";
import { childConversationId, hostTurnId } from "@luke/database/models/ids";
import { listJournals } from "@luke/database/models/message-reads";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import { insertConversation, openHostedStoreTestDatabase } from "@luke/database/testing";
import { LOOK_AT_BOARD_TOOL_NAME } from "@luke/features/board-vocabulary";
import { TURN_ENDING, type TurnRecord } from "@luke/features/coding-agent-wire";
import { SHOW_PAGE_TOOL_NAME } from "@luke/features/page-wire";
import { TASK_WORK_BOUNDS, TASK_WORK_STATE, type TaskWorkTurn } from "@luke/features/tasks-view";
import { isRecord, isWireString, type WireRecord, type WireValue } from "@luke/wire";
import { Effect } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { afterAll, test } from "vitest";
import { AGENT_TOOL } from "../agents/agent-runtime/tools.js";
import { BRAIN_HOST_TURN, RELAY_TURN } from "../agents/brain-host/bounds.js";
import { openChildConversation } from "../agents/brain-host/conversation.js";
import { memoryRelayState, type RelayStanding, StreamRelay } from "../agents/brain-host/relay.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { TURN_STATUS } from "../core.js";
import { stampedEveEvent } from "../testing/eve-events.js";
import { FIRST_EVE_TURN } from "../testing/eve-turns.js";
import { taskWorkOf } from "./task-work.js";

/**
 * One agent turn's work as a call is sent it, over the real migrations on
 * PGlite: eve's events relayed through the store writer as the agent's host
 * relays them, and the work projected from the turn row and its journal as
 * they stand. Synthetic throughout: no real repository, page, or spoken
 * word.
 */

const NOW = 1_800_000_000_000;

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await database.run(storeWriter({ tools: CODER_TOOL_SET }));
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

async function conversation(): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  return { userId, conversationId };
}

/** The turn's work as its record and journal now stand, read the way the voice session reads them. */
async function worked(target: ConversationTarget, standing: RelayStanding): Promise<TaskWorkTurn> {
  const turnId = hostTurnId(standing.sessionId, FIRST_EVE_TURN);
  const [turn] = await database.run(database.store.turns.named(target.userId, [turnId]));
  assert.ok(turn);
  const journal = await database.run(
    database.store.messages.byClientId(
      target.userId,
      turn.conversationId,
      CODER_TOOL_SET,
      turn.id,
    ),
  );
  assert.ok(journal.ok);
  return taskWorkOf(turn, journal.value[0]?.message);
}

test("a turn carries its own journal as the agent tab reads one, and each worker it delegated to in the background beside it: running while the worker's own session runs though the call answered at its receipt, its session's parts as stored, and done once it answers", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const task = "Compare the two queue libraries.";
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        {
          toolName: AGENT_TOOL.DELEGATE,
          input: { task },
          output:
            "Started task delegate-7k2m9q. Its result will arrive in a <task_result> message.",
        },
      ]),
      ...answeringStep(FIRST_EVE_TURN, 1, "I've asked a worker to compare them."),
    ],
    standing,
  );
  const callId = "call-0-0";
  const child = {
    userId: target.userId,
    conversationId: childConversationId(target.conversationId, callId),
  };
  await database.run(openChildConversation(target, child.conversationId, "worker"));
  const childStanding: RelayStanding = { ...standingFor(child), turn: RELAY_TURN.CHILD };
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        { toolName: AGENT_TOOL.BASH, input: { command: "ls vendor" } },
      ]),
    ],
    childStanding,
  );
  const work = async (records: ReadonlyMap<string, TurnRecord> = new Map(), failed = false) => {
    const turnId = hostTurnId(standing.sessionId, FIRST_EVE_TURN);
    const [stored] = await database.run(database.store.turns.named(target.userId, [turnId]));
    assert.ok(stored);
    const turn = failed ? { ...stored, status: TURN_STATUS.FAILED } : stored;
    const journal = await database.run(
      database.store.messages.byClientId(
        target.userId,
        turn.conversationId,
        CODER_TOOL_SET,
        turnId,
      ),
    );
    const journals = await database.run(
      listJournals(child.userId, child.conversationId, CODER_TOOL_SET, 10),
    );
    assert.ok(journal.ok && journals.ok);
    return taskWorkOf(
      turn,
      journal.value[0]?.message,
      new Map([[callId, journals.value]]),
      new Map(),
      records,
    );
  };
  const typed = (journal: readonly WireValue[] | undefined) =>
    journal?.map((part) => (isRecord(part) ? [part.type, part.text ?? part.state] : part));

  const running = await work();
  assert.equal(running.state, TASK_WORK_STATE.DONE);
  assert.deepEqual(typed(running.journal), [
    [`tool-${AGENT_TOOL.DELEGATE}`, "output-available"],
    ["text", "I've asked a worker to compare them."],
  ]);
  const [worker] = running.workers ?? [];
  assert.equal(worker?.callId, callId);
  assert.equal(worker?.taskId, "delegate-7k2m9q");
  assert.equal(worker?.task, task);
  assert.equal(worker?.state, TASK_WORK_STATE.RUNNING);
  assert.deepEqual(typed(worker?.journal), [
    [`tool-${AGENT_TOOL.BASH}`, "input-available"],
  ]);
  // A turn that failed after its receipt leaves its worker standing as its own session does.
  const [outlived] = (await work(new Map(), true)).workers ?? [];
  assert.equal(outlived?.state, TASK_WORK_STATE.RUNNING);

  await play(
    answeringStep(FIRST_EVE_TURN, 1, "Both libraries let an admin revoke."),
    childStanding,
  );
  const [answered] = (await work()).workers ?? [];
  assert.equal(answered?.state, TASK_WORK_STATE.DONE);
  assert.deepEqual(typed(answered?.journal)?.at(-1), [
    "text",
    "Both libraries let an admin revoke.",
  ]);
  const [failed] = (await work(new Map([[callId, { ending: TURN_ENDING.FAILED }]]))).workers ?? [];
  assert.equal(failed?.state, TASK_WORK_STATE.FAILED);
});

test("a worker call a retried step abandoned stops standing as running once eve runs the step again, while its turn still runs", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  await play(opening(FIRST_EVE_TURN), standing);
  // The relay's state as the step began, which is what eve hands its retry.
  const stepInput = standing.state.get();
  await play(
    callingStep(FIRST_EVE_TURN, 0, [
      { toolName: AGENT_TOOL.DELEGATE, input: { task: "Compare the two queue libraries." } },
    ]),
    standing,
  );
  const retry = { ...standing, state: memoryRelayState(stepInput) };
  await play(answeringStep(FIRST_EVE_TURN, 0, "I'll compare them myself.").slice(0, -1), retry);

  const work = await worked(target, standing);
  assert.equal(work.state, TASK_WORK_STATE.RUNNING);
  assert.deepEqual(
    work.workers?.map((worker) => [worker.callId, worker.state]),
    [["call-0-0", TASK_WORK_STATE.DONE]],
  );
});

test("a turn's journal keeps its newest parts and says older ones were left out, every string in a call cut to the bound with the call's shape kept", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const long = "x".repeat(TASK_WORK_BOUNDS.TEXT_CHARS + 50);
  const calls = Array.from({ length: TASK_WORK_BOUNDS.PARTS + 1 }, () => ({
    toolName: AGENT_TOOL.BASH,
    input: { command: long },
    output: { exitCode: 0, stdout: "ok", stderr: "" },
  }));
  await play([...opening(FIRST_EVE_TURN), ...callingStep(FIRST_EVE_TURN, 0, calls)], standing);

  const work = await worked(target, standing);
  assert.equal(work.journal?.length, TASK_WORK_BOUNDS.PARTS);
  assert.equal(work.earlierOmitted, true);
  const [first] = work.journal ?? [];
  assert.ok(isRecord(first) && isRecord(first.input) && isWireString(first.input.command));
  assert.ok(first.input.command.length <= TASK_WORK_BOUNDS.TEXT_CHARS);
  assert.equal(first.toolCallId, "call-0-1");
});

test("a turn's journal leaves out what the Mac is not sent: a page's HTML, which only the frame drawing the page reads, and the image a board look answered with", async () => {
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
        { toolName: LOOK_AT_BOARD_TOOL_NAME, input: {}, output: { image: "iVBORw0KGgo" } },
      ]),
    ],
    standing,
  );

  const { journal } = await worked(target, standing);
  const [page, look] = journal ?? [];
  assert.ok(isRecord(page) && isRecord(look));
  assert.deepEqual(page.input, { title: "Invite funnel" });
  assert.equal(look.type, `tool-${LOOK_AT_BOARD_TOOL_NAME}`);
  assert.equal(look.output, undefined);
});
