import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { askRecord } from "@luke/database/models/asks";
import { hostTurnId } from "@luke/database/models/ids";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import {
  insertConversation,
  openHostedStoreTestDatabase,
  readMessagesByConversationTyped,
  readTurnsByConversation,
} from "@luke/database/testing";
import { isToolUIPart } from "ai";
import { Effect, Result } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { afterAll } from "vitest";
import {
  ASK_ORIGIN,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  type SpokenAskMetadata,
  TOOL_PART_STATE,
  TURN_ORIGIN,
  TURN_STATUS,
  UNKNOWN_ACTION_STATUS,
} from "../../core.js";
import { HOSTED_TOOL_SET } from "../../tasks/brain-tool-set.js";
import { stampedEveEvent } from "../../testing/eve-events.js";
import { spokenTurn } from "../../testing/eve-turns.js";
import { REPOSITORY_SHELL_STATUS, RUN_IN_REPOSITORY_TOOL } from "../repository-shell.js";
import { BRAIN_HOST_TURN, type BrainHostTurn } from "./bounds.js";
import { foldedQuietly, memoryRelayState, type RelayStanding, StreamRelay } from "./relay.js";

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

const writer = await database.run(storeWriter({ tools: HOSTED_TOOL_SET }));

/**
 * The developer's spoken line as the voice writer leaves it since the ledger
 * mints row ids: a user row under an id of its own, attached to its
 * delegation, which takes it into the ask's turn where the turn is known and
 * leaves it for the received message otherwise. Answers the row as the old
 * cut did, by id.
 */
async function spokenLine(
  target: ConversationTarget,
  delegationId: string,
  text: string,
  metadata: SpokenAskMetadata,
): Promise<{ readonly ok: true; readonly id: string }> {
  const rowId = `line-${delegationId}`;
  const written = await database.run(
    writer.upsertSpokenRow(target, { role: MESSAGE_ROLE.USER, clientId: rowId, text, metadata }),
  );
  assert.ok(Result.isSuccess(written));
  if (!Result.isSuccess(written)) throw new Error("the spoken row was refused");
  const attached = await database.run(
    writer.attachSpokenAsk(target, { delegationId, rowIds: [rowId] }),
  );
  assert.ok(Result.isSuccess(attached));
  assert.deepEqual(Result.getOrUndefined(attached), [written.success.id]);
  return { ok: true, id: written.success.id };
}
const refusals: string[] = [];
const relay = new StreamRelay({
  writer,
  asks: { binding: askRecord(), stopTurn: () => Effect.void },
  now: () => NOW,
  report: (message) => refusals.push(message),
});

async function conversation(): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  return { userId, conversationId };
}

const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
  stampedEveEvent(event, NOW);

const STEP_START = "step-start";

/** What `typedTurn`'s two steps cost together: the first 10 in, 3 out, 4 of them cached; the second 20 in, 5 out. */
const TYPED_TURN_USAGE = {
  inputTokens: 30,
  outputTokens: 8,
  cachedInputTokens: 4,
  reasoningTokens: 0,
};

/** The events of one turn, in the order eve emits them, for one tool call and one answer. */
function typedTurn(turnId: string, sequence: number): MessageStreamEvent[] {
  return [
    stamped({ type: "turn.started", data: { turnId, sequence } }),
    stamped({
      type: "message.received",
      data: { turnId, sequence, message: "what is at the repository's root?" },
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
    // eve emits a step's reasoning after that step's result (S0's spike).
    stamped({
      type: "reasoning.completed",
      data: { turnId, sequence, stepIndex: 0, reasoning: "List the root first." },
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
      data: { turnId, sequence, stepIndex: 1, finishReason: "stop", message: "A README." },
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
  for (const event of events) await database.run(relay.handle(event, standing));
}

async function rows(target: ConversationTarget) {
  const turnRows = await readTurnsByConversation(database.run, target.conversationId);
  const messageRows = await readMessagesByConversationTyped(database.run, target.conversationId);
  return { turnRows, messageRows };
}

/**
 * The rows a device would take past the position it holds: the conversation's
 * rows whose place is past it, in sequence, with an absent turn or finish
 * read as absent.
 */
async function pastCursor(target: ConversationTarget, after: number) {
  const stored = await readMessagesByConversationTyped(database.run, target.conversationId);
  return stored
    .filter((row) => row.seq > after)
    .map((row) => ({
      id: row.id,
      seq: row.seq,
      clientId: row.clientId,
      turnId: row.turnId ?? undefined,
      finishedAt: row.finishedAt ?? undefined,
    }));
}

function readMessageSeqs(records: readonly { readonly seq: number }[]): number[] {
  return records.map((record) => record.seq);
}

it.effect(
  "a typed ask lands as one turn and its messages through the writer: the words, then the answer with its parts in step order",
  () =>
    Effect.promise(async () => {
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
        ...TYPED_TURN_USAGE,
        byModel: [{ model: "scripted-model", ...TYPED_TURN_USAGE }],
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
        [STEP_START, "reasoning", `tool-${RUN_IN_REPOSITORY_TOOL.name}`, STEP_START, "text"],
      );
      const toolPart = answer.parts.find((part) => isToolUIPart(part));
      assert.ok(toolPart);
      assert.equal(toolPart.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
      assert.equal(toolPart.toolCallId, "call-1");
      assert.deepEqual(standing.state.get(), { turns: {} });
      assert.deepEqual(refusals, []);
    }),
);

it.effect(
  "a spoken turn's received message writes no user row: the developer's line is the transcript's under the ask's own id, and the turn ties that row to itself where it stood unattached; a typed turn's received message is its user row, so one utterance is one line either way",
  () =>
    Effect.promise(async () => {
      const spoken = await conversation();
      const typed = await conversation();
      const spokenStanding = standingFor(spoken, BRAIN_HOST_TURN.SPOKEN);
      // The service's ask under the delegation's id, dispatched into this eve session, and the
      // transcript row the voice writer cut for it, written before eve's turn started.
      const delegationId = `dl_${randomUUID()}`;
      const askRecordEffects = askRecord();
      const record = {
        record: (write: Parameters<typeof askRecordEffects.record>[0]) =>
          database.run(askRecordEffects.record(write)),
        dispatchOnce: (
          target: Parameters<typeof askRecordEffects.dispatchOnce>[0],
          id: string,
          dispatch: Parameters<typeof askRecordEffects.dispatchOnce>[2],
        ) => database.run(askRecordEffects.dispatchOnce(target, id, dispatch)),
      };
      const ask = await record.record({
        userId: spoken.userId,
        conversationId: spoken.conversationId,
        clientId: delegationId,
        origin: ASK_ORIGIN.SPOKEN,
        createdAt: new Date(NOW),
      });
      await record.dispatchOnce(spoken, ask.id, () =>
        Effect.succeed({
          sessionId: spokenStanding.sessionId,
          deliveryId: "delivery-1",
        }),
      );
      const transcript = await spokenLine(spoken, delegationId, "What changed?", {
        author: MESSAGE_AUTHOR.DEVELOPER,
        channel: MESSAGE_CHANNEL.VOICE,
      });
      assert.ok(transcript.ok);
      // A device that read the conversation to its end before the turn: the line stands
      // outside any turn, and the cursor it holds is the line's own position.
      const early = await pastCursor(spoken, 0);
      assert.deepEqual(
        early.map((row) => [row.id, row.turnId]),
        [[transcript.id, undefined]],
      );
      const earlyCursor = early.at(-1)?.seq ?? 0;
      await play(spokenTurn("turn_0", NOW, ["delivery-1"]), spokenStanding);
      await play(typedTurn("turn_0", 0), standingFor(typed, BRAIN_HOST_TURN.TYPED));

      const spokenRows = await rows(spoken);
      const typedRows = await rows(typed);
      const spokenTurnId = hostTurnId(spokenStanding.sessionId, "turn_0");
      assert.deepEqual(
        spokenRows.messageRows.map((row) => [
          row.role,
          row.clientId,
          row.turnId,
          row.finishedAt !== null,
        ]),
        [
          [MESSAGE_ROLE.USER, `line-${delegationId}`, spokenTurnId, true],
          [MESSAGE_ROLE.ASSISTANT, spokenTurnId, spokenTurnId, true],
        ],
      );
      // The turn took the line to a fresh place past the early reader's cursor, ahead of its
      // own reply, so that reader's next page carries the line again, in the turn's group and
      // first in it; a reader who never passed the old place reads the same rows in the same order.
      const late = await pastCursor(spoken, earlyCursor);
      assert.deepEqual(
        late.map((row) => [row.id, row.turnId]),
        [
          [transcript.id, spokenTurnId],
          [spokenRows.messageRows[1]?.id, spokenTurnId],
        ],
      );
      assert.deepEqual(
        (await pastCursor(spoken, 0)).map((row) => row.id),
        late.map((row) => row.id),
      );
      assert.deepEqual(
        readMessageSeqs(late),
        readMessageSeqs(late).toSorted((a, b) => a - b),
      );
      assert.ok((late[0]?.seq ?? 0) > earlyCursor);
      assert.deepEqual(
        typedRows.messageRows.map((row) => [row.role, row.finishedAt !== null]),
        [
          [MESSAGE_ROLE.USER, true],
          [MESSAGE_ROLE.ASSISTANT, true],
        ],
      );
      assert.deepEqual(
        [spokenRows.turnRows[0]?.status, typedRows.turnRows[0]?.status],
        [TURN_STATUS.SETTLED, TURN_STATUS.SETTLED],
      );
      // The other half: a row written after its ask learned a turn on record lands tied at its insert.
      const laterDelegation = `dl_${randomUUID()}`;
      const later = await record.record({
        userId: spoken.userId,
        conversationId: spoken.conversationId,
        clientId: laterDelegation,
        origin: ASK_ORIGIN.SPOKEN,
        createdAt: new Date(NOW),
      });
      await record.dispatchOnce(spoken, later.id, () =>
        Effect.succeed({
          sessionId: spokenStanding.sessionId,
          deliveryId: "delivery-2",
          turnId: spokenTurnId,
        }),
      );
      const laterRow = await spokenLine(spoken, laterDelegation, "And now?", {
        author: MESSAGE_AUTHOR.DEVELOPER,
        channel: MESSAGE_CHANNEL.VOICE,
      });
      assert.ok(laterRow.ok);
      const written = (
        await readMessagesByConversationTyped(database.run, spoken.conversationId)
      ).find((row) => row.id === laterRow.id);
      assert.equal(written?.turnId, spokenTurnId);
      assert.deepEqual(refusals, []);
    }),
);

it.effect(
  "events eve re-emits under new ids land on the rows the first attempt opened, and a replayed step adds no part and counts no usage twice",
  () =>
    Effect.promise(async () => {
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
        ...TYPED_TURN_USAGE,
        byModel: [{ model: "scripted-model", ...TYPED_TURN_USAGE }],
      });
      assert.equal(messageRows.length, 2);
      const answer = messageRows[1];
      assert.ok(answer);
      assert.deepEqual(
        answer.parts.map((part) => part.type),
        [STEP_START, "reasoning", `tool-${RUN_IN_REPOSITORY_TOOL.name}`, STEP_START, "text"],
      );
    }),
);

it.effect(
  "a step eve runs again after an interruption settles the calls its abandoned attempt asked for while the turn still runs, and the answer keeps the attempt that finished",
  () =>
    Effect.promise(async () => {
      const target = await conversation();
      const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
      const events = typedTurn("turn_0", 0);
      const stepped = events.findIndex((event) => event.type === "step.started");
      const completed = events.findIndex((event) => event.type === "turn.completed");
      await play(events.slice(0, stepped), standing);
      // The relay's state as the step began, which is what eve hands its retry.
      const stepInput = standing.state.get();
      await play(
        [
          stamped({
            type: "step.started",
            data: { turnId: "turn_0", sequence: 0, stepIndex: 0, modelId: "m" },
          }),
          stamped({
            type: "actions.requested",
            data: {
              turnId: "turn_0",
              sequence: 0,
              stepIndex: 0,
              actions: [
                {
                  kind: "tool-call",
                  callId: "call-abandoned",
                  toolName: RUN_IN_REPOSITORY_TOOL.name,
                  input: { command: "pwd" },
                },
              ],
            },
          }),
        ],
        standing,
      );
      const retry = { ...standing, state: memoryRelayState(stepInput) };
      await play(events.slice(stepped, completed), retry);

      const journal = (await rows(target)).messageRows.find(
        (row) => row.role === MESSAGE_ROLE.ASSISTANT,
      );
      assert.equal(journal?.finishedAt, null);
      const abandoned = journal?.parts.find(
        (part) => isToolUIPart(part) && part.toolCallId === "call-abandoned",
      );
      assert.ok(abandoned && isToolUIPart(abandoned));
      assert.equal(abandoned.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
      assert.partialDeepStrictEqual(abandoned.output, { status: UNKNOWN_ACTION_STATUS });

      await play(events.slice(completed), retry);
      const { turnRows, messageRows } = await rows(target);
      assert.equal(turnRows[0]?.status, TURN_STATUS.SETTLED);
      const answer = messageRows.find((row) => row.role === MESSAGE_ROLE.ASSISTANT);
      assert.deepEqual(
        answer?.parts.flatMap((part) => (isToolUIPart(part) ? [part.toolCallId] : [])),
        ["call-1"],
      );
      assert.deepEqual(refusals, []);
    }),
);

/** One typed turn whose answer streams a fragment at a time: its reasoning, a call's input it never makes, and its words, the first sentence over two fragments. */
function streamedTurn(turnId: string, sequence: number): MessageStreamEvent[] {
  const step = { turnId, sequence, stepIndex: 0 };
  return [
    stamped({ type: "turn.started", data: { turnId, sequence } }),
    stamped({ type: "message.received", data: { turnId, sequence, message: "how far along?" } }),
    stamped({ type: "step.started", data: { ...step, modelId: "m" } }),
    stamped({ type: "reasoning.appended", data: { ...step, reasoningDelta: "Check the " } }),
    stamped({ type: "reasoning.appended", data: { ...step, reasoningDelta: "mailer." } }),
    stamped({
      type: "action.input.appended",
      data: {
        ...step,
        callId: "call-1",
        toolName: RUN_IN_REPOSITORY_TOOL.name,
        inputTextDelta: '{"command":',
        inputTextOffset: 0,
      },
    }),
    stamped({ type: "message.appended", data: { ...step, messageDelta: "Halfway through" } }),
    stamped({ type: "message.appended", data: { ...step, messageDelta: " the mailer. Then" } }),
    stamped({ type: "message.appended", data: { ...step, messageDelta: " the" } }),
    stamped({
      type: "message.completed",
      data: {
        ...step,
        finishReason: "stop",
        message: "Halfway through the mailer. Then the tests.",
      },
    }),
    stamped({
      type: "step.completed",
      data: { ...step, finishReason: "stop", usage: { inputTokens: 10, outputTokens: 3 } },
    }),
    stamped({ type: "turn.completed", data: { turnId, sequence } }),
  ];
}

/** The transcript a conversation's rows tell, by role, each message's parts by kind and words. */
async function transcript(target: ConversationTarget) {
  const { turnRows, messageRows } = await rows(target);
  return {
    turns: turnRows.map((turn) => turn.status),
    messages: messageRows.map((row) => ({
      role: row.role,
      parts: row.parts.map((part) => (part.type === "text" ? `text:${part.text}` : part.type)),
    })),
  };
}

it.effect(
  "a fragment the store need hear nothing of is folded into the relay's state alone, a sentence's last fragment is relayed with the fragments folded before it, and the hook's way leaves the transcript relaying every event leaves",
  () =>
    Effect.promise(async () => {
      const events = streamedTurn("turn_0", 0);
      const quiet = await conversation();
      const standing = standingFor(quiet, BRAIN_HOST_TURN.TYPED);
      const folded: string[] = [];
      const drafts: string[][] = [];
      // As the store hook relays: only what is not folded quietly reaches the relay and the store.
      for (const event of events) {
        if (foldedQuietly(event, standing.state)) {
          folded.push(event.type);
        } else {
          await database.run(relay.handle(event, standing));
        }
        if (event.type === "message.appended") {
          const { messages } = await transcript(quiet);
          drafts.push(
            messages
              .filter((message) => message.role === MESSAGE_ROLE.ASSISTANT)
              .flatMap((message) => message.parts.filter((part) => part.startsWith("text:"))),
          );
        }
      }

      assert.deepEqual(folded, [
        "reasoning.appended",
        "reasoning.appended",
        "action.input.appended",
        "message.appended",
        "message.appended",
      ]);
      // Nothing told while the first sentence formed; told whole once it finished, the folded fragment in it.
      assert.deepEqual(drafts, [
        [],
        ["text:Halfway through the mailer."],
        ["text:Halfway through the mailer."],
      ]);

      const whole = await conversation();
      await play(events, standingFor(whole, BRAIN_HOST_TURN.TYPED));
      assert.deepEqual(await transcript(quiet), await transcript(whole));
      assert.deepEqual(standing.state.get(), { turns: {} });
      assert.deepEqual(refusals, []);
    }),
);
