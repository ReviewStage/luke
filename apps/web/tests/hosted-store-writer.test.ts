import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "@luke/database/core/query";
import { EpochMillisColumnSchema } from "@luke/database/models/columns";
import {
  type ConversationTarget,
  STORE_WRITE_EFFECT,
  STORE_WRITE_REFUSAL,
  type StoreWriteResult,
  storeWriter,
} from "@luke/database/models/writer";
import { conversations } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import {
  insertConversation,
  openHostedStoreTestDatabase,
  readMessagesByConversationTyped,
  readTurnById,
  setConversationDeletedAt,
} from "@luke/database/testing";
import {
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  type BrainRequestFailure,
  type BrainRunEvent,
  type BrainRunEventBody,
  type BrainTurnOrigin,
  type BrainTurnTrigger,
  TOOL_CALL_SETTLEMENT,
  type ToolCallSettlement,
  toolPartType,
  UI_PART_STATE,
  UI_PART_TYPE,
} from "@luke/features/brain";
import { sessionKey } from "@luke/runtime/vocabulary";
import {
  ACTION_RESULT_STATUS,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
  UNKNOWN_ACTION_STATUS,
  type UnparsedWireValue,
  type UserMessageMetadata,
  unparsedWire,
} from "@luke/wire";
import { readStoredUIMessages, TOOL_PART_STATE } from "@luke/wire/ui-messages";
import { type ToolSet, tool, type UIMessage } from "ai";
import { eq } from "drizzle-orm";
import { Option, Result, Schema } from "effect";
import { afterAll, test } from "vitest";
import { z } from "zod";

/**
 * The store writer over the real migrations on PGlite. Synthetic fixtures
 * throughout: no real title, branch, transcript, or spoken word. What these
 * tests hold to is the record the plan describes — which rows a turn of each
 * kind leaves, in which states, in which order — and never the words in them.
 */

const NOW = 1_800_000_000_000;

type TurnFailure = BrainRequestFailure;

/** The statuses a refused call settles under, as the run stream's own settlement types them. */
type ToolRefusalStatus = Extract<
  ToolCallSettlement,
  { readonly state: typeof TOOL_CALL_SETTLEMENT.OUTPUT_ERROR }
>["status"];

const database = await openHostedStoreTestDatabase({ at: NOW });
afterAll(() => database.close());

/** The envelope any call may answer with: its effect unknown. Every declared output schema admits it. */
const UNKNOWN_OUTCOME = z.object({
  status: z.literal(UNKNOWN_ACTION_STATUS),
  reason: z.string(),
});

const TOOLS: ToolSet = {
  read_transcript: tool({
    description: "Reads the tail of an observed session's transcript.",
    inputSchema: z.object({ providerId: z.string(), providerSessionId: z.string() }),
    outputSchema: z.union([z.object({ lines: z.array(z.string()) }), UNKNOWN_OUTCOME]),
  }),
  announce: tool({
    description: "Says a briefing aloud.",
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ status: z.string() }),
  }),
  send_session_message: tool({
    description: "Sends a message to an observed session.",
    inputSchema: z.object({
      providerId: z.string(),
      providerSessionId: z.string(),
      text: z.string(),
    }),
    // An action's output is its envelope, whichever way it went: a tool that declares an output
    // schema has to admit the unknown outcome, or the reader refuses the row of a call that did not answer.
    outputSchema: z.object({
      status: z.enum([
        ACTION_RESULT_STATUS.ACCEPTED,
        UNKNOWN_ACTION_STATUS,
        ACTION_RESULT_STATUS.REJECTED,
      ]),
      reason: z.string().optional(),
    }),
  }),
};

const TRANSCRIPT_INPUT = { providerId: "example", providerSessionId: "s-1" };
const TRANSCRIPT_OUTPUT = { lines: ["user: fixture ask", "assistant: fixture reply"] };

const TYPED_ASK: UserMessageMetadata = {
  author: MESSAGE_AUTHOR.DEVELOPER,
  channel: MESSAGE_CHANNEL.TYPED,
};

const writer = await database.run(storeWriter({ tools: TOOLS }));

/** Messages as they cross into the reader: their JSON shape, which is what a row holds. */
function asWire(stored: readonly UIMessage[]): UnparsedWireValue {
  return unparsedWire(JSON.parse(JSON.stringify(stored)));
}

async function conversation(
  kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND] = CONVERSATION_KIND.MAIN,
): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId, kind });
  return { userId, conversationId };
}

/** One turn's stream, numbered as the turn's teller numbers it. */
class Stream {
  readonly turnId = randomUUID();
  #sequence = 0;

  event(body: BrainRunEventBody): BrainRunEvent {
    this.#sequence += 1;
    return {
      ...body,
      conversationId: sessionKey("main"),
      turnId: this.turnId,
      sequence: this.#sequence,
    };
  }

  started(origin: BrainTurnOrigin, trigger: BrainTurnTrigger, at = NOW): BrainRunEvent {
    return this.event({ kind: BRAIN_RUN_EVENT.TURN_STARTED, origin, trigger, at });
  }

  words(id: string, text: string, metadata: UserMessageMetadata): BrainRunEvent {
    return this.event({
      kind: BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
      message: {
        id,
        role: MESSAGE_ROLE.USER,
        metadata,
        parts: [{ type: UI_PART_TYPE.TEXT, text, state: UI_PART_STATE.DONE }],
      },
    });
  }

  step(step: number): BrainRunEvent {
    return this.event({ kind: BRAIN_RUN_EVENT.STEP_STARTED, step });
  }

  toolCall(callId: string, name: string, input: UnparsedWireValue): BrainRunEvent {
    return this.event({ kind: BRAIN_RUN_EVENT.TOOL_CALL_STARTED, callId, name, input });
  }

  toolAnswered(callId: string, name: string, output: UnparsedWireValue): BrainRunEvent {
    return this.event({
      kind: BRAIN_RUN_EVENT.TOOL_CALL_SETTLED,
      callId,
      name,
      settlement: { state: TOOL_CALL_SETTLEMENT.OUTPUT_AVAILABLE, output },
    });
  }

  toolFailed(
    callId: string,
    name: string,
    errorText: string,
    status: ToolRefusalStatus,
  ): BrainRunEvent {
    return this.event({
      kind: BRAIN_RUN_EVENT.TOOL_CALL_SETTLED,
      callId,
      name,
      settlement: {
        state: TOOL_CALL_SETTLEMENT.OUTPUT_ERROR,
        output: { status, reason: errorText },
        errorText,
        status,
      },
    });
  }

  reasoning(itemId: string, summary: string): BrainRunEvent {
    return this.event({
      kind: BRAIN_RUN_EVENT.REASONING_COMPLETED,
      summary,
      item: { type: "reasoning", id: itemId, encrypted_content: "b3BhcXVl" },
    });
  }

  answered(id: string, parts: UIMessage["parts"]): BrainRunEvent {
    return this.event({
      kind: BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
      message: {
        id,
        role: MESSAGE_ROLE.ASSISTANT,
        metadata: { author: MESSAGE_AUTHOR.BRAIN },
        parts,
      },
    });
  }

  ended(
    status: (typeof BRAIN_REQUEST_STATUS)[keyof typeof BRAIN_REQUEST_STATUS],
    options: {
      failure?: TurnFailure;
      failureDetail?: string;
      responseIds?: readonly string[];
      at?: number;
    } = {},
  ): BrainRunEvent {
    return this.event({
      kind: BRAIN_RUN_EVENT.TURN_ENDED,
      status,
      ...(options.failure !== undefined ? { failure: options.failure } : undefined),
      ...(options.failureDetail !== undefined
        ? { failureDetail: options.failureDetail }
        : undefined),
      usage: { inputTokens: 120, outputTokens: 30, cachedInputTokens: 40, reasoningTokens: 10 },
      responseIds: options.responseIds ?? [],
      at: options.at ?? NOW + 1_000,
    });
  }
}

async function feed(
  target: ConversationTarget,
  stream: readonly BrainRunEvent[],
): Promise<readonly StoreWriteResult[]> {
  const results: StoreWriteResult[] = [];
  for (const event of stream) results.push(await database.run(writer.consume(target, event)));
  return results;
}

function effects(results: readonly StoreWriteResult[]): readonly string[] {
  return results.map((result) =>
    Result.isSuccess(result) ? result.success : result.failure.refusal,
  );
}

async function storedMessages(target: ConversationTarget) {
  return readMessagesByConversationTyped(database.run, target.conversationId);
}

async function storedTurn(turnId: string) {
  return readTurnById(database.run, turnId);
}

const CountersRowSchema = Schema.Struct({ message: EpochMillisColumnSchema });

async function counters(target: ConversationTarget) {
  const [row] = await database.run(
    Database.use((db) =>
      db
        .select({ message: conversations.nextMessageSeq })
        .from(conversations)
        .where(eq(conversations.id, target.conversationId)),
    ),
  );
  return row === undefined ? undefined : Schema.decodeUnknownSync(CountersRowSchema)(row);
}

type Part = UIMessage["parts"][number];

const answeredCall = (callId: string): Part => ({
  type: toolPartType("read_transcript"),
  toolCallId: callId,
  state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
  input: TRANSCRIPT_INPUT,
  output: TRANSCRIPT_OUTPUT,
});

const REPLY_PARTS: UIMessage["parts"] = [
  {
    type: UI_PART_TYPE.REASONING,
    id: "rs_1",
    text: "Read the tail first.",
    state: UI_PART_STATE.DONE,
    providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: "b3BhcXVl" } },
  },
  answeredCall("call_1"),
  { type: UI_PART_TYPE.TEXT, text: "It is waiting on a permission.", state: UI_PART_STATE.DONE },
];

/** A developer's typed ask that reads one transcript and answers, told from start to end. */
function developerTurn(stream: Stream, askId: string, replyId: string): readonly BrainRunEvent[] {
  return [
    stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK),
    stream.words(askId, "What is the fixture session doing?", TYPED_ASK),
    stream.toolCall("call_1", "read_transcript", TRANSCRIPT_INPUT),
    stream.toolAnswered("call_1", "read_transcript", TRANSCRIPT_OUTPUT),
    stream.reasoning("rs_1", "Read the tail first."),
    stream.answered(replyId, REPLY_PARTS),
    stream.ended(BRAIN_REQUEST_STATUS.SUCCEEDED, { responseIds: ["resp_1", "resp_2"] }),
  ];
}

test("a developer turn leaves its ask, its journal closed as the answer told, and a settled turn", async () => {
  const target = await conversation();
  const stream = new Stream();
  const askId = randomUUID();
  const results = await feed(target, developerTurn(stream, askId, randomUUID()));
  assert.deepEqual(
    effects(results),
    results.map(() => STORE_WRITE_EFFECT.WRITTEN),
  );

  const rows = await storedMessages(target);
  assert.deepEqual(
    rows.map((row) => ({
      seq: row.seq,
      role: row.role,
      clientId: row.clientId,
      turnId: row.turnId,
      finished: row.finishedAt !== null,
    })),
    [
      { seq: 1, role: MESSAGE_ROLE.USER, clientId: askId, turnId: stream.turnId, finished: true },
      {
        seq: 2,
        role: MESSAGE_ROLE.ASSISTANT,
        clientId: stream.turnId,
        turnId: stream.turnId,
        finished: true,
      },
    ],
  );
  assert.deepEqual(rows[0]?.metadata, TYPED_ASK);
  assert.deepEqual(rows[1]?.metadata, { author: MESSAGE_AUTHOR.BRAIN });
  assert.deepEqual(rows[1]?.parts, REPLY_PARTS);
  assert.deepEqual(await counters(target), { message: 3 });

  const turn = await storedTurn(stream.turnId);
  assert.deepEqual(
    {
      origin: turn?.origin,
      status: turn?.status,
      queuedAt: turn?.queuedAt?.getTime(),
      startedAt: turn?.startedAt?.getTime(),
      settledAt: turn?.settledAt?.getTime(),
      failure: turn?.failure,
      usage: turn?.usage,
      responseIds: turn?.responseIds,
    },
    {
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.SETTLED,
      queuedAt: NOW,
      startedAt: NOW,
      settledAt: NOW + 1_000,
      failure: null,
      usage: { inputTokens: 120, outputTokens: 30, cachedInputTokens: 40, reasoningTokens: 10 },
      responseIds: ["resp_1", "resp_2"],
    },
  );

  const read = await database.run(
    readStoredUIMessages(
      asWire(
        rows.map((row) => ({
          id: row.clientId,
          role: row.role,
          metadata: row.metadata,
          parts: row.parts,
        })),
      ),
      TOOLS,
    ),
  );
  assert.equal(read.ok, true);
});

test("every event delivered twice, and the whole stream replayed, writes one row each and moves no sequence", async () => {
  const target = await conversation();
  const stream = new Stream();
  const turn = developerTurn(stream, randomUUID(), randomUUID());
  const first: StoreWriteResult[] = [];
  const second: StoreWriteResult[] = [];
  for (const event of turn) {
    first.push(await database.run(writer.consume(target, event)));
    second.push(await database.run(writer.consume(target, event)));
  }
  assert.equal(
    first.every(
      (result) => Result.isSuccess(result) && result.success === STORE_WRITE_EFFECT.WRITTEN,
    ),
    true,
  );
  assert.deepEqual(
    effects(second),
    turn.map(() => STORE_WRITE_EFFECT.REPEATED),
  );
  const replayed = await feed(target, turn);
  assert.deepEqual(
    effects(replayed),
    turn.map(() => STORE_WRITE_EFFECT.REPEATED),
  );
  const rows = await storedMessages(target);
  assert.deepEqual(
    rows.map((row) => row.seq),
    [1, 2],
  );
  assert.deepEqual(await counters(target), { message: 3 });
});

test("a cleared conversation is written by nothing, like one that never was", async () => {
  const target = await conversation();
  await setConversationDeletedAt(database.run, target.conversationId, new Date(NOW));
  const stream = new Stream();
  const started = await database.run(
    writer.consume(target, stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK)),
  );
  assert.deepEqual(started, Result.fail({ refusal: STORE_WRITE_REFUSAL.NO_CONVERSATION }));
  const queued = await database.run(writer.enqueueTurn(target, { origin: TURN_ORIGIN.TYPED }));
  assert.deepEqual(queued, Result.fail({ refusal: STORE_WRITE_REFUSAL.NO_CONVERSATION }));
});

test("a spoken reply is a finished assistant row under no turn, once per client id; the latest spoken line is found by its span and names the delegation that owns it", async () => {
  const target = await conversation();
  const spokenLine = (clientId: string, fromMs: number, toMs: number, delegationId?: string) =>
    database.run(
      writer.upsertSpokenRow(target, {
        role: MESSAGE_ROLE.USER,
        clientId,
        text: `line ${fromMs}`,
        metadata: {
          author: MESSAGE_AUTHOR.DEVELOPER,
          channel: MESSAGE_CHANNEL.VOICE,
          voice_session_id: "vs_fixture_1",
          ...(delegationId === undefined ? undefined : { delegation_id: delegationId }),
          from_ms: fromMs,
          to_ms: toMs,
        },
      }),
    );
  assert.ok(Result.isSuccess(await spokenLine("line-1", 1000, 2000)));
  assert.ok(Result.isSuccess(await spokenLine("dl_1", 3000, 4000, "dl_1")));

  const reply = await database.run(
    writer.upsertSpokenRow(target, {
      role: MESSAGE_ROLE.ASSISTANT,
      clientId: "reply-1",
      text: "Answered aloud.",
      metadata: { author: MESSAGE_AUTHOR.VOICE_MODEL },
    }),
  );
  assert.ok(Result.isSuccess(reply));
  if (!Result.isSuccess(reply)) return;
  assert.equal(reply.success.effect, STORE_WRITE_EFFECT.WRITTEN);
  const again = await database.run(
    writer.upsertSpokenRow(target, {
      role: MESSAGE_ROLE.ASSISTANT,
      clientId: "reply-1",
      text: "Answered aloud.",
      metadata: { author: MESSAGE_AUTHOR.VOICE_MODEL },
    }),
  );
  // Told again under the same id, the row is grown in place rather than doubled.
  assert.ok(Result.isSuccess(again));
  if (!Result.isSuccess(again)) return;
  assert.deepEqual(
    [again.success.id, again.success.effect],
    [reply.success.id, STORE_WRITE_EFFECT.WRITTEN],
  );
  const rows = await storedMessages(target);
  assert.deepEqual(
    rows.map((row) => [row.clientId, row.role, row.turnId, row.finishedAt !== null]),
    [
      ["line-1", MESSAGE_ROLE.USER, null, true],
      ["dl_1", MESSAGE_ROLE.USER, null, true],
      ["reply-1", MESSAGE_ROLE.ASSISTANT, null, true],
    ],
  );

  const ownLine = await database.run(
    writer.latestSpokenLine(target, {
      voiceSessionId: "vs_fixture_1",
      startingAtOrBeforeMs: 2500,
    }),
  );
  assert.ok(Result.isSuccess(ownLine));
  if (!Result.isSuccess(ownLine)) return;
  assert.deepEqual(
    [
      Option.getOrUndefined(ownLine.success)?.clientId,
      Option.getOrUndefined(ownLine.success)?.delegationId,
    ],
    ["line-1", undefined],
  );
  // Found by where it starts: a delegation's offset may fall inside the line it is about.
  const delegatedLine = await database.run(
    writer.latestSpokenLine(target, {
      voiceSessionId: "vs_fixture_1",
      startingAtOrBeforeMs: 3500,
    }),
  );
  assert.ok(Result.isSuccess(delegatedLine));
  if (!Result.isSuccess(delegatedLine)) return;
  assert.deepEqual(
    [
      Option.getOrUndefined(delegatedLine.success)?.clientId,
      Option.getOrUndefined(delegatedLine.success)?.delegationId,
    ],
    ["dl_1", "dl_1"],
  );
  const none = await database.run(
    writer.latestSpokenLine(target, {
      voiceSessionId: "vs_fixture_1",
      startingAtOrBeforeMs: 500,
    }),
  );
  assert.ok(Result.isSuccess(none));
  if (!Result.isSuccess(none)) return;
  assert.ok(Option.isNone(none.success));
  const otherSession = await database.run(
    writer.latestSpokenLine(target, {
      voiceSessionId: "vs_fixture_2",
      startingAtOrBeforeMs: 9000,
    }),
  );
  assert.ok(Result.isSuccess(otherSession));
  if (!Result.isSuccess(otherSession)) return;
  assert.ok(Option.isNone(otherSession.success));
});
