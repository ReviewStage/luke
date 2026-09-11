import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isToolUIPart } from "ai";
import { and, asc, eq } from "drizzle-orm";
import type { MessageStreamEvent } from "eve/client";
import { afterAll, test } from "vitest";
import {
  ACTION_TOOL,
  BRAIN_REQUEST_FAILURE,
  BRAIN_RUN_EVENT,
  BRAIN_TOOL,
  CONVERSATION_EVENT_KIND,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  OBSERVATION_SOURCE,
  TOOL_PART_STATE,
  TURN_ORIGIN,
  TURN_STATUS,
} from "../server/core";
import {
  CONVERSATION_KIND,
  conversations,
  events,
  messages,
  turns,
} from "../server/db/storage-schema";
import { offerBriefing } from "../server/hosted/brain-host/announce";
import { BRAIN_HOST_TURN, type BrainHostTurn } from "../server/hosted/brain-host/bounds";
import { readRecentMessages } from "../server/hosted/brain-host/context";
import { hostTurnId, reasoningItemId } from "../server/hosted/brain-host/ids";
import {
  memoryRelayState,
  type RelayStanding,
  StreamRelay,
} from "../server/hosted/brain-host/relay";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import {
  type ConversationTarget,
  SPEECH_OFFER,
  STORE_WRITE_REFUSAL,
  storeWriter,
} from "../server/hosted/store";
import { stampedEveEvent } from "./support/eve-events";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * The relay from eve's stream into the store writer, over the real
 * migrations on PGlite. The events are the shapes eve emits for one session,
 * synthetic throughout: no real title, branch, or spoken word. What these
 * tests hold to is the record the plan describes — which rows a turn of each
 * kind leaves, in which states, in which order — and that a step eve
 * re-emits lands on the rows the first attempt opened.
 */

const NOW = 1_800_000_000_000;

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await storeWriter({
  run: database.run,
  tools: CATALOG_TOOL_SET,
  now: () => new Date(NOW),
});
const refusals: string[] = [];
const relay = new StreamRelay({
  writer,
  offer: (target, turnId) =>
    offerBriefing({ db: database.db, run: database.run, writer, now: () => NOW }, target, turnId),
  now: () => NOW,
  report: (message) => refusals.push(message),
});

async function conversation(
  kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND] = CONVERSATION_KIND.MAIN,
): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const [row] = await database.db
    .insert(conversations)
    .values({ userId, kind })
    .returning({ id: conversations.id });
  assert.ok(row);
  return { userId, conversationId: row.id };
}

const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
  stampedEveEvent(event, NOW);

const STEP_START = "step-start";

/** The events of one turn, in the order eve emits them, for one tool call and one answer. */
function typedTurn(turnId: string, sequence: number): MessageStreamEvent[] {
  return [
    stamped({ type: "turn.started", data: { turnId, sequence } }),
    stamped({
      type: "message.received",
      data: { turnId, sequence, message: "remember that I prefer short replies" },
    }),
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
            toolName: ACTION_TOOL.REMEMBER_FACT,
            input: { words: "prefers short replies" },
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
          toolName: ACTION_TOOL.REMEMBER_FACT,
          output: { status: "accepted" },
        },
      },
    }),
    // eve emits a step's reasoning after that step's result (S0's spike).
    stamped({
      type: "reasoning.completed",
      data: { turnId, sequence, stepIndex: 0, reasoning: "The developer states a preference." },
    }),
    stamped({
      type: "step.completed",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        finishReason: "tool-calls",
        usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 4 },
      },
    }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 1, modelId: "m" } }),
    stamped({
      type: "message.completed",
      data: { turnId, sequence, stepIndex: 1, finishReason: "stop", message: "Noted." },
    }),
    stamped({
      type: "step.completed",
      data: {
        turnId,
        sequence,
        stepIndex: 1,
        finishReason: "stop",
        usage: { inputTokens: 20, outputTokens: 5 },
      },
    }),
    stamped({ type: "turn.completed", data: { turnId, sequence } }),
  ];
}

/** One eve session per conversation, as the host opens them; the id is eve's shape, minted afresh. */
function standingFor(target: ConversationTarget, turn: BrainHostTurn | undefined): RelayStanding {
  return {
    sessionId: `wrun_${randomUUID()}`,
    target,
    turn,
    model: "scripted-model",
    state: memoryRelayState(),
  };
}

async function play(events: readonly MessageStreamEvent[], standing: RelayStanding) {
  for (const event of events) await relay.handle(event, standing);
}

async function rows(target: ConversationTarget) {
  const turnRows = await database.db
    .select()
    .from(turns)
    .where(eq(turns.conversationId, target.conversationId));
  const messageRows = await database.db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, target.conversationId))
    .orderBy(asc(messages.seq));
  return { turnRows, messageRows };
}

test("a typed ask lands as one turn and its messages through the writer: the words, then the answer with its parts in step order", async () => {
  const target = await conversation();
  const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
  await play(typedTurn("turn_0", 0), standing);

  const { turnRows, messageRows } = await rows(target);
  assert.equal(turnRows.length, 1);
  const [turn] = turnRows;
  assert.ok(turn);
  assert.equal(turn.id, hostTurnId(standing.sessionId, "turn_0"));
  assert.equal(turn.origin, TURN_ORIGIN.TYPED);
  assert.equal(turn.status, TURN_STATUS.SETTLED);
  assert.equal(turn.model, "scripted-model");
  assert.equal(turn.reasoningEffort, null);
  assert.deepEqual(turn.usage, {
    inputTokens: 30,
    outputTokens: 8,
    cachedInputTokens: 4,
    reasoningTokens: 0,
  });
  assert.deepEqual(turn.responseIds, []);

  assert.deepEqual(
    messageRows.map((row) => [row.role, row.turnId, row.finishedAt !== null]),
    [
      [MESSAGE_ROLE.USER, turn.id, true],
      [MESSAGE_ROLE.ASSISTANT, turn.id, true],
    ],
  );
  const [words, answer] = messageRows;
  assert.ok(words && answer);
  assert.deepEqual(words.metadata, {
    author: MESSAGE_AUTHOR.DEVELOPER,
    channel: MESSAGE_CHANNEL.TYPED,
  });
  // Each step behind its boundary, ordered as the model produced it —
  // reasoning, then the call — although eve told the reasoning last.
  assert.deepEqual(
    answer.parts.map((part) => part.type),
    [STEP_START, "reasoning", `tool-${ACTION_TOOL.REMEMBER_FACT}`, STEP_START, "text"],
  );
  const toolPart = answer.parts.find((part) => isToolUIPart(part));
  assert.ok(toolPart);
  assert.equal(toolPart.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
  assert.equal(toolPart.toolCallId, "call-1");
  assert.deepEqual(standing.state.get(), { turns: {} });
  assert.deepEqual(refusals, []);
});

test("a tool call's part stands on the journal before its result and settles after", async () => {
  const target = await conversation();
  const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
  const events = typedTurn("turn_0", 0);
  const requested = events.findIndex((event) => event.type === "actions.requested");
  await play(events.slice(0, requested + 1), standing);

  const before = await rows(target);
  const journal = before.messageRows.find((row) => row.role === MESSAGE_ROLE.ASSISTANT);
  assert.ok(journal);
  assert.equal(journal.finishedAt, null);
  // The step was told before the call it bounds, so the journal reads the boundary first.
  assert.deepEqual(
    journal.parts.map((part) => part.type),
    [STEP_START, `tool-${ACTION_TOOL.REMEMBER_FACT}`],
  );
  const pending = journal.parts.find((part) => isToolUIPart(part));
  assert.ok(pending);
  assert.equal(pending.state, TOOL_PART_STATE.INPUT_AVAILABLE);

  await play(events.slice(requested + 1), standing);
  const after = await rows(target);
  const finished = after.messageRows.find((row) => row.role === MESSAGE_ROLE.ASSISTANT);
  assert.ok(finished);
  assert.equal(finished.id, journal.id);
  assert.notEqual(finished.finishedAt, null);
  const settled = finished.parts.find((part) => isToolUIPart(part));
  assert.ok(settled);
  assert.equal(settled.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
});

test("an observation turn over a roster diff lands the same way, with the roster look as its source, and its briefing is offered once however often the result is re-emitted", async () => {
  const target = await conversation(CONVERSATION_KIND.OBSERVED);
  const standing = standingFor(target, BRAIN_HOST_TURN.OBSERVATION);
  const turnId = "turn_0";
  await play(
    [
      stamped({ type: "turn.started", data: { turnId, sequence: 0 } }),
      stamped({
        type: "message.received",
        data: { turnId, sequence: 0, message: "[observed events] ..." },
      }),
      stamped({ type: "step.started", data: { turnId, sequence: 0, stepIndex: 0, modelId: "m" } }),
      stamped({
        type: "actions.requested",
        data: {
          turnId,
          sequence: 0,
          stepIndex: 0,
          actions: [
            {
              kind: "tool-call",
              callId: "call-a",
              toolName: BRAIN_TOOL.ANNOUNCE,
              input: { briefing: "One agent finished." },
            },
          ],
        },
      }),
      stamped({
        type: "action.result",
        data: {
          turnId,
          sequence: 0,
          stepIndex: 0,
          status: "completed",
          result: {
            kind: "tool-result",
            callId: "call-a",
            toolName: BRAIN_TOOL.ANNOUNCE,
            output: { status: "accepted" },
          },
        },
      }),
      stamped({
        type: "step.completed",
        data: { turnId, sequence: 0, stepIndex: 0, finishReason: "tool-calls" },
      }),
      // eve re-emits the settled call under a new event id, as a replayed step would.
      stamped({
        type: "action.result",
        data: {
          turnId,
          sequence: 0,
          stepIndex: 0,
          status: "completed",
          result: {
            kind: "tool-result",
            callId: "call-a",
            toolName: BRAIN_TOOL.ANNOUNCE,
            output: { status: "accepted" },
          },
        },
      }),
      stamped({ type: "step.started", data: { turnId, sequence: 0, stepIndex: 1, modelId: "m" } }),
      stamped({
        type: "message.completed",
        data: { turnId, sequence: 0, stepIndex: 1, finishReason: "stop", message: null },
      }),
      stamped({
        type: "step.completed",
        data: { turnId, sequence: 0, stepIndex: 1, finishReason: "stop" },
      }),
      stamped({ type: "turn.completed", data: { turnId, sequence: 0 } }),
    ],
    standing,
  );

  const { turnRows, messageRows } = await rows(target);
  assert.equal(turnRows[0]?.origin, TURN_ORIGIN.ROSTER_DIFF);
  assert.equal(turnRows[0]?.status, TURN_STATUS.SETTLED);
  assert.equal(turnRows[0]?.usage, null);
  const [words, answer] = messageRows;
  assert.ok(words && answer);
  assert.deepEqual(words.metadata, {
    author: MESSAGE_AUTHOR.BRAIN,
    source: OBSERVATION_SOURCE.ROSTER_LOOK,
  });
  // The second step delivered nothing to announce, and stands as its boundary alone.
  assert.deepEqual(
    answer.parts.map((part) => part.type),
    [STEP_START, `tool-${BRAIN_TOOL.ANNOUNCE}`, STEP_START],
  );
  const offered = await database.db
    .select({ kind: events.kind, messageId: events.messageId, payload: events.payload })
    .from(events)
    .where(eq(events.conversationId, target.conversationId));
  assert.deepEqual(offered, [
    {
      kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      messageId: answer.id,
      payload: { expiresAt: NOW + SPEECH_OFFER.TTL_MS },
    },
  ]);
});

test("a failed turn settles its journal and names the failure; a cancelled one settles its unanswered parts", async () => {
  const failed = await conversation();
  const failedStanding = standingFor(failed, BRAIN_HOST_TURN.TYPED);
  const events = typedTurn("turn_0", 0);
  const requested = events.findIndex((event) => event.type === "actions.requested");
  await play(events.slice(0, requested + 1), failedStanding);
  await relay.handle(
    stamped({
      type: "turn.failed",
      data: { turnId: "turn_0", sequence: 0, code: "model_error", message: "upstream failed" },
    }),
    failedStanding,
  );
  const failedRows = await rows(failed);
  assert.equal(failedRows.turnRows[0]?.status, TURN_STATUS.FAILED);
  assert.equal(failedRows.turnRows[0]?.failure, "model");
  const failedJournal = failedRows.messageRows.find((row) => row.role === MESSAGE_ROLE.ASSISTANT);
  assert.ok(failedJournal);
  assert.notEqual(failedJournal.finishedAt, null);

  const cancelled = await conversation();
  const cancelledStanding = standingFor(cancelled, BRAIN_HOST_TURN.TYPED);
  await play(events.slice(0, requested + 1), cancelledStanding);
  await relay.handle(
    stamped({ type: "turn.cancelled", data: { turnId: "turn_0", sequence: 0 } }),
    cancelledStanding,
  );
  const cancelledRows = await rows(cancelled);
  assert.equal(cancelledRows.turnRows[0]?.status, TURN_STATUS.CANCELLED);
  const journal = cancelledRows.messageRows.find((row) => row.role === MESSAGE_ROLE.ASSISTANT);
  assert.ok(journal);
  const part = journal.parts.find((candidate) => isToolUIPart(candidate));
  assert.ok(part);
  assert.notEqual(part.state, TOOL_PART_STATE.INPUT_AVAILABLE);
});

test("events eve re-emits under new ids land on the rows the first attempt opened, and a replayed step adds no part and counts no usage twice", async () => {
  const target = await conversation();
  const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
  const events = typedTurn("turn_0", 0);
  const completed = events.findIndex((event) => event.type === "turn.completed");
  const requested = events.findIndex((event) => event.type === "actions.requested");
  await play(events.slice(0, requested + 1), standing);
  await play(events.slice(0, completed), standing);
  await play(events.slice(0, completed), standing);
  const replayedJournal = (await rows(target)).messageRows.find(
    (row) => row.role === MESSAGE_ROLE.ASSISTANT,
  );
  assert.equal(replayedJournal?.parts.filter((part) => part.type === STEP_START).length, 2);
  await play(events.slice(completed), standing);

  const { turnRows, messageRows } = await rows(target);
  assert.equal(turnRows.length, 1);
  assert.deepEqual(turnRows[0]?.usage, {
    inputTokens: 30,
    outputTokens: 8,
    cachedInputTokens: 4,
    reasoningTokens: 0,
  });
  assert.equal(messageRows.length, 2);
  const answer = messageRows[1];
  assert.ok(answer);
  assert.deepEqual(
    answer.parts.map((part) => part.type),
    [STEP_START, "reasoning", `tool-${ACTION_TOOL.REMEMBER_FACT}`, STEP_START, "text"],
  );
});

test("a reasoning item eve names no id for is journaled under the id the relay mints for its step, and the answer keeps that id", async () => {
  const target = await conversation();
  const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
  const events = typedTurn("turn_0", 0);
  const reasoned = events.findIndex((event) => event.type === "reasoning.completed");
  await play(events.slice(0, reasoned + 1), standing);
  const journal = (await rows(target)).messageRows.find(
    (row) => row.role === MESSAGE_ROLE.ASSISTANT,
  );
  assert.ok(journal);
  const minted = reasoningItemId(standing.sessionId, "turn_0", 0, 0);
  const journaled = journal.parts.find((part) => part.type === "reasoning");
  assert.ok(journaled && journaled.type === "reasoning");
  assert.equal(journaled.id, minted);

  await play(events.slice(reasoned + 1), standing);
  const answer = (await rows(target)).messageRows.find(
    (row) => row.role === MESSAGE_ROLE.ASSISTANT,
  );
  assert.ok(answer);
  const kept = answer.parts.find((part) => part.type === "reasoning");
  assert.ok(kept && kept.type === "reasoning");
  assert.equal(kept.id, minted);
});

test("a step that produced nothing still stands as its boundary, told once however often eve starts it again", async () => {
  const target = await conversation();
  const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
  const turnId = "turn_0";
  await play(
    [
      stamped({ type: "turn.started", data: { turnId, sequence: 0 } }),
      stamped({ type: "message.received", data: { turnId, sequence: 0, message: "hello" } }),
      stamped({ type: "step.started", data: { turnId, sequence: 0, stepIndex: 0, modelId: "m" } }),
      stamped({ type: "step.started", data: { turnId, sequence: 0, stepIndex: 0, modelId: "m" } }),
      stamped({ type: "step.started", data: { turnId, sequence: 0, stepIndex: 1, modelId: "m" } }),
      stamped({
        type: "message.completed",
        data: { turnId, sequence: 0, stepIndex: 1, finishReason: "stop", message: "Hi." },
      }),
      stamped({ type: "turn.completed", data: { turnId, sequence: 0 } }),
    ],
    standing,
  );
  const answer = (await rows(target)).messageRows.find(
    (row) => row.role === MESSAGE_ROLE.ASSISTANT,
  );
  assert.ok(answer);
  assert.deepEqual(
    answer.parts.map((part) => part.type),
    [STEP_START, STEP_START, "text"],
  );
});

test("a step eve re-runs whole after a failed attempt keeps the first attempt's reasoning under its ordinal and lands the second's beside it under the next; the stream replayed in its order adds nothing", async () => {
  const target = await conversation();
  const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
  const turnId = "turn_0";
  const step = (reasoning: string) => [
    stamped({ type: "step.started", data: { turnId, sequence: 0, stepIndex: 0, modelId: "m" } }),
    stamped({
      type: "reasoning.completed",
      data: { turnId, sequence: 0, stepIndex: 0, reasoning },
    }),
  ];
  const attempts = [
    ...step("The first attempt's thought."),
    ...step("The second attempt's thought."),
  ];
  const answered = [
    stamped({
      type: "message.completed",
      data: { turnId, sequence: 0, stepIndex: 0, finishReason: "stop", message: "Hi." },
    }),
  ];
  const minted = [0, 1].map((ordinal) => reasoningItemId(standing.sessionId, turnId, 0, ordinal));
  const reasoningIds = async () => {
    const journal = (await rows(target)).messageRows.find(
      (row) => row.role === MESSAGE_ROLE.ASSISTANT,
    );
    assert.ok(journal);
    return journal.parts.flatMap((part) => (part.type === "reasoning" ? [part.id] : []));
  };

  await play(
    [
      stamped({ type: "turn.started", data: { turnId, sequence: 0 } }),
      stamped({ type: "message.received", data: { turnId, sequence: 0, message: "hello" } }),
      ...attempts,
      ...answered,
    ],
    standing,
  );
  assert.deepEqual(await reasoningIds(), minted);

  await play([...attempts, ...answered], standing);
  assert.deepEqual(await reasoningIds(), minted);

  await play([stamped({ type: "turn.completed", data: { turnId, sequence: 0 } })], standing);
  const answer = (await rows(target)).messageRows.find(
    (row) => row.role === MESSAGE_ROLE.ASSISTANT,
  );
  assert.ok(answer);
  assert.deepEqual(
    answer.parts.map((part) => part.type),
    [STEP_START, "reasoning", "reasoning", "text"],
  );
  assert.deepEqual(await reasoningIds(), minted);
});

test("a turn whose request named no kind is not recorded, and the refusal is reported rather than thrown", async () => {
  const target = await conversation();
  const standing = standingFor(target, undefined);
  const before = refusals.length;
  await play(typedTurn("turn_0", 0), standing);
  const { turnRows, messageRows } = await rows(target);
  assert.equal(turnRows.length, 0);
  assert.equal(messageRows.length, 0);
  assert.equal(refusals.length, before + 1);
});

test("a second turn of the same session is another turn row, keyed from eve's own turn id", async () => {
  const target = await conversation();
  const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
  await play(typedTurn("turn_0", 0), standing);
  await play(typedTurn("turn_1", 1), standing);
  const { turnRows } = await rows(target);
  assert.deepEqual(
    turnRows.map((row) => row.id).sort(),
    [hostTurnId(standing.sessionId, "turn_0"), hostTurnId(standing.sessionId, "turn_1")].sort(),
  );
  assert.equal(
    (
      await database.db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, target.conversationId),
            eq(messages.role, MESSAGE_ROLE.USER),
          ),
        )
    ).length,
    2,
  );
});

test("the recent exchange reads back the newest finished messages, oldest first, and never a journal still open", async () => {
  const target = await conversation();
  const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
  const tools = CATALOG_TOOL_SET;
  await play(typedTurn("turn_0", 0), standing);
  const events = typedTurn("turn_1", 1);
  const requested = events.findIndex((event) => event.type === "actions.requested");
  await play(events.slice(0, requested + 1), standing);

  const recent = await readRecentMessages(database.run, target, tools, 10);
  assert.deepEqual(
    recent.map((message) => message.role),
    [MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT, MESSAGE_ROLE.USER],
  );
  const newest = await readRecentMessages(database.run, target, tools, 1);
  assert.deepEqual(
    newest.map((message) => message.role),
    [MESSAGE_ROLE.USER],
  );

  await play(events.slice(requested + 1), standing);
  const settled = await readRecentMessages(database.run, target, tools, 10);
  assert.equal(settled.length, 4);
  assert.equal(settled.at(-1)?.role, MESSAGE_ROLE.ASSISTANT);
});

test("a turn whose answer the store refuses ends failed for persistence rather than sealed without its words", async () => {
  const target = await conversation();
  const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
  const refusing = new StreamRelay({
    writer: {
      consume: (to, event) =>
        event.kind === BRAIN_RUN_EVENT.MESSAGE_COMPLETED &&
        event.message.role === MESSAGE_ROLE.ASSISTANT
          ? Promise.resolve({ ok: false, refusal: STORE_WRITE_REFUSAL.NO_TURN })
          : writer.consume(to, event),
      enqueueTurn: (to, enqueue) => writer.enqueueTurn(to, enqueue),
    },
    offer: () => Promise.resolve(true),
    now: () => NOW,
    report: (message) => refusals.push(message),
  });
  for (const event of typedTurn("turn_0", 0)) await refusing.handle(event, standing);

  const { turnRows } = await rows(target);
  assert.equal(turnRows[0]?.status, TURN_STATUS.FAILED);
  assert.equal(turnRows[0]?.failure, BRAIN_REQUEST_FAILURE.PERSISTENCE);
});

test("a turn start whose write throws keeps nothing in relay state, so the start eve emits again queues the row", async () => {
  const target = await conversation();
  const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
  let failures = 1;
  const failing = new StreamRelay({
    writer: {
      consume: (to, event) => writer.consume(to, event),
      enqueueTurn: (to, enqueue) => {
        if (failures > 0) {
          failures -= 1;
          return Promise.reject(new Error("the database went away"));
        }
        return writer.enqueueTurn(to, enqueue);
      },
    },
    offer: () => Promise.resolve(true),
    now: () => NOW,
    report: (message) => refusals.push(message),
  });
  const started = () => stamped({ type: "turn.started", data: { turnId: "turn_0", sequence: 0 } });
  await assert.rejects(async () => failing.handle(started(), standing), Error);
  assert.deepEqual(standing.state.get(), { turns: {} });
  assert.equal((await rows(target)).turnRows.length, 0);

  await failing.handle(started(), standing);
  assert.equal(Object.hasOwn(standing.state.get().turns, "turn_0"), true);
  const { turnRows } = await rows(target);
  assert.equal(turnRows.length, 1);
  assert.equal(turnRows[0]?.status, TURN_STATUS.RUNNING);
});

test("a turn whose ask the store refuses writes no answer and ends failed for persistence, so no reply settles against a missing ask", async () => {
  const target = await conversation();
  const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
  const refusing = new StreamRelay({
    writer: {
      consume: (to, event) =>
        event.kind === BRAIN_RUN_EVENT.MESSAGE_COMPLETED && event.message.role === MESSAGE_ROLE.USER
          ? Promise.resolve({ ok: false, refusal: STORE_WRITE_REFUSAL.NO_TURN })
          : writer.consume(to, event),
      enqueueTurn: (to, enqueue) => writer.enqueueTurn(to, enqueue),
    },
    offer: () => Promise.resolve(true),
    now: () => NOW,
    report: (message) => refusals.push(message),
  });
  for (const event of typedTurn("turn_0", 0)) await refusing.handle(event, standing);

  const { turnRows, messageRows } = await rows(target);
  assert.equal(turnRows[0]?.status, TURN_STATUS.FAILED);
  assert.equal(turnRows[0]?.failure, BRAIN_REQUEST_FAILURE.PERSISTENCE);
  // The journal of what the model did stands; the answer to the missing ask does not.
  assert.deepEqual(
    messageRows.map((row) => [row.role, row.parts.map((part) => part.type)]),
    [
      [
        MESSAGE_ROLE.ASSISTANT,
        [STEP_START, `tool-${ACTION_TOOL.REMEMBER_FACT}`, "reasoning", STEP_START],
      ],
    ],
  );
  assert.deepEqual(standing.state.get(), { turns: {} });
});

test("a turn end the store refuses keeps the turn in relay state, so the boundary eve re-emits settles the row instead of finding nothing", async () => {
  const target = await conversation();
  const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
  let refuseEnds = 1;
  const refusing = new StreamRelay({
    writer: {
      consume: (to, event) => {
        if (event.kind === BRAIN_RUN_EVENT.TURN_ENDED && refuseEnds > 0) {
          refuseEnds -= 1;
          return Promise.resolve({ ok: false, refusal: STORE_WRITE_REFUSAL.NO_TURN });
        }
        return writer.consume(to, event);
      },
      enqueueTurn: (to, enqueue) => writer.enqueueTurn(to, enqueue),
    },
    offer: () => Promise.resolve(true),
    now: () => NOW,
    report: (message) => refusals.push(message),
  });
  const events = typedTurn("turn_0", 0);
  for (const event of events) await refusing.handle(event, standing);
  assert.equal(Object.hasOwn(standing.state.get().turns, "turn_0"), true);
  const running = await rows(target);
  assert.equal(running.turnRows[0]?.status, TURN_STATUS.RUNNING);

  await refusing.handle(
    stamped({ type: "turn.completed", data: { turnId: "turn_0", sequence: 0 } }),
    standing,
  );
  assert.deepEqual(standing.state.get(), { turns: {} });
  const settled = await rows(target);
  assert.equal(settled.turnRows.length, 1);
  assert.equal(settled.turnRows[0]?.status, TURN_STATUS.SETTLED);
  assert.equal(settled.messageRows.filter((row) => row.role === MESSAGE_ROLE.ASSISTANT).length, 1);
});
