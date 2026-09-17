import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { isToolUIPart } from "ai";
import { Effect } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { afterAll } from "vitest";
import {
  ASK_ORIGIN,
  BRAIN_REQUEST_FAILURE,
  BRAIN_RUN_EVENT,
  BRAIN_TOOL,
  CONVERSATION_EVENT_KIND,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  OBSERVATION_SOURCE,
  type SpokenAskMetadata,
  TOOL_PART_STATE,
  TURN_ORIGIN,
  TURN_STATUS,
} from "../server/core";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { offerBriefing } from "../server/hosted/brain-host/announce";
import { BRAIN_HOST_TURN, type BrainHostTurn } from "../server/hosted/brain-host/bounds";
import { readRecentMessages } from "../server/hosted/brain-host/context";
import { hostTurnId, reasoningItemId } from "../server/hosted/brain-host/ids";
import {
  FAILURE_DETAIL_BOUNDS,
  memoryRelayState,
  type RelayStanding,
  redactCredentials,
  StreamRelay,
} from "../server/hosted/brain-host/relay";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import { SPEECH_OFFER } from "../server/hosted/store/speech";
import { STORE_WRITE_REFUSAL } from "../server/hosted/store/writer";
import { stampedEveEvent } from "./support/eve-events";
import { spokenTurn } from "./support/eve-turns";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  insertConversation,
  readEventsByConversation,
  readMessagesByConversationTyped,
  readTurnsByConversation,
} from "./support/store-rows";

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

const writer = await database.run(
  storeWriter({
    tools: CATALOG_TOOL_SET,
  }),
);

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
  assert.ok(written.ok);
  const attached = await database.run(
    writer.attachSpokenAsk(target, { delegationId, rowIds: [rowId] }),
  );
  assert.ok(attached.ok);
  assert.deepEqual(attached.attached, [written.id]);
  return { ok: true, id: written.id };
}
const refusals: string[] = [];
/** The children whose sealed turn the relay handed to the completion seam, in order. */
const completed: string[] = [];
const relay = new StreamRelay({
  writer,
  asks: askRecord(),
  stopTurn: () => Effect.void,
  offer: (target, turnId) => offerBriefing({ writer, now: () => NOW }, target, turnId),
  deliverCompletion: (child) =>
    Effect.sync(() => {
      completed.push(child.conversationId);
    }),
  now: () => NOW,
  report: (message) => refusals.push(message),
});

async function conversation(
  kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND] = CONVERSATION_KIND.MAIN,
): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId, kind });
  return { userId, conversationId };
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
            toolName: BRAIN_TOOL.WRITE_WORKSPACE_FILE,
            input: { name: "USER.md", content: "- 2026-09-15: prefers short replies" },
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
          toolName: BRAIN_TOOL.WRITE_WORKSPACE_FILE,
          output: { status: "accepted", chars: 35 },
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
function standingFor(
  target: ConversationTarget,
  turn: BrainHostTurn | undefined,
  kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND] = CONVERSATION_KIND.MAIN,
): RelayStanding {
  return {
    sessionId: `wrun_${randomUUID()}`,
    target,
    kind,
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

/** The rows a device would take past the position it holds: the store's own cursor read, in sequence. */
async function pastCursor(target: ConversationTarget, after: number) {
  const read = await database.run(
    database.store.messages.list(target.userId, target.conversationId, CATALOG_TOOL_SET, { after }),
  );
  assert.ok(read.ok);
  return read.value;
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
        [STEP_START, "reasoning", `tool-${BRAIN_TOOL.WRITE_WORKSPACE_FILE}`, STEP_START, "text"],
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
      await record.dispatchOnce(spoken, ask.id, async () => ({
        sessionId: spokenStanding.sessionId,
        deliveryId: "delivery-1",
      }));
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
      await record.dispatchOnce(spoken, later.id, async () => ({
        sessionId: spokenStanding.sessionId,
        deliveryId: "delivery-2",
        turnId: spokenTurnId,
      }));
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
  "a spoken line that lands after the turn's first step is still placed ahead of the reply: the journal moves behind it to a fresh place, and a device that previewed the journal reads it again there",
  () =>
    Effect.promise(async () => {
      const spoken = await conversation();
      const standing = standingFor(spoken, BRAIN_HOST_TURN.SPOKEN);
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
      await record.dispatchOnce(spoken, ask.id, async () => ({
        sessionId: standing.sessionId,
        deliveryId: "delivery-1",
      }));
      const turn = spokenTurn("turn_0", NOW, ["delivery-1"]);
      const firstStep = turn.findIndex((event) => event.type === "step.started");
      // eve's turn starts, receives the ask, and opens its first step — the journal row — before
      // the voice writer's cut of the transcript lands.
      await play(turn.slice(0, firstStep + 1), standing);
      const turnId = hostTurnId(standing.sessionId, "turn_0");
      const previewed = await pastCursor(spoken, 0);
      assert.deepEqual(
        previewed.map((row) => [row.clientId, row.finishedAt === undefined]),
        [[turnId, true]],
      );
      const journalSeq = previewed[0]?.seq ?? 0;
      const transcript = await spokenLine(spoken, delegationId, "What changed?", {
        author: MESSAGE_AUTHOR.DEVELOPER,
        channel: MESSAGE_CHANNEL.VOICE,
      });
      assert.ok(transcript.ok);
      await play(turn.slice(firstStep + 1), standing);

      const { messageRows } = await rows(spoken);
      assert.deepEqual(
        messageRows.map((row) => [row.role, row.turnId, row.finishedAt !== null]),
        [
          [MESSAGE_ROLE.USER, turnId, true],
          [MESSAGE_ROLE.ASSISTANT, turnId, true],
        ],
      );
      // The journal's place moved past the line's, both past where the preview stood, so a
      // device holding the journal at its old place reads it again where it now stands.
      assert.ok((messageRows[0]?.seq ?? 0) > journalSeq);
      assert.ok((messageRows[1]?.seq ?? 0) > (messageRows[0]?.seq ?? 0));
      assert.deepEqual(
        (await pastCursor(spoken, journalSeq - 1)).map((row) => row.id),
        [transcript.id, messageRows[1]?.id],
      );
      assert.deepEqual(refusals, []);
    }),
);

it.effect("a tool call's part stands on the journal before its result and settles after", () =>
  Effect.promise(async () => {
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
      [STEP_START, `tool-${BRAIN_TOOL.WRITE_WORKSPACE_FILE}`],
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
  }),
);

it.effect(
  "an observation turn over a transcript change lands the same way, with the transcript change as its source, and its briefing is offered once however often the result is re-emitted",
  () =>
    Effect.promise(async () => {
      const target = await conversation(CONVERSATION_KIND.OBSERVED);
      const standing = standingFor(target, BRAIN_HOST_TURN.OBSERVATION);
      const turnId = "turn_0";
      await play(
        [
          stamped({ type: "turn.started", data: { turnId, sequence: 0 } }),
          stamped({
            type: "message.received",
            data: { turnId, sequence: 0, message: "[observed messages] ..." },
          }),
          stamped({
            type: "step.started",
            data: { turnId, sequence: 0, stepIndex: 0, modelId: "m" },
          }),
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
          stamped({
            type: "step.started",
            data: { turnId, sequence: 0, stepIndex: 1, modelId: "m" },
          }),
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
      assert.equal(turnRows[0]?.origin, TURN_ORIGIN.TRANSCRIPT_CHANGE);
      assert.equal(turnRows[0]?.status, TURN_STATUS.SETTLED);
      assert.equal(turnRows[0]?.usage, null);
      const [words, answer] = messageRows;
      assert.ok(words && answer);
      assert.deepEqual(words.metadata, {
        author: MESSAGE_AUTHOR.BRAIN,
        source: OBSERVATION_SOURCE.TRANSCRIPT_CHANGE,
      });
      // The second step delivered nothing to announce, and stands as its boundary alone.
      assert.deepEqual(
        answer.parts.map((part) => part.type),
        [STEP_START, `tool-${BRAIN_TOOL.ANNOUNCE}`, STEP_START],
      );
      const offered = (await readEventsByConversation(database.run, target.conversationId)).map(
        (event) => ({ kind: event.kind, messageId: event.messageId, payload: event.payload }),
      );
      assert.deepEqual(offered, [
        {
          kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
          messageId: answer.id,
          payload: { expiresAt: NOW + SPEECH_OFFER.TTL_MS },
        },
      ]);
    }),
);

it.effect(
  "a failed turn settles its journal and names the failure; a cancelled one settles its unanswered parts",
  () =>
    Effect.promise(async () => {
      const failed = await conversation();
      const failedStanding = standingFor(failed, BRAIN_HOST_TURN.TYPED);
      const events = typedTurn("turn_0", 0);
      const requested = events.findIndex((event) => event.type === "actions.requested");
      await play(events.slice(0, requested + 1), failedStanding);
      await database.run(
        relay.handle(
          stamped({
            type: "turn.failed",
            data: {
              turnId: "turn_0",
              sequence: 0,
              code: "model_error",
              message: "upstream failed: key sk-fixture0001 refused",
              details: {
                name: "AI_APICallError",
                statusCode: 429,
                apiErrorMessage: "key sk-fixture0001 refused",
                detail: "Error: at fixture.ts:1",
              },
            },
          }),
          failedStanding,
        ),
      );
      const failedRows = await rows(failed);
      assert.equal(failedRows.turnRows[0]?.status, TURN_STATUS.FAILED);
      assert.equal(failedRows.turnRows[0]?.failure, "model");
      // The row keeps eve's code, the details' key names, their fixed words, and the message with its key redacted; no other value of the details.
      assert.equal(
        failedRows.turnRows[0]?.failureDetail,
        "model_error [apiErrorMessage,detail,name,statusCode] AI_APICallError 429 upstream failed: key [redacted] refused",
      );

      // A name not shaped like an error's class name is an unrecognized error's own, and no value of those details is kept.
      const unshaped = await conversation();
      const unshapedStanding = standingFor(unshaped, BRAIN_HOST_TURN.TYPED);
      await play(events.slice(0, requested + 1), unshapedStanding);
      await database.run(
        relay.handle(
          stamped({
            type: "turn.failed",
            data: {
              turnId: "turn_0",
              sequence: 0,
              code: "model_error",
              message: "refused",
              details: { name: "token sk-fixture", statusCode: 401 },
            },
          }),
          unshapedStanding,
        ),
      );
      assert.equal(
        (await rows(unshaped)).turnRows[0]?.failureDetail,
        "model_error [name,statusCode] refused",
      );

      // The message is redacted before it is cut, so a key the cut would have split leaves nothing of itself; the key list is bounded on its own.
      const bounded = await conversation();
      const boundedStanding = standingFor(bounded, BRAIN_HOST_TURN.TYPED);
      await play(events.slice(0, requested + 1), boundedStanding);
      const prose = "word ".repeat(39).trimEnd();
      const details = Object.fromEntries(
        Array.from({ length: 30 }, (_, index) => [`field${String(index).padStart(2, "0")}`, index]),
      );
      await database.run(
        relay.handle(
          stamped({
            type: "turn.failed",
            data: {
              turnId: "turn_0",
              sequence: 0,
              code: "model_error",
              message: `${prose} sk-${"k".repeat(24)}`,
              details,
            },
          }),
          boundedStanding,
        ),
      );
      const keys = Object.keys(details).sort().join(",");
      assert.ok(keys.length > FAILURE_DETAIL_BOUNDS.KEYS_CHARS);
      assert.equal(
        (await rows(bounded)).turnRows[0]?.failureDetail,
        `model_error [${keys.slice(0, FAILURE_DETAIL_BOUNDS.KEYS_CHARS)}] ${`${prose} [redacted]`.slice(0, FAILURE_DETAIL_BOUNDS.MESSAGE_CHARS)}`,
      );
      const failedJournal = failedRows.messageRows.find(
        (row) => row.role === MESSAGE_ROLE.ASSISTANT,
      );
      assert.ok(failedJournal);
      assert.notEqual(failedJournal.finishedAt, null);

      const cancelled = await conversation();
      const cancelledStanding = standingFor(cancelled, BRAIN_HOST_TURN.TYPED);
      await play(events.slice(0, requested + 1), cancelledStanding);
      await database.run(
        relay.handle(
          stamped({ type: "turn.cancelled", data: { turnId: "turn_0", sequence: 0 } }),
          cancelledStanding,
        ),
      );
      const cancelledRows = await rows(cancelled);
      assert.equal(cancelledRows.turnRows[0]?.status, TURN_STATUS.CANCELLED);
      const journal = cancelledRows.messageRows.find((row) => row.role === MESSAGE_ROLE.ASSISTANT);
      assert.ok(journal);
      const part = journal.parts.find((candidate) => isToolUIPart(candidate));
      assert.ok(part);
      assert.notEqual(part.state, TOOL_PART_STATE.INPUT_AVAILABLE);
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
        [STEP_START, "reasoning", `tool-${BRAIN_TOOL.WRITE_WORKSPACE_FILE}`, STEP_START, "text"],
      );
    }),
);

it.effect(
  "a reasoning item eve names no id for is journaled under the id the relay mints for its step, and the answer keeps that id",
  () =>
    Effect.promise(async () => {
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
    }),
);

it.effect(
  "a step that produced nothing still stands as its boundary, told once however often eve starts it again",
  () =>
    Effect.promise(async () => {
      const target = await conversation();
      const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
      const turnId = "turn_0";
      await play(
        [
          stamped({ type: "turn.started", data: { turnId, sequence: 0 } }),
          stamped({ type: "message.received", data: { turnId, sequence: 0, message: "hello" } }),
          stamped({
            type: "step.started",
            data: { turnId, sequence: 0, stepIndex: 0, modelId: "m" },
          }),
          stamped({
            type: "step.started",
            data: { turnId, sequence: 0, stepIndex: 0, modelId: "m" },
          }),
          stamped({
            type: "step.started",
            data: { turnId, sequence: 0, stepIndex: 1, modelId: "m" },
          }),
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
    }),
);

it.effect(
  "a step eve re-runs whole after a failed attempt keeps the first attempt's reasoning under its ordinal and lands the second's beside it under the next; the stream replayed in its order adds nothing",
  () =>
    Effect.promise(async () => {
      const target = await conversation();
      const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
      const turnId = "turn_0";
      const step = (reasoning: string) => [
        stamped({
          type: "step.started",
          data: { turnId, sequence: 0, stepIndex: 0, modelId: "m" },
        }),
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
      const minted = [0, 1].map((ordinal) =>
        reasoningItemId(standing.sessionId, turnId, 0, ordinal),
      );
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
    }),
);

it.effect(
  "a turn whose request named no kind is not recorded, and the refusal is reported rather than thrown",
  () =>
    Effect.promise(async () => {
      const target = await conversation();
      const standing = standingFor(target, undefined);
      const before = refusals.length;
      await play(typedTurn("turn_0", 0), standing);
      const { turnRows, messageRows } = await rows(target);
      assert.equal(turnRows.length, 0);
      assert.equal(messageRows.length, 0);
      assert.equal(refusals.length, before + 1);
    }),
);

it.effect(
  "a second turn of the same session is another turn row, keyed from eve's own turn id",
  () =>
    Effect.promise(async () => {
      const target = await conversation();
      const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
      await play(typedTurn("turn_0", 0), standing);
      await play(typedTurn("turn_1", 1), standing);
      const { turnRows } = await rows(target);
      assert.deepEqual(
        turnRows.map((row) => row.id).sort(),
        [hostTurnId(standing.sessionId, "turn_0"), hostTurnId(standing.sessionId, "turn_1")].sort(),
      );
      assert.deepEqual(turnRows.map((row) => row.eveTurnId).sort(), ["turn_0", "turn_1"]);
      assert.equal(
        (await readMessagesByConversationTyped(database.run, target.conversationId)).filter(
          (row) => row.role === MESSAGE_ROLE.USER,
        ).length,
        2,
      );
    }),
);

it.effect(
  "the recent exchange reads back the newest finished messages, oldest first, and never a journal still open",
  () =>
    Effect.promise(async () => {
      const target = await conversation();
      const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
      const tools = CATALOG_TOOL_SET;
      await play(typedTurn("turn_0", 0), standing);
      const events = typedTurn("turn_1", 1);
      const requested = events.findIndex((event) => event.type === "actions.requested");
      await play(events.slice(0, requested + 1), standing);

      const recent = await database.run(readRecentMessages(target, tools, 10));
      assert.deepEqual(
        recent.map((message) => message.role),
        [MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT, MESSAGE_ROLE.USER],
      );
      const newest = await database.run(readRecentMessages(target, tools, 1));
      assert.deepEqual(
        newest.map((message) => message.role),
        [MESSAGE_ROLE.USER],
      );

      await play(events.slice(requested + 1), standing);
      const settled = await database.run(readRecentMessages(target, tools, 10));
      assert.equal(settled.length, 4);
      assert.equal(settled.at(-1)?.role, MESSAGE_ROLE.ASSISTANT);
    }),
);

it.effect(
  "a turn whose answer the store refuses ends failed for persistence rather than sealed without its words",
  () =>
    Effect.promise(async () => {
      const target = await conversation();
      const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
      const refusing = new StreamRelay({
        asks: askRecord(),
        stopTurn: () => Effect.void,
        writer: {
          consume: (to, event) =>
            event.kind === BRAIN_RUN_EVENT.MESSAGE_COMPLETED &&
            event.message.role === MESSAGE_ROLE.ASSISTANT
              ? Effect.succeed({ ok: false, refusal: STORE_WRITE_REFUSAL.NO_TURN })
              : writer.consume(to, event),
          enqueueTurn: (to, enqueue) => writer.enqueueTurn(to, enqueue),
          attachAskLines: (to, turnId) => writer.attachAskLines(to, turnId),
        },
        offer: () => Effect.succeed(true),
        deliverCompletion: () => Effect.void,
        now: () => NOW,
        report: (message) => refusals.push(message),
      });
      for (const event of typedTurn("turn_0", 0))
        await database.run(refusing.handle(event, standing));

      const { turnRows } = await rows(target);
      assert.equal(turnRows[0]?.status, TURN_STATUS.FAILED);
      assert.equal(turnRows[0]?.failure, BRAIN_REQUEST_FAILURE.PERSISTENCE);
    }),
);

it.effect(
  "a turn start whose write throws keeps nothing in relay state, so the start eve emits again queues the row",
  () =>
    Effect.promise(async () => {
      const target = await conversation();
      const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
      let failures = 1;
      const failing = new StreamRelay({
        asks: askRecord(),
        stopTurn: () => Effect.void,
        writer: {
          consume: (to, event) => writer.consume(to, event),
          enqueueTurn: (to, enqueue) => {
            if (failures > 0) {
              failures -= 1;
              return Effect.die(new Error("the database went away"));
            }
            return writer.enqueueTurn(to, enqueue);
          },
          attachAskLines: (to, turnId) => writer.attachAskLines(to, turnId),
        },
        offer: () => Effect.succeed(true),
        deliverCompletion: () => Effect.void,
        now: () => NOW,
        report: (message) => refusals.push(message),
      });
      const started = () =>
        stamped({ type: "turn.started", data: { turnId: "turn_0", sequence: 0 } });
      await assert.rejects(() => database.run(failing.handle(started(), standing)), Error);
      assert.deepEqual(standing.state.get(), { turns: {} });
      assert.equal((await rows(target)).turnRows.length, 0);

      await database.run(failing.handle(started(), standing));
      assert.equal(Object.hasOwn(standing.state.get().turns, "turn_0"), true);
      const { turnRows } = await rows(target);
      assert.equal(turnRows.length, 1);
      assert.equal(turnRows[0]?.status, TURN_STATUS.RUNNING);
    }),
);

it.effect(
  "a turn whose ask the store refuses writes no answer and ends failed for persistence, so no reply settles against a missing ask",
  () =>
    Effect.promise(async () => {
      const target = await conversation();
      const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
      const refusing = new StreamRelay({
        asks: askRecord(),
        stopTurn: () => Effect.void,
        writer: {
          consume: (to, event) =>
            event.kind === BRAIN_RUN_EVENT.MESSAGE_COMPLETED &&
            event.message.role === MESSAGE_ROLE.USER
              ? Effect.succeed({ ok: false, refusal: STORE_WRITE_REFUSAL.NO_TURN })
              : writer.consume(to, event),
          enqueueTurn: (to, enqueue) => writer.enqueueTurn(to, enqueue),
          attachAskLines: (to, turnId) => writer.attachAskLines(to, turnId),
        },
        offer: () => Effect.succeed(true),
        deliverCompletion: () => Effect.void,
        now: () => NOW,
        report: (message) => refusals.push(message),
      });
      for (const event of typedTurn("turn_0", 0))
        await database.run(refusing.handle(event, standing));

      const { turnRows, messageRows } = await rows(target);
      assert.equal(turnRows[0]?.status, TURN_STATUS.FAILED);
      assert.equal(turnRows[0]?.failure, BRAIN_REQUEST_FAILURE.PERSISTENCE);
      // The journal of what the model did stands; the answer to the missing ask does not.
      assert.deepEqual(
        messageRows.map((row) => [row.role, row.parts.map((part) => part.type)]),
        [
          [
            MESSAGE_ROLE.ASSISTANT,
            [STEP_START, `tool-${BRAIN_TOOL.WRITE_WORKSPACE_FILE}`, "reasoning", STEP_START],
          ],
        ],
      );
      assert.deepEqual(standing.state.get(), { turns: {} });
    }),
);

it.effect(
  "a turn end the store refuses keeps the turn in relay state, so the boundary eve re-emits settles the row instead of finding nothing",
  () =>
    Effect.promise(async () => {
      const target = await conversation();
      const standing = standingFor(target, BRAIN_HOST_TURN.TYPED);
      let refuseEnds = 1;
      const refusing = new StreamRelay({
        asks: askRecord(),
        stopTurn: () => Effect.void,
        writer: {
          consume: (to, event) => {
            if (event.kind === BRAIN_RUN_EVENT.TURN_ENDED && refuseEnds > 0) {
              refuseEnds -= 1;
              return Effect.succeed({ ok: false, refusal: STORE_WRITE_REFUSAL.NO_TURN });
            }
            return writer.consume(to, event);
          },
          enqueueTurn: (to, enqueue) => writer.enqueueTurn(to, enqueue),
          attachAskLines: (to, turnId) => writer.attachAskLines(to, turnId),
        },
        offer: () => Effect.succeed(true),
        deliverCompletion: () => Effect.void,
        now: () => NOW,
        report: (message) => refusals.push(message),
      });
      const events = typedTurn("turn_0", 0);
      for (const event of events) await database.run(refusing.handle(event, standing));
      assert.equal(Object.hasOwn(standing.state.get().turns, "turn_0"), true);
      const running = await rows(target);
      assert.equal(running.turnRows[0]?.status, TURN_STATUS.RUNNING);

      await database.run(
        refusing.handle(
          stamped({ type: "turn.completed", data: { turnId: "turn_0", sequence: 0 } }),
          standing,
        ),
      );
      assert.deepEqual(standing.state.get(), { turns: {} });
      const settled = await rows(target);
      assert.equal(settled.turnRows.length, 1);
      assert.equal(settled.turnRows[0]?.status, TURN_STATUS.SETTLED);
      assert.equal(
        settled.messageRows.filter((row) => row.role === MESSAGE_ROLE.ASSISTANT).length,
        1,
      );
    }),
);

it.effect(
  "a sealed turn of a child conversation hands the child to the completion seam once; a turn of any other kind of conversation hands nothing",
  () =>
    Effect.promise(async () => {
      completed.length = 0;
      const child = await conversation(CONVERSATION_KIND.CHILD);
      await play(
        typedTurn("turn_0", 0),
        standingFor(child, BRAIN_HOST_TURN.CHILD_TASK, CONVERSATION_KIND.CHILD),
      );
      assert.deepEqual(completed, [child.conversationId]);

      // The end eve re-emits finds the turn gone from relay state and reaches the seam again by nothing here;
      // the seam's own claim is what makes a second visit deliver nothing.
      const [ended] = typedTurn("turn_0", 0).slice(-1);
      assert.ok(ended);
      await play([ended], standingFor(child, BRAIN_HOST_TURN.CHILD_TASK, CONVERSATION_KIND.CHILD));
      assert.deepEqual(completed, [child.conversationId]);

      const main = await conversation(CONVERSATION_KIND.MAIN);
      await play(typedTurn("turn_1", 1), standingFor(main, BRAIN_HOST_TURN.TYPED));
      assert.deepEqual(completed, [child.conversationId]);
    }),
);

it.effect(
  "a completion seam that fails is said and leaves the seal standing rather than failing the hook",
  () =>
    Effect.promise(async () => {
      const failing = new StreamRelay({
        writer,
        asks: askRecord(),
        stopTurn: () => Effect.void,
        offer: () => Effect.succeed(true),
        deliverCompletion: () => Effect.die(new Error("the completion store is down")),
        now: () => NOW,
        report: (message) => refusals.push(message),
      });
      const child = await conversation(CONVERSATION_KIND.CHILD);
      const standing = standingFor(child, BRAIN_HOST_TURN.CHILD_TASK, CONVERSATION_KIND.CHILD);
      for (const event of typedTurn("turn_0", 0))
        await database.run(failing.handle(event, standing));

      const { turnRows } = await rows(child);
      assert.equal(turnRows[0]?.status, TURN_STATUS.SETTLED);
      assert.ok(
        refusals.some((message) =>
          message.includes(
            `The completion of child ${child.conversationId} could not be delivered`,
          ),
        ),
      );
      assert.deepEqual(standing.state.get().turns, {});
    }),
);

it.effect(
  "a child-task turn lands under the child origin and a child-completion turn under the child_completion origin, each received message the brain's own note",
  () =>
    Effect.promise(async () => {
      for (const [turn, origin, source] of [
        [BRAIN_HOST_TURN.CHILD_TASK, TURN_ORIGIN.CHILD, OBSERVATION_SOURCE.CHILD],
        [
          BRAIN_HOST_TURN.CHILD_COMPLETION,
          TURN_ORIGIN.CHILD_COMPLETION,
          OBSERVATION_SOURCE.CHILD_COMPLETION,
        ],
      ] as const) {
        const target = await conversation(CONVERSATION_KIND.OBSERVED);
        await play(typedTurn("turn_0", 0), standingFor(target, turn));

        const { turnRows, messageRows } = await rows(target);
        assert.equal(turnRows.length, 1);
        assert.equal(turnRows[0]?.origin, origin);
        assert.equal(turnRows[0]?.status, TURN_STATUS.SETTLED);
        const words = messageRows.find((row) => row.role === MESSAGE_ROLE.USER);
        assert.ok(words);
        assert.deepEqual(words.metadata, { author: MESSAGE_AUTHOR.BRAIN, source });
      }
    }),
);

it("a failure message keeps its words and loses every run shaped like a credential", () => {
  assert.equal(
    redactCredentials("Rate limit reached for gpt-5 in organization org-fixture on tokens per min"),
    "Rate limit reached for gpt-5 in organization org-fixture on tokens per min",
  );
  assert.equal(redactCredentials("key sk-fixture0001 refused"), "key [redacted] refused");
  assert.equal(
    redactCredentials("Authorization: Bearer abc.def refused"),
    "Authorization: [redacted] refused",
  );
  assert.equal(
    redactCredentials(`token eyJ${"a".repeat(16)}.payload expired`),
    "token [redacted] expired",
  );
  assert.equal(
    redactCredentials(`digest ${"0f".repeat(16)} mismatched`),
    "digest [redacted] mismatched",
  );
  assert.equal(
    redactCredentials(`blob ${"Ab+/".repeat(8)}= mismatched`),
    "blob [redacted] mismatched",
  );
  assert.equal(
    redactCredentials("url ?api_key=fixture&token=fixture&error=model_not_found secret=fixture"),
    "url ?[redacted]&[redacted]&error=model_not_found [redacted]",
  );
  // A named value is taken whole before the bare run can take its head and leave its tail.
  assert.equal(redactCredentials(`token=${"A".repeat(40)}-tail refused`), "[redacted] refused");
  assert.equal(
    redactCredentials(`{"api_key": "short-mixed_secret", "model": "gpt-5"}`),
    `{"[redacted]", "model": "gpt-5"}`,
  );
  assert.equal(
    redactCredentials(`id AKIA${"A".repeat(16)} and ${"a_b-".repeat(9)} refused`),
    "id [redacted] and [redacted] refused",
  );
  assert.equal(redactCredentials("Invalid API key provided"), "Invalid API key provided");
});
