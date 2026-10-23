import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { askRecord } from "@luke/database/models/asks";
import { hostTurnId } from "@luke/database/models/ids";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import { insertConversation, openHostedStoreTestDatabase } from "@luke/database/testing";
import { TURN_END, TURN_EVENT_KIND, TURN_SLOW_STEP, type TurnEvent } from "@luke/features";
import type { ToolSet } from "ai";
import { Effect } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { afterAll, test } from "vitest";
import { BRAIN_RUN_EVENT, TURN_STATUS } from "../core.js";
import { stampedEveEvent } from "../testing/eve-events.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import { BRAIN_HOST_TURN } from "./brain-host/bounds.js";
import { memoryRelayState, type RelayStanding, StreamRelay } from "./brain-host/relay.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import { projectTurnEvents } from "./turn-events.js";

/**
 * A turn's events over the real migrations on PGlite, with the turn written
 * the way the hosted brain writes one: eve's events relayed through the store
 * writer, and the projection read over the turn row and its journal as they
 * stand. What these tests hold to is that the projection only grows: what a
 * reader heard mid-turn stays where it was numbered, and the rest follows
 * once the turn ends. Synthetic throughout — no real title, branch, or
 * spoken word.
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

async function conversation(): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  return { userId, conversationId };
}

const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
  stampedEveEvent(event, NOW);

const EVE_TURN = "turn_0";

/** One spoken ask's turn as eve emits it: a shell command, then a two-sentence answer. */
function spokenTurn(
  turnId: string,
  shell: string = AGENT_TOOL.BASH,
): readonly MessageStreamEvent[] {
  const sequence = 0;
  return [
    stamped({ type: "turn.started", data: { turnId, sequence } }),
    stamped({ type: "message.received", data: { turnId, sequence, message: "what changed?" } }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 0, modelId: "m" } }),
    stamped({
      type: "actions.requested",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        actions: [
          {
            kind: "tool-call",
            callId: "call-1",
            toolName: shell,
            input: { command: "ls" },
          },
        ],
      },
    }),
    stamped({
      type: "action.result",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        status: "completed",
        result: {
          kind: "tool-result",
          callId: "call-1",
          toolName: shell,
          output: {
            exitCode: 0,
            stdout: "README.md\n",
            stderr: "",
          },
        },
      },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 0, finishReason: "tool-calls" },
    }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 1, modelId: "m" } }),
    stamped({
      type: "message.completed",
      data: {
        turnId,
        sequence,
        stepIndex: 1,
        finishReason: "stop",
        message: "One agent finished. Another is waiting on you.",
      },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 1, finishReason: "stop" },
    }),
    stamped({ type: "turn.completed", data: { turnId, sequence } }),
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

async function play(
  events: readonly MessageStreamEvent[],
  standing: RelayStanding,
  over: StreamRelay = relay,
) {
  for (const event of events) await database.run(over.handle(event, standing));
}

/** The eve events up to and including the repository command's request: the turn is running with one slow call on its journal. */
function untilRequested(events: readonly MessageStreamEvent[]): number {
  return events.findIndex((event) => event.type === "actions.requested") + 1;
}

/** The turn's events as its record and journal now stand, read the way the voice session reads them, under the tools the backend that ran it may call. */
async function projected(
  userId: string,
  turnId: string,
  tools: ToolSet = CODER_TOOL_SET,
  joinedAfterStep?: number,
): Promise<readonly TurnEvent[]> {
  const [turn] = await database.run(database.store.turns.named(userId, [turnId]));
  assert.ok(turn);
  const journal = await database.run(
    database.store.messages.byClientId(userId, turn.conversationId, tools, turn.id),
  );
  assert.ok(journal.ok);
  return projectTurnEvents(turn, journal.value[0]?.message, joinedAfterStep);
}

/** One step of an agent's coding turn as eve emits it: words, then a shell command and its answer. */
function codingStep(turnId: string, stepIndex: number, words: string): MessageStreamEvent[] {
  const step = { turnId, sequence: 0, stepIndex };
  const callId = `call-${stepIndex}`;
  return [
    stamped({ type: "step.started", data: { ...step, modelId: "m" } }),
    stamped({
      type: "message.completed",
      data: { ...step, finishReason: "tool-calls", message: words },
    }),
    stamped({
      type: "actions.requested",
      data: {
        ...step,
        actions: [
          { kind: "tool-call", callId, toolName: AGENT_TOOL.BASH, input: { command: "pnpm test" } },
        ],
      },
    }),
    stamped({
      type: "action.result",
      data: {
        ...step,
        status: "completed",
        result: {
          kind: "tool-result",
          callId,
          toolName: AGENT_TOOL.BASH,
          output: { status: "completed", exitCode: 0, stdout: "ok\n", stderr: "" },
        },
      },
    }),
    stamped({ type: "step.completed", data: { ...step, finishReason: "tool-calls" } }),
  ];
}

function kinds(events: readonly TurnEvent[]): readonly string[] {
  return events.map((event) => event.kind);
}

test("mid-turn the slow step is told at once, then the settled mark, the sentences, and the end, numbered in order after it", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const events = spokenTurn(EVE_TURN);
  const turnId = hostTurnId(standing.sessionId, EVE_TURN);
  await play(events.slice(0, untilRequested(events)), standing);

  const midTurn = await projected(target.userId, turnId);
  assert.deepEqual(midTurn, [
    { turnId, seq: 1, kind: TURN_EVENT_KIND.SLOW_STEP, step: TURN_SLOW_STEP.REPOSITORY_READ },
  ]);

  await play(events.slice(untilRequested(events)), standing);
  const heard = await projected(target.userId, turnId);

  assert.deepEqual(kinds(heard), [
    TURN_EVENT_KIND.SLOW_STEP,
    TURN_EVENT_KIND.ACTIONS_SETTLED,
    TURN_EVENT_KIND.REPLY_SENTENCE,
    TURN_EVENT_KIND.REPLY_SENTENCE,
    TURN_EVENT_KIND.ENDED,
  ]);
  assert.deepEqual(heard.slice(0, midTurn.length), midTurn);
  assert.deepEqual(
    heard.map((event) => event.seq),
    [1, 2, 3, 4, 5],
  );
  const [, , first, second, end] = heard;
  assert.equal(
    first?.kind === TURN_EVENT_KIND.REPLY_SENTENCE && first.sentence,
    "One agent finished.",
  );
  assert.equal(
    second?.kind === TURN_EVENT_KIND.REPLY_SENTENCE && second.sentence,
    "Another is waiting on you.",
  );
  assert.deepEqual(end, { turnId, seq: 5, kind: TURN_EVENT_KIND.ENDED, end: TURN_END.COMPLETED });
});

test("a spoken ask that joined an agent's typed turn after its first step hears that turn from the next step on alone: the answer's words, never the turn's earlier ones nor the work it goes back to, and its run ends once the step after the answer began, the turn still running", async () => {
  const agentRelay = new StreamRelay({
    writer: await database.run(storeWriter({ tools: CODER_TOOL_SET })),
    asks: { binding: askRecord(), stopTurn: () => Effect.void },
    now: () => NOW,
    report: () => undefined,
  });
  const target = await conversation();
  const standing = { ...standingFor(target), turn: BRAIN_HOST_TURN.TYPED };
  const turnId = hostTurnId(standing.sessionId, EVE_TURN);
  const sequence = 0;
  await play(
    [
      stamped({ type: "turn.started", data: { turnId: EVE_TURN, sequence } }),
      stamped({
        type: "message.received",
        data: { turnId: EVE_TURN, sequence, message: "Build the invites." },
      }),
      ...codingStep(EVE_TURN, 0, "I am rewriting the mailer first."),
      stamped({
        type: "message.received",
        data: { turnId: EVE_TURN, sequence, message: "The developer asked how far along it is." },
      }),
      ...codingStep(EVE_TURN, 1, "Halfway through the mailer."),
    ],
    standing,
    agentRelay,
  );
  const settled = TURN_EVENT_KIND.ACTIONS_SETTLED;
  const answer = { kind: TURN_EVENT_KIND.REPLY_SENTENCE, sentence: "Halfway through the mailer." };

  // The answering step is the last on the journal: its words are told, and nothing of its own work.
  const answering = await projected(target.userId, turnId, CODER_TOOL_SET, 1);
  assert.deepEqual(answering, [
    { turnId, seq: 1, kind: settled },
    { turnId, seq: 2, ...answer },
  ]);
  // The whole turn, as a line of its own kind hears it, holds the earlier words the call never hears.
  assert.ok(
    (await projected(target.userId, turnId, CODER_TOOL_SET)).some(
      (event) =>
        event.kind === TURN_EVENT_KIND.REPLY_SENTENCE &&
        event.sentence === "I am rewriting the mailer first.",
    ),
  );

  await play(codingStep(EVE_TURN, 2, "The tests pass."), standing, agentRelay);
  assert.deepEqual(await projected(target.userId, turnId, CODER_TOOL_SET, 1), [
    ...answering,
    { turnId, seq: 3, kind: TURN_EVENT_KIND.ENDED, end: TURN_END.COMPLETED },
  ]);
  const [turn] = await database.run(database.store.turns.named(target.userId, [turnId]));
  assert.equal(turn?.status, TURN_STATUS.RUNNING);
});

test("a plan save Luke started holds back no sentence of his: the turn goes on being said while the save runs as a task", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const turnId = hostTurnId(standing.sessionId, EVE_TURN);
  const sequence = 0;
  const notes = { notes: [{ kind: "add", section: "Context", text: "- Invites expire." }] };
  await play(
    [
      stamped({ type: "turn.started", data: { turnId: EVE_TURN, sequence } }),
      stamped({ type: "message.received", data: { turnId: EVE_TURN, sequence, message: "q" } }),
      stamped({
        type: "step.started",
        data: { turnId: EVE_TURN, sequence, stepIndex: 0, modelId: "m" },
      }),
      stamped({
        type: "message.completed",
        data: {
          turnId: EVE_TURN,
          sequence,
          stepIndex: 0,
          finishReason: "tool-calls",
          message: "I'll write that down.",
        },
      }),
      stamped({
        type: "actions.requested",
        data: {
          turnId: EVE_TURN,
          sequence,
          stepIndex: 0,
          actions: [{ kind: "tool-call", callId: "call-1", toolName: "edit_plan", input: notes }],
        },
      }),
      // A task's call answers with its receipt as the task starts; the save's result comes later.
      stamped({
        type: "action.result",
        data: {
          turnId: EVE_TURN,
          sequence,
          stepIndex: 0,
          status: "completed",
          result: {
            kind: "tool-result",
            callId: "call-1",
            toolName: "edit_plan",
            output: "Started task edit_plan-1.",
          },
        },
      }),
      stamped({
        type: "step.completed",
        data: { turnId: EVE_TURN, sequence, stepIndex: 0, finishReason: "tool-calls" },
      }),
      stamped({
        type: "step.started",
        data: { turnId: EVE_TURN, sequence, stepIndex: 1, modelId: "m" },
      }),
      stamped({
        type: "message.completed",
        data: {
          turnId: EVE_TURN,
          sequence,
          stepIndex: 1,
          finishReason: "stop",
          message: "Invites expire after seven days.",
        },
      }),
    ],
    standing,
  );

  const heard = await projected(target.userId, turnId);
  assert.deepEqual(
    heard.flatMap((event) =>
      event.kind === TURN_EVENT_KIND.REPLY_SENTENCE ? [event.sentence] : [],
    ),
    ["I'll write that down.", "Invites expire after seven days."],
  );
});

test("the events' words are the brain's own: the event kinds are members of the run stream's set", () => {
  const runEventKinds = new Set<string>(Object.values(BRAIN_RUN_EVENT));
  for (const kind of Object.values(TURN_EVENT_KIND)) assert.equal(runEventKinds.has(kind), true);
});
