import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { askRecord } from "@luke/database/models/asks";
import { hostTurnId } from "@luke/database/models/ids";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import { insertConversation, openHostedStoreTestDatabase } from "@luke/database/testing";
import { TURN_END, TURN_EVENT_KIND, TURN_SLOW_STEP, type TurnEvent } from "@luke/features";
import { Effect } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { afterAll, test } from "vitest";
import { BRAIN_RUN_EVENT, SLOW_STEP_KIND } from "../core.js";
import { HOSTED_TOOL_SET } from "../tasks/brain-tool-set.js";
import { stampedEveEvent } from "../testing/eve-events.js";
import { BRAIN_HOST_TURN } from "./brain-host/bounds.js";
import { memoryRelayState, type RelayStanding, StreamRelay } from "./brain-host/relay.js";
import { REPOSITORY_SHELL_STATUS, RUN_IN_REPOSITORY_TOOL } from "./repository-shell.js";
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

const writer = await database.run(storeWriter({ tools: HOSTED_TOOL_SET }));
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

/** One spoken ask's turn as eve emits it: a repository command, then a two-sentence answer. */
function spokenTurn(turnId: string): readonly MessageStreamEvent[] {
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
            toolName: RUN_IN_REPOSITORY_TOOL.name,
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
          toolName: RUN_IN_REPOSITORY_TOOL.name,
          output: {
            status: REPOSITORY_SHELL_STATUS.RAN,
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

async function play(events: readonly MessageStreamEvent[], standing: RelayStanding) {
  for (const event of events) await database.run(relay.handle(event, standing));
}

/** The eve events up to and including the repository command's request: the turn is running with one slow call on its journal. */
function untilRequested(events: readonly MessageStreamEvent[]): number {
  return events.findIndex((event) => event.type === "actions.requested") + 1;
}

/** The turn's events as its record and journal now stand, read the way the voice session reads them. */
async function projected(userId: string, turnId: string): Promise<readonly TurnEvent[]> {
  const [turn] = await database.run(database.store.turns.named(userId, [turnId]));
  assert.ok(turn);
  const journal = await database.run(
    database.store.messages.byClientId(userId, turn.conversationId, HOSTED_TOOL_SET, turn.id),
  );
  assert.ok(journal.ok);
  return projectTurnEvents(turn, journal.value[0]?.message);
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

test("the events' words are the brain's own: the event kinds are members of the run stream's set, and the slow step kinds are its", () => {
  const runEventKinds = new Set<string>(Object.values(BRAIN_RUN_EVENT));
  for (const kind of Object.values(TURN_EVENT_KIND)) assert.equal(runEventKinds.has(kind), true);
  assert.deepEqual(TURN_SLOW_STEP, SLOW_STEP_KIND);
});
