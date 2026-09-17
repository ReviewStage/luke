import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type ToolSet, tool, type UIMessage } from "ai";
import { eq } from "drizzle-orm";
import { Effect, Option, Result, Schema } from "effect";
import { afterAll, test } from "vitest";
import { z } from "zod";
import {
  ACTION_OUTPUT_STATUS,
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  type BrainRequestFailure,
  type BrainRunEvent,
  type BrainRunEventBody,
  type BrainTurnOrigin,
  type BrainTurnTrigger,
  COMPACTION_SOURCE,
  CONVERSATION_EVENT_KIND,
  isRecord,
  isStoredToolPart,
  MAIN_SESSION_KEY,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  OBSERVATION_SOURCE,
  readStoredUIMessages,
  SCHEMA_REFUSAL,
  SLOW_STEP_KIND,
  STEP_START_PART,
  TOOL_CALL_SETTLEMENT,
  TOOL_PART_STATE,
  type ToolRefusalStatus,
  TURN_ORIGIN,
  TURN_STATUS,
  toolPartType,
  UI_PART_STATE,
  UI_PART_TYPE,
  UNKNOWN_ACTION_STATUS,
  type UnparsedWireValue,
  type UserMessageMetadata,
  unknownActionOutput,
  unparsedWire,
  type WireBoundaryInput,
} from "../server/core";
import { db } from "../server/db/query";
import { conversations } from "../server/db/storage-schema";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { VOICE_DELEGATION_MODE } from "../server/db/voice-vocabulary";
import { type ConversationTarget, STORE_WRITE_EFFECT, storeWriter } from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import { EpochMillisColumnSchema } from "../server/hosted/store/database";
import {
  STORE_WRITE_REFUSAL,
  type StoreWriteResult,
  TURN_FAILURE_DETAIL,
} from "../server/hosted/store/writer";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  insertConversation,
  insertMessage,
  insertVoiceSession,
  readEventsByConversation,
  readMessagesByConversationTyped,
  readTurnById,
  readVoiceSessionByIdTyped,
  setConversationDeletedAt,
} from "./support/store-rows";

/**
 * The store writer over the real migrations on PGlite. Synthetic fixtures
 * throughout: no real title, branch, transcript, or spoken word. What these
 * tests hold to is the record the plan describes — which rows a turn of each
 * kind leaves, in which states, in which order — and never the words in them.
 */

const NOW = 1_800_000_000_000;

type TurnFailure = BrainRequestFailure;

/** The one failure word the fixtures need, typed against the run's own set so a misspelling fails to compile. */
const MODEL_FAILURE: TurnFailure = "model";

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
        ACTION_OUTPUT_STATUS.ACCEPTED,
        UNKNOWN_ACTION_STATUS,
        ACTION_OUTPUT_STATUS.REFUSED,
      ]),
      reason: z.string().optional(),
    }),
  }),
};

const TRANSCRIPT_INPUT = { providerId: "conductor", providerSessionId: "s-1" };
const TRANSCRIPT_OUTPUT = { lines: ["user: fixture ask", "assistant: fixture reply"] };
const SEND_INPUT = { ...TRANSCRIPT_INPUT, text: "run the tests" };
const ANNOUNCE_INPUT = { text: "The fixture session finished its turn." };

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
      conversationId: MAIN_SESSION_KEY,
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

const CountersRowSchema = Schema.Struct({
  message: EpochMillisColumnSchema,
  event: EpochMillisColumnSchema,
});

async function counters(target: ConversationTarget) {
  const [row] = await database.run(
    db
      .select({ message: conversations.nextMessageSeq, event: conversations.nextEventSeq })
      .from(conversations)
      .where(eq(conversations.id, target.conversationId)),
  );
  return row === undefined ? undefined : Schema.decodeUnknownSync(CountersRowSchema)(row);
}

type Part = UIMessage["parts"][number];

const pendingCall = (callId: string): Part => ({
  type: toolPartType("read_transcript"),
  toolCallId: callId,
  state: TOOL_PART_STATE.INPUT_AVAILABLE,
  input: TRANSCRIPT_INPUT,
});

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

test("a writer refuses to be composed over a catalog whose declared output schema would not admit the unknown outcome", async () => {
  const narrow: ToolSet = {
    read_transcript: tool({
      description: "Reads the tail of an observed session's transcript.",
      inputSchema: z.object({ providerId: z.string(), providerSessionId: z.string() }),
      outputSchema: z.object({ lines: z.array(z.string()) }),
    }),
  };
  await assert.rejects(database.run(storeWriter({ tools: narrow })));
  const undeclared: ToolSet = {
    read_transcript: tool({
      description: "Reads the tail of an observed session's transcript.",
      inputSchema: z.object({ providerId: z.string(), providerSessionId: z.string() }),
    }),
  };
  await database.run(storeWriter({ tools: undeclared }));
});

const RevisionRowSchema = Schema.Struct({ revision: EpochMillisColumnSchema });

/** The conversation's journal revision as the row holds it. */
async function journalRevision(target: ConversationTarget): Promise<number | undefined> {
  const [row] = await database.run(
    db
      .select({ revision: conversations.journalRevision })
      .from(conversations)
      .where(eq(conversations.id, target.conversationId)),
  );
  return row === undefined ? undefined : Schema.decodeUnknownSync(RevisionRowSchema)(row).revision;
}

test("each write to the journal in place moves the conversation's journal revision and stamps the row with it, and a numbered row's insert moves neither", async () => {
  const target = await conversation();
  const stream = new Stream();
  const askId = randomUUID();
  await feed(target, [
    stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK),
    stream.words(askId, "Read it.", TYPED_ASK),
  ]);
  // The ask is numbered and finished as it lands: no row was written in place.
  assert.equal(await journalRevision(target), 0);
  assert.deepEqual(
    (await storedMessages(target)).map((row) => [row.seq, row.revision]),
    [[1, null]],
  );

  // The journal opens on the first tool call (a numbered insert) and is written in place by it.
  await feed(target, [stream.toolCall("call_1", "read_transcript", TRANSCRIPT_INPUT)]);
  assert.equal(await journalRevision(target), 1);
  // The call's answer is a second write in place.
  await feed(target, [stream.toolAnswered("call_1", "read_transcript", TRANSCRIPT_OUTPUT)]);
  assert.equal(await journalRevision(target), 2);
  assert.deepEqual(
    (await storedMessages(target)).map((row) => [row.seq, row.revision, row.finishedAt !== null]),
    [
      [1, null, true],
      [2, 2, false],
    ],
  );

  // The turn's answer completes the journal: the third write, and the row finishes under it.
  await feed(target, [
    stream.answered(stream.turnId, REPLY_PARTS),
    stream.ended(BRAIN_REQUEST_STATUS.SUCCEEDED),
  ]);
  assert.equal(await journalRevision(target), 3);
  assert.deepEqual(
    (await storedMessages(target)).map((row) => [row.seq, row.revision, row.finishedAt !== null]),
    [
      [1, null, true],
      [2, 3, true],
    ],
  );
});

test("a turn that ends with its journal open finishes it in place, which moves the revision once more", async () => {
  const target = await conversation();
  const stream = new Stream();
  await feed(target, [
    stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK),
    stream.words(randomUUID(), "Read it.", TYPED_ASK),
    stream.toolCall("call_1", "read_transcript", TRANSCRIPT_INPUT),
  ]);
  assert.equal(await journalRevision(target), 1);
  await feed(target, [stream.ended(BRAIN_REQUEST_STATUS.SUCCEEDED)]);
  assert.equal(await journalRevision(target), 2);
  const journal = (await storedMessages(target))[1];
  assert.ok(journal);
  assert.equal(journal.revision, 2);
  assert.notEqual(journal.finishedAt, null);
});

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
  assert.deepEqual(await counters(target), { message: 3, event: 1 });

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

test("an observation turn on an observed conversation is a transcript-change turn whose words the brain wrote for itself", async () => {
  const target = await conversation(CONVERSATION_KIND.OBSERVED);
  const stream = new Stream();
  const lookId = randomUUID();
  const announceParts: UIMessage["parts"] = [
    {
      type: toolPartType("announce"),
      toolCallId: "call_a",
      state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
      input: ANNOUNCE_INPUT,
      output: { status: "accepted" },
    },
  ];
  const results = await feed(target, [
    stream.started(BRAIN_TURN_ORIGIN.OBSERVATION, BRAIN_TURN_TRIGGER.ROSTER),
    stream.words(lookId, "[roster look] One session finished.", {
      author: MESSAGE_AUTHOR.BRAIN,
      source: OBSERVATION_SOURCE.TRANSCRIPT_CHANGE,
    }),
    stream.toolCall("call_a", "announce", ANNOUNCE_INPUT),
    stream.toolAnswered("call_a", "announce", { status: "accepted" }),
    stream.answered(randomUUID(), announceParts),
    stream.ended(BRAIN_REQUEST_STATUS.SUCCEEDED),
  ]);
  assert.equal(results.every(Result.isSuccess), true);

  const rows = await storedMessages(target);
  assert.deepEqual(
    rows.map((row) => [row.seq, row.role, row.metadata]),
    [
      [
        1,
        MESSAGE_ROLE.USER,
        { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.TRANSCRIPT_CHANGE },
      ],
      [2, MESSAGE_ROLE.ASSISTANT, { author: MESSAGE_AUTHOR.BRAIN }],
    ],
  );
  assert.deepEqual(rows[1]?.parts, announceParts);
  const turn = await storedTurn(stream.turnId);
  assert.deepEqual(
    [turn?.origin, turn?.status, turn?.responseIds],
    [TURN_ORIGIN.TRANSCRIPT_CHANGE, TURN_STATUS.SETTLED, []],
  );
});

test("a child turn on a child conversation is a child-origin turn opened by the delegated task", async () => {
  const target = await conversation(CONVERSATION_KIND.CHILD);
  const stream = new Stream();
  const replyParts: UIMessage["parts"] = [
    { type: UI_PART_TYPE.TEXT, text: "Two files changed.", state: UI_PART_STATE.DONE },
  ];
  const results = await feed(target, [
    stream.started(BRAIN_TURN_ORIGIN.CHILD, BRAIN_TURN_TRIGGER.CHILD_TASK),
    stream.words(randomUUID(), "[delegated task] Summarize the change.", {
      author: MESSAGE_AUTHOR.BRAIN,
      source: OBSERVATION_SOURCE.CHILD,
    }),
    stream.answered(randomUUID(), replyParts),
    stream.ended(BRAIN_REQUEST_STATUS.SUCCEEDED, { responseIds: ["resp_c"] }),
  ]);
  assert.equal(results.every(Result.isSuccess), true);
  const rows = await storedMessages(target);
  assert.deepEqual(
    rows.map((row) => [row.seq, row.role, row.turnId, row.finishedAt !== null]),
    [
      [1, MESSAGE_ROLE.USER, stream.turnId, true],
      [2, MESSAGE_ROLE.ASSISTANT, stream.turnId, true],
    ],
  );
  assert.deepEqual(rows[1]?.parts, replyParts);
  const turn = await storedTurn(stream.turnId);
  assert.deepEqual([turn?.origin, turn?.status], [TURN_ORIGIN.CHILD, TURN_STATUS.SETTLED]);
});

test("a child's completion opens a turn of the requester's own, written with the child_completion origin rather than folded onto child", async () => {
  const target = await conversation();
  const stream = new Stream();
  const replyParts: UIMessage["parts"] = [
    {
      type: UI_PART_TYPE.TEXT,
      text: "The child finished; two files changed.",
      state: UI_PART_STATE.DONE,
    },
  ];
  const results = await feed(target, [
    stream.started(BRAIN_TURN_ORIGIN.CHILD_COMPLETION, BRAIN_TURN_TRIGGER.CHILD_COMPLETION),
    stream.words(randomUUID(), "[child completion] Summarize the change: done.", {
      author: MESSAGE_AUTHOR.BRAIN,
      source: OBSERVATION_SOURCE.CHILD_COMPLETION,
    }),
    stream.answered(randomUUID(), replyParts),
    stream.ended(BRAIN_REQUEST_STATUS.SUCCEEDED),
  ]);
  assert.equal(results.every(Result.isSuccess), true);
  const turn = await storedTurn(stream.turnId);
  assert.deepEqual(
    [turn?.origin, turn?.status],
    [TURN_ORIGIN.CHILD_COMPLETION, TURN_STATUS.SETTLED],
  );
});

test("a writer killed after the calls were told leaves a resumable journal: one call answered, one still pending, the row open", async () => {
  const target = await conversation();
  const stream = new Stream();
  const results = await feed(target, [
    stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK),
    stream.words(randomUUID(), "Read both.", TYPED_ASK),
    stream.toolCall("call_1", "read_transcript", TRANSCRIPT_INPUT),
    stream.toolCall("call_2", "read_transcript", TRANSCRIPT_INPUT),
    stream.toolAnswered("call_1", "read_transcript", TRANSCRIPT_OUTPUT),
  ]);
  assert.equal(results.every(Result.isSuccess), true);

  const rows = await storedMessages(target);
  const journal = rows[1];
  assert.ok(journal);
  assert.equal(journal.finishedAt, null);
  assert.deepEqual(journal.parts, [answeredCall("call_1"), pendingCall("call_2")]);
  const turn = await storedTurn(stream.turnId);
  assert.equal(turn?.status, TURN_STATUS.RUNNING);

  const read = await database.run(
    readStoredUIMessages(
      asWire([
        {
          id: journal.clientId,
          role: journal.role,
          metadata: journal.metadata,
          parts: journal.parts,
        },
      ]),
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
  assert.deepEqual(await counters(target), { message: 3, event: 1 });
});

test("a refused call settles as an error part carrying the refusal's own reason and no output, in the shape the turn's projection keeps", async () => {
  const target = await conversation();
  const stream = new Stream();
  const results = await feed(target, [
    stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK),
    stream.toolCall("call_r", "read_transcript", TRANSCRIPT_INPUT),
    stream.toolFailed(
      "call_r",
      "read_transcript",
      "The session is not in the roster.",
      ACTION_OUTPUT_STATUS.REFUSED,
    ),
  ]);
  assert.equal(results.every(Result.isSuccess), true);
  const [journal] = await storedMessages(target);
  assert.deepEqual(journal?.parts, [
    {
      type: toolPartType("read_transcript"),
      toolCallId: "call_r",
      state: TOOL_PART_STATE.OUTPUT_ERROR,
      input: TRANSCRIPT_INPUT,
      errorText: "The session is not in the roster.",
    },
  ]);
  const again = await database.run(
    writer.consume(
      target,
      stream.toolFailed(
        "call_r",
        "read_transcript",
        "The session is not in the roster.",
        ACTION_OUTPUT_STATUS.REFUSED,
      ),
    ),
  );
  assert.deepEqual(again, Result.succeed(STORE_WRITE_EFFECT.REPEATED));
});

test("an action whose effect is unknown settles as an answer carrying its envelope, distinguishable on the row from a refused one", async () => {
  const target = await conversation();
  const stream = new Stream();
  const uncertain = unknownActionOutput("The node closed before it answered.");
  const results = await feed(target, [
    stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK),
    stream.toolCall("call_u", "send_session_message", SEND_INPUT),
    stream.toolCall("call_f", "send_session_message", SEND_INPUT),
    stream.toolAnswered("call_u", "send_session_message", uncertain),
    stream.toolFailed(
      "call_f",
      "send_session_message",
      "Not in the roster.",
      ACTION_OUTPUT_STATUS.REFUSED,
    ),
  ]);
  assert.equal(results.every(Result.isSuccess), true);
  const [journal] = await storedMessages(target);
  assert.deepEqual(journal?.parts, [
    {
      type: toolPartType("send_session_message"),
      toolCallId: "call_u",
      state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
      input: SEND_INPUT,
      output: uncertain,
    },
    {
      type: toolPartType("send_session_message"),
      toolCallId: "call_f",
      state: TOOL_PART_STATE.OUTPUT_ERROR,
      input: SEND_INPUT,
      errorText: "Not in the roster.",
    },
  ]);
});

test("a turn that ends with a call unanswered settles the call as an answer whose envelope says unknown, closes the journal, and the row still reads back", async () => {
  const target = await conversation();
  const stream = new Stream();
  await feed(target, [
    stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK),
    stream.toolCall("call_1", "read_transcript", TRANSCRIPT_INPUT),
    stream.ended(BRAIN_REQUEST_STATUS.CANCELLED),
  ]);
  const [journal] = await storedMessages(target);
  assert.ok(journal);
  assert.equal(journal.finishedAt?.getTime(), NOW + 1_000);
  const [unanswered] = journal.parts;
  assert.ok(
    unanswered !== undefined &&
      isStoredToolPart(unanswered) &&
      unanswered.state === TOOL_PART_STATE.OUTPUT_AVAILABLE,
  );
  // SAFETY: a stored part's output is JSON the store holds as jsonb; the wire boundary is where it is read.
  const envelope = unparsedWire(unanswered.output as WireBoundaryInput);
  assert.equal(isRecord(envelope) && envelope.status, UNKNOWN_ACTION_STATUS);
  const read = await database.run(
    readStoredUIMessages(
      asWire([
        {
          id: journal.clientId,
          role: journal.role,
          metadata: journal.metadata,
          parts: journal.parts,
        },
      ]),
      TOOLS,
    ),
  );
  assert.equal(read.ok, true);
  const turn = await storedTurn(stream.turnId);
  assert.deepEqual([turn?.status, turn?.failure], [TURN_STATUS.CANCELLED, null]);

  const late = await database.run(
    writer.consume(target, stream.toolAnswered("call_1", "read_transcript", TRANSCRIPT_OUTPUT)),
  );
  assert.deepEqual(late, Result.fail({ refusal: STORE_WRITE_REFUSAL.FINISHED }));
  const again = await database.run(
    writer.consume(target, stream.ended(BRAIN_REQUEST_STATUS.SUCCEEDED)),
  );
  assert.deepEqual(again, Result.succeed(STORE_WRITE_EFFECT.REPEATED));
});

test("a turn that failed records its failure word and detail cut to the bound, and one that timed out without a word records the status it ended in", async () => {
  const target = await conversation();
  const failed = new Stream();
  const detail = "MODEL_CALL_FAILED: fixture refusal";
  await feed(target, [
    failed.started(BRAIN_TURN_ORIGIN.SPOKEN, BRAIN_TURN_TRIGGER.ASK),
    failed.ended(BRAIN_REQUEST_STATUS.FAILED, {
      failure: MODEL_FAILURE,
      failureDetail: detail.padEnd(TURN_FAILURE_DETAIL.CHARS + 40, "."),
    }),
  ]);
  const timedOut = new Stream();
  await feed(target, [
    timedOut.started(BRAIN_TURN_ORIGIN.OBSERVATION, BRAIN_TURN_TRIGGER.ROSTER),
    timedOut.ended(BRAIN_REQUEST_STATUS.TIMED_OUT),
  ]);
  const failedTurn = await storedTurn(failed.turnId);
  const timedOutTurn = await storedTurn(timedOut.turnId);
  assert.deepEqual(
    [failedTurn?.origin, failedTurn?.status, failedTurn?.failure],
    [TURN_ORIGIN.SPOKEN, TURN_STATUS.FAILED, MODEL_FAILURE],
  );
  assert.equal(failedTurn?.failureDetail?.length, TURN_FAILURE_DETAIL.CHARS);
  assert.ok(failedTurn?.failureDetail?.startsWith(detail));
  assert.deepEqual(
    [
      timedOutTurn?.origin,
      timedOutTurn?.status,
      timedOutTurn?.failure,
      timedOutTurn?.failureDetail,
    ],
    [TURN_ORIGIN.TRANSCRIPT_CHANGE, TURN_STATUS.FAILED, BRAIN_REQUEST_STATUS.TIMED_OUT, null],
  );
});

test("a queued turn keeps the origin it was queued under through running to settled, and is queued once", async () => {
  const target = await conversation();
  const stream = new Stream();
  const queued = await database.run(
    writer.enqueueTurn(target, {
      turnId: stream.turnId,
      eveTurnId: "turn_3",
      origin: TURN_ORIGIN.SPOKEN,
      model: "gpt-fixture",
    }),
  );
  assert.deepEqual(
    queued,
    Result.succeed({ turnId: stream.turnId, effect: STORE_WRITE_EFFECT.WRITTEN }),
  );
  assert.equal((await storedTurn(stream.turnId))?.eveTurnId, "turn_3");
  const twice = await database.run(
    writer.enqueueTurn(target, {
      turnId: stream.turnId,
      origin: TURN_ORIGIN.TYPED,
    }),
  );
  assert.deepEqual(
    twice,
    Result.succeed({ turnId: stream.turnId, effect: STORE_WRITE_EFFECT.REPEATED }),
  );
  assert.equal((await storedTurn(stream.turnId))?.status, TURN_STATUS.QUEUED);

  const started = await database.run(
    writer.consume(
      target,
      stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK, NOW + 500),
    ),
  );
  assert.deepEqual(started, Result.succeed(STORE_WRITE_EFFECT.WRITTEN));
  const running = await storedTurn(stream.turnId);
  assert.deepEqual(
    [running?.origin, running?.status, running?.queuedAt?.getTime(), running?.startedAt?.getTime()],
    [TURN_ORIGIN.SPOKEN, TURN_STATUS.RUNNING, NOW, NOW + 500],
  );
  await database.run(writer.consume(target, stream.ended(BRAIN_REQUEST_STATUS.SUCCEEDED)));
  assert.equal((await storedTurn(stream.turnId))?.status, TURN_STATUS.SETTLED);

  const minted = await database.run(
    writer.enqueueTurn(target, { origin: TURN_ORIGIN.TRANSCRIPT_CHANGE }),
  );
  assert.ok(Result.isSuccess(minted));
  if (!Result.isSuccess(minted)) return;
  assert.equal((await storedTurn(minted.success.turnId))?.origin, TURN_ORIGIN.TRANSCRIPT_CHANGE);
  assert.equal((await storedTurn(minted.success.turnId))?.eveTurnId, null);
});

test("a sequence already taken under the counter is the retry signal: the write lands on the next free position and the counter is re-aligned", async () => {
  const target = await conversation();
  const stream = new Stream();
  await database.run(
    writer.consume(target, stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK)),
  );
  const before = await counters(target);
  assert.ok(before);
  await insertMessage(database.run, {
    userId: target.userId,
    conversationId: target.conversationId,
    seq: before.message,
    clientId: "taken-outside-the-counter",
    role: MESSAGE_ROLE.SYSTEM,
    parts: [{ type: "text", text: "taken" }],
  });
  const askId = randomUUID();
  const result = await database.run(
    writer.consume(target, stream.words(askId, "hello", TYPED_ASK)),
  );
  assert.deepEqual(result, Result.succeed(STORE_WRITE_EFFECT.WRITTEN));
  const rows = await storedMessages(target);
  assert.deepEqual(
    rows.map((row) => [row.seq, row.clientId]),
    [
      [before.message, "taken-outside-the-counter"],
      [before.message + 1, askId],
    ],
  );
  assert.deepEqual(await counters(target), { message: before.message + 2, event: 1 });
});

test("a message the reader would refuse is refused at the write, with the reader's own word and path, and leaves no row", async () => {
  const target = await conversation();
  const stream = new Stream();
  await database.run(
    writer.consume(target, stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK)),
  );

  const unregistered = await database.run(
    writer.consume(target, stream.toolCall("call_x", "list_sessions", {})),
  );
  assert.deepEqual(
    unregistered,
    Result.fail({
      refusal: STORE_WRITE_REFUSAL.MESSAGE_REFUSED,
      reason: SCHEMA_REFUSAL.NOT_REGISTERED,
      path: [0, "parts", 0, "type"],
    }),
  );

  const wrongInput = await database.run(
    writer.consume(target, stream.toolCall("call_y", "read_transcript", { providerId: 7 })),
  );
  assert.ok(Result.isFailure(wrongInput));
  if (!Result.isFailure(wrongInput)) return;
  assert.equal(wrongInput.failure.refusal, STORE_WRITE_REFUSAL.MESSAGE_REFUSED);
  assert.equal(
    "reason" in wrongInput.failure && wrongInput.failure.reason,
    SCHEMA_REFUSAL.MALFORMED,
  );

  const decorated = await database.run(
    writer.consume(
      target,
      stream.event({
        kind: BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        message: {
          id: randomUUID(),
          role: MESSAGE_ROLE.USER,
          metadata: { ...TYPED_ASK, mood: "cheerful" },
          parts: [{ type: "text", text: "hello" }],
        },
      }),
    ),
  );
  assert.ok(Result.isFailure(decorated));
  if (!Result.isFailure(decorated)) return;
  assert.equal(decorated.failure.refusal, STORE_WRITE_REFUSAL.MESSAGE_REFUSED);

  const rows = await storedMessages(target);
  assert.deepEqual(
    rows.map((row) => row.role),
    [MESSAGE_ROLE.ASSISTANT],
  );
  assert.deepEqual(rows[0]?.parts, []);
});

test("a write for a conversation, turn, or call that is not there is refused by name", async () => {
  const target = await conversation();
  const elsewhere = { userId: target.userId, conversationId: randomUUID() };
  const stream = new Stream();
  const noConversation = await database.run(
    writer.consume(elsewhere, stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK)),
  );
  assert.deepEqual(noConversation, Result.fail({ refusal: STORE_WRITE_REFUSAL.NO_CONVERSATION }));

  const other = await conversation();
  const otherUser = { userId: other.userId, conversationId: target.conversationId };
  const wrongUser = await database.run(
    writer.consume(otherUser, stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK)),
  );
  assert.deepEqual(wrongUser, Result.fail({ refusal: STORE_WRITE_REFUSAL.NO_CONVERSATION }));

  const noTurn = await database.run(
    writer.consume(target, stream.toolCall("call_1", "read_transcript", TRANSCRIPT_INPUT)),
  );
  assert.deepEqual(noTurn, Result.fail({ refusal: STORE_WRITE_REFUSAL.NO_TURN }));
  const noTurnAnswer = await database.run(
    writer.consume(target, stream.toolAnswered("call_1", "read_transcript", TRANSCRIPT_OUTPUT)),
  );
  assert.deepEqual(noTurnAnswer, Result.fail({ refusal: STORE_WRITE_REFUSAL.NO_TURN }));
  const noTurnWords = await database.run(
    writer.consume(target, stream.words(randomUUID(), "hi", TYPED_ASK)),
  );
  assert.deepEqual(noTurnWords, Result.fail({ refusal: STORE_WRITE_REFUSAL.NO_TURN }));
  const noTurnEnd = await database.run(
    writer.consume(target, stream.ended(BRAIN_REQUEST_STATUS.SUCCEEDED)),
  );
  assert.deepEqual(noTurnEnd, Result.fail({ refusal: STORE_WRITE_REFUSAL.NO_TURN }));

  await database.run(
    writer.consume(target, stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK)),
  );
  const noCall = await database.run(
    writer.consume(
      target,
      stream.toolAnswered("call_never_told", "read_transcript", TRANSCRIPT_OUTPUT),
    ),
  );
  assert.deepEqual(noCall, Result.fail({ refusal: STORE_WRITE_REFUSAL.NO_CALL }));
  assert.deepEqual(await storedMessages(target), []);
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

test("a turn that ended without a journal opens none after the fact: a late part, answer, or word is refused as finished", async () => {
  const target = await conversation();
  const stream = new Stream();
  await feed(target, [
    stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK),
    stream.ended(BRAIN_REQUEST_STATUS.FAILED, { failure: MODEL_FAILURE }),
  ]);
  const late = await feed(target, [
    stream.toolCall("call_late", "read_transcript", TRANSCRIPT_INPUT),
    stream.reasoning("rs_late", "Too late."),
    stream.answered(randomUUID(), REPLY_PARTS),
    stream.words(randomUUID(), "Late words.", TYPED_ASK),
  ]);
  assert.deepEqual(
    effects(late),
    late.map(() => STORE_WRITE_REFUSAL.FINISHED),
  );
  assert.deepEqual(await storedMessages(target), []);
});

test("a closed journal takes its own projection again as a repeat and a different one as the late write it is", async () => {
  const target = await conversation();
  const stream = new Stream();
  const replyId = randomUUID();
  await feed(target, developerTurn(stream, randomUUID(), replyId));
  const same = await database.run(
    writer.consume(target, stream.answered(randomUUID(), REPLY_PARTS)),
  );
  assert.deepEqual(same, Result.succeed(STORE_WRITE_EFFECT.REPEATED));
  const different = await database.run(
    writer.consume(
      target,
      stream.answered(randomUUID(), [
        { type: UI_PART_TYPE.TEXT, text: "Second thoughts.", state: UI_PART_STATE.DONE },
      ]),
    ),
  );
  assert.deepEqual(different, Result.fail({ refusal: STORE_WRITE_REFUSAL.FINISHED }));
  const [, reply] = await storedMessages(target);
  assert.deepEqual(reply?.parts, REPLY_PARTS);
});

test("a step joins the journal as one boundary before its parts, a step told twice is one, and the answer's projection keeps the boundaries", async () => {
  const target = await conversation();
  const stream = new Stream();
  await feed(target, [
    stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK),
    stream.words("ask-1", "What is the fixture session doing?", TYPED_ASK),
  ]);
  const opened = effects(
    await feed(target, [
      stream.step(1),
      stream.step(1),
      stream.toolCall("call_1", "read_transcript", TRANSCRIPT_INPUT),
      stream.toolAnswered("call_1", "read_transcript", TRANSCRIPT_OUTPUT),
      stream.reasoning("rs_1", "Read the tail first."),
      stream.step(2),
    ]),
  );
  assert.deepEqual(opened, [
    STORE_WRITE_EFFECT.WRITTEN,
    STORE_WRITE_EFFECT.REPEATED,
    STORE_WRITE_EFFECT.WRITTEN,
    STORE_WRITE_EFFECT.WRITTEN,
    STORE_WRITE_EFFECT.WRITTEN,
    STORE_WRITE_EFFECT.WRITTEN,
  ]);
  const [, journal] = await storedMessages(target);
  assert.ok(journal);
  // SAFETY: the parts column is jsonb holding the message's parts the writer admitted.
  const journaled = journal.parts as UIMessage["parts"];
  assert.deepEqual(
    journaled.map((part) => part.type),
    [
      UI_PART_TYPE.STEP_START,
      toolPartType("read_transcript"),
      UI_PART_TYPE.REASONING,
      UI_PART_TYPE.STEP_START,
    ],
  );

  const [reasoned] = REPLY_PARTS;
  assert.ok(reasoned);
  const projection: UIMessage["parts"] = [
    STEP_START_PART,
    answeredCall("call_1"),
    reasoned,
    STEP_START_PART,
    { type: UI_PART_TYPE.TEXT, text: "It is waiting on a permission.", state: UI_PART_STATE.DONE },
  ];
  await feed(target, [
    stream.answered(stream.turnId, projection),
    stream.ended(BRAIN_REQUEST_STATUS.SUCCEEDED),
  ]);
  const [, answered] = await storedMessages(target);
  assert.deepEqual(answered?.parts, projection);
  assert.ok(answered?.finishedAt);
  const late = await feed(target, [stream.step(3)]);
  assert.deepEqual(effects(late), [STORE_WRITE_REFUSAL.FINISHED]);
});

test("a reasoning item naming no id is not journaled, since nothing could tell its repeat from a second item", async () => {
  const target = await conversation();
  const stream = new Stream();
  await database.run(
    writer.consume(target, stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK)),
  );
  const unnamed = await database.run(
    writer.consume(
      target,
      stream.event({
        kind: BRAIN_RUN_EVENT.REASONING_COMPLETED,
        summary: "Thinking.",
        item: { type: "reasoning" },
      }),
    ),
  );
  assert.deepEqual(unnamed, Result.succeed(STORE_WRITE_EFFECT.IGNORED));
  const named = await database.run(writer.consume(target, stream.reasoning("rs_9", "Thinking.")));
  assert.deepEqual(named, Result.succeed(STORE_WRITE_EFFECT.WRITTEN));
  const again = await database.run(writer.consume(target, stream.reasoning("rs_9", "Thinking.")));
  assert.deepEqual(again, Result.succeed(STORE_WRITE_EFFECT.REPEATED));
  const [journal] = await storedMessages(target);
  assert.deepEqual(journal?.parts, [
    { type: UI_PART_TYPE.REASONING, id: "rs_9", text: "Thinking.", state: UI_PART_STATE.DONE },
  ]);
});

test("the relay's own events and the stream's compaction event write nothing", async () => {
  const target = await conversation();
  const stream = new Stream();
  await database.run(
    writer.consume(target, stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK)),
  );
  const results = await feed(target, [
    stream.event({
      kind: BRAIN_RUN_EVENT.SLOW_STEP,
      runId: stream.turnId,
      step: SLOW_STEP_KIND.TRANSCRIPT_READ,
    }),
    stream.event({ kind: BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: stream.turnId }),
    stream.event({ kind: BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: stream.turnId, sentence: "Done." }),
    stream.event({
      kind: BRAIN_RUN_EVENT.COMPACTION_COMPLETED,
      compaction: {
        source: COMPACTION_SOURCE.LOCAL_SUMMARY,
        dropped: 3,
        summary: "Earlier: fixtures.",
      },
    }),
    stream.event({
      kind: BRAIN_RUN_EVENT.ENDED,
      runId: stream.turnId,
      status: BRAIN_REQUEST_STATUS.SUCCEEDED,
    }),
  ]);
  assert.deepEqual(
    effects(results),
    results.map(() => STORE_WRITE_EFFECT.IGNORED),
  );
  assert.deepEqual(await storedMessages(target), []);
});

test("events about a message are numbered by the conversation's own event sequence, and one about no message is refused", async () => {
  const target = await conversation();
  const stream = new Stream();
  await feed(target, developerTurn(stream, randomUUID(), randomUUID()));
  const [, reply] = await storedMessages(target);
  assert.ok(reply);
  const offered = await database.run(
    writer.recordEvent(target, {
      messageId: reply.id,
      kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      unless: [],
    }),
  );
  const claimed = await database.run(
    writer.recordEvent(target, {
      messageId: reply.id,
      kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
      deviceId: "device-1",
      payload: { at: NOW },
      unless: [],
    }),
  );
  assert.equal(Result.isSuccess(offered) && offered.success.seq, 1);
  assert.equal(Result.isSuccess(claimed) && claimed.success.seq, 2);
  const stored = (await readEventsByConversation(database.run, target.conversationId))
    .filter((row) => row.messageId === reply.id)
    .map((row) => ({
      seq: Schema.decodeUnknownSync(EpochMillisColumnSchema)(row.seq),
      kind: row.kind,
      deviceId: row.deviceId,
      payload: row.payload,
    }));
  assert.deepEqual(stored, [
    { seq: 1, kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED, deviceId: null, payload: null },
    {
      seq: 2,
      kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
      deviceId: "device-1",
      payload: { at: NOW },
    },
  ]);
  assert.deepEqual(await counters(target), { message: 3, event: 3 });

  const noMessage = await database.run(
    writer.recordEvent(target, {
      messageId: randomUUID(),
      kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      unless: [],
    }),
  );
  assert.deepEqual(noMessage, Result.fail({ refusal: STORE_WRITE_REFUSAL.NO_MESSAGE }));

  const other = await conversation();
  const elsewhere = await database.run(
    writer.recordEvent(other, {
      messageId: reply.id,
      kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      unless: [],
    }),
  );
  assert.deepEqual(elsewhere, Result.fail({ refusal: STORE_WRITE_REFUSAL.NO_MESSAGE }));

  const secondClaim = await database.run(
    writer.recordEvent(target, {
      messageId: reply.id,
      kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
      deviceId: "device-2",
      unless: [],
    }),
  );
  assert.deepEqual(secondClaim, Result.fail({ refusal: STORE_WRITE_REFUSAL.ALREADY_CLAIMED }));

  // A write naming kinds that exclude it is refused while one of them stands, and lands otherwise.
  const superseded = await database.run(
    writer.recordEvent(target, {
      messageId: reply.id,
      kind: CONVERSATION_EVENT_KIND.SPEECH_PUSHED,
      unless: [CONVERSATION_EVENT_KIND.SPEECH_CLAIMED, CONVERSATION_EVENT_KIND.SPEECH_EXPIRED],
    }),
  );
  assert.deepEqual(superseded, Result.fail({ refusal: STORE_WRITE_REFUSAL.SUPERSEDED }));
  const claimedAgain = await database.run(
    writer.recordEvent(target, {
      messageId: reply.id,
      kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
      deviceId: "device-2",
      unless: [CONVERSATION_EVENT_KIND.SPEECH_EXPIRED],
    }),
  );
  assert.deepEqual(claimedAgain, Result.fail({ refusal: STORE_WRITE_REFUSAL.ALREADY_CLAIMED }));
  const spoken = await database.run(
    writer.recordEvent(target, {
      messageId: reply.id,
      kind: CONVERSATION_EVENT_KIND.SPEECH_SPOKEN,
      deviceId: "device-1",
      unless: [CONVERSATION_EVENT_KIND.SPEECH_EXPIRED],
    }),
  );
  assert.equal(Result.isSuccess(spoken) && spoken.success.seq, 3);
  assert.deepEqual(await counters(target), { message: 3, event: 4 });
});

test("a spoken reply is a finished assistant row under no turn, once per client id; the latest spoken line is found by its span and names the delegation that owns it", async () => {
  const target = await conversation();
  const spokenLine = (clientId: string, fromMs: number, toMs: number, delegationId?: string) =>
    database.run(
      writer.recordUserMessage(target, {
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

test("a row is placed where it stands in the Conversation: a spoken row at its session's start plus its span's start, any other row where it was written", async () => {
  const target = await conversation();
  const voiceSessionId = await insertVoiceSession(database.run, {
    userId: target.userId,
    liveSessionId: `live_${randomUUID()}`,
    delegationMode: VOICE_DELEGATION_MODE.CLIENT,
  });
  const session = await readVoiceSessionByIdTyped(database.run, voiceSessionId);
  assert.ok(session);
  const spokenLine = (clientId: string, sessionId: string, fromMs: number) =>
    database.run(
      writer.recordUserMessage(target, {
        clientId,
        text: `line ${fromMs}`,
        metadata: {
          author: MESSAGE_AUTHOR.DEVELOPER,
          channel: MESSAGE_CHANNEL.VOICE,
          voice_session_id: sessionId,
          from_ms: fromMs,
          to_ms: fromMs + 1_000,
        },
      }),
    );
  assert.ok(
    Result.isSuccess(
      await database.run(
        writer.recordUserMessage(target, {
          clientId: "typed-placed",
          text: "typed",
          metadata: TYPED_ASK,
        }),
      ),
    ),
  );
  assert.ok(Result.isSuccess(await spokenLine("spoken-placed", voiceSessionId, 4_000)));
  // A spoken row naming a session the store does not hold, or holds for
  // another account, has no clock to stand on.
  assert.ok(Result.isSuccess(await spokenLine("spoken-unheld", randomUUID(), 4_000)));
  const other = await conversation();
  const foreignSessionId = await insertVoiceSession(database.run, {
    userId: other.userId,
    liveSessionId: `live_${randomUUID()}`,
    delegationMode: VOICE_DELEGATION_MODE.CLIENT,
  });
  assert.ok(Result.isSuccess(await spokenLine("spoken-foreign", foreignSessionId, 4_000)));
  const rows = await storedMessages(target);
  const placedAt = (clientId: string) => rows.find((row) => row.clientId === clientId)?.placedAt;
  assert.equal(placedAt("typed-placed")?.getTime(), NOW);
  assert.equal(placedAt("spoken-placed")?.getTime(), session.startedAt.getTime() + 4_000);
  assert.equal(placedAt("spoken-unheld")?.getTime(), NOW);
  assert.equal(placedAt("spoken-foreign")?.getTime(), NOW);
  for (const row of rows) {
    if (row.clientId === "spoken-placed") continue;
    assert.equal(row.placedAt.getTime(), row.createdAt.getTime());
  }
});

test("a spoken reply under a delegation joins the delegation's turn, and is read from the turn's journal where the turn had just settled; one under no known turn, or long after the settle, is read from nothing", async () => {
  const target = await conversation();
  const spoken = (clientId: string, fromMs: number, toMs: number, delegationId?: string) =>
    database.run(
      writer.upsertSpokenRow(target, {
        role: MESSAGE_ROLE.ASSISTANT,
        clientId,
        text: `said ${fromMs}`,
        metadata: {
          author: MESSAGE_AUTHOR.VOICE_MODEL,
          channel: MESSAGE_CHANNEL.VOICE,
          voice_session_id: "vs_fixture_1",
          from_ms: fromMs,
          to_ms: toMs,
          ...(delegationId === undefined ? undefined : { delegation_id: delegationId }),
        },
      }),
    );
  const asks = askRecord();
  const dispatched = async (clientId: string, turnId: string) => {
    const ask = await database.run(
      asks.record({
        userId: target.userId,
        conversationId: target.conversationId,
        clientId,
        origin: "spoken",
        createdAt: new Date(NOW),
      }),
    );
    await database.run(
      asks.dispatchOnce(target, ask.id, () =>
        Effect.succeed({ sessionId: `wrun_${clientId}`, turnId }),
      ),
    );
  };

  // A turn that settled a second after now, as a reply's turn does just before the voice reads it.
  const fresh = new Stream();
  await feed(target, developerTurn(fresh, randomUUID(), randomUUID()));
  await dispatched("dl_fresh", fresh.turnId);
  const journal = (await storedMessages(target)).find((row) => row.clientId === fresh.turnId);
  assert.ok(journal);
  assert.ok(Result.isSuccess(await spoken("reading-1", 9000, 12_000, "dl_fresh")));
  const reading = (await storedMessages(target)).find((row) => row.clientId === "reading-1");
  assert.equal(reading?.turnId, fresh.turnId);
  assert.deepEqual(reading?.metadata, {
    author: MESSAGE_AUTHOR.VOICE_MODEL,
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: "vs_fixture_1",
    from_ms: 9000,
    to_ms: 12_000,
    delegation_id: "dl_fresh",
    read_from: journal.id,
  });

  // A turn that settled long before the words: an aside, standing where it was said under no turn.
  const stale = new Stream();
  await feed(target, [
    stale.started(BRAIN_TURN_ORIGIN.SPOKEN, BRAIN_TURN_TRIGGER.ASK, NOW - 11 * 60_000),
    stale.words(randomUUID(), "Anything new?", TYPED_ASK),
    stale.answered(randomUUID(), REPLY_PARTS),
    stale.ended(BRAIN_REQUEST_STATUS.SUCCEEDED, { at: NOW - 10 * 60_000 }),
  ]);
  await dispatched("dl_stale", stale.turnId);
  assert.ok(Result.isSuccess(await spoken("aside-1", 20_000, 21_000, "dl_stale")));
  const aside = (await storedMessages(target)).find((row) => row.clientId === "aside-1");
  assert.equal(aside?.turnId, null);
  assert.deepEqual(aside?.metadata, {
    author: MESSAGE_AUTHOR.VOICE_MODEL,
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: "vs_fixture_1",
    from_ms: 20_000,
    to_ms: 21_000,
    delegation_id: "dl_stale",
  });

  // A delegation whose ask has no turn yet: the row stands under no turn and was read from nothing.
  assert.ok(Result.isSuccess(await spoken("early-1", 30_000, 31_000, "dl_unknown")));
  const early = (await storedMessages(target)).find((row) => row.clientId === "early-1");
  assert.equal(early?.turnId, null);
  assert.deepEqual(early?.metadata, {
    author: MESSAGE_AUTHOR.VOICE_MODEL,
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: "vs_fixture_1",
    from_ms: 30_000,
    to_ms: 31_000,
    delegation_id: "dl_unknown",
  });
});

test("the turn's answer closes the journal behind what landed while the turn ran, and leaves a journal nothing followed where it opened", async () => {
  const target = await conversation();
  const asks = askRecord();
  const stream = new Stream();
  const askId = randomUUID();
  const spoken = (clientId: string, fromMs: number) =>
    database.run(
      writer.upsertSpokenRow(target, {
        role: MESSAGE_ROLE.ASSISTANT,
        clientId,
        text: `said ${fromMs}`,
        metadata: {
          author: MESSAGE_AUTHOR.VOICE_MODEL,
          channel: MESSAGE_CHANNEL.VOICE,
          voice_session_id: "vs_fixture_1",
          from_ms: fromMs,
          to_ms: fromMs + 1_000,
          delegation_id: askId,
        },
      }),
    );
  // The developer's spoken ask, dispatched to the turn the stream is about to run.
  const ask = await database.run(
    asks.record({
      userId: target.userId,
      conversationId: target.conversationId,
      clientId: askId,
      origin: "spoken",
      createdAt: new Date(NOW),
    }),
  );
  await database.run(
    asks.dispatchOnce(target, ask.id, () =>
      Effect.succeed({ sessionId: "wrun_1", turnId: stream.turnId }),
    ),
  );
  await feed(target, [
    stream.started(BRAIN_TURN_ORIGIN.SPOKEN, BRAIN_TURN_TRIGGER.ASK),
    stream.words(askId, "What is the fixture session doing?", TYPED_ASK),
    stream.toolCall("call_1", "read_transcript", TRANSCRIPT_INPUT),
  ]);
  // Luke's words while the brain works: his row joins the running turn, behind the open journal.
  assert.ok(Result.isSuccess(await spoken("checking", 2_000)));
  assert.ok(Result.isSuccess(await spoken("reading-one", 4_000)));
  const placed = (rows: Awaited<ReturnType<typeof storedMessages>>) =>
    rows.map((row) => [row.clientId, row.seq, row.turnId, row.finishedAt !== null]);
  assert.deepEqual(placed(await storedMessages(target)), [
    [askId, 1, stream.turnId, true],
    [stream.turnId, 2, stream.turnId, false],
    ["checking", 3, stream.turnId, true],
    ["reading-one", 4, stream.turnId, true],
  ]);

  // The answer closes the journal at a fresh position behind them, finished, with the parts told.
  await feed(target, [
    stream.toolAnswered("call_1", "read_transcript", TRANSCRIPT_OUTPUT),
    stream.answered(randomUUID(), REPLY_PARTS),
    stream.ended(BRAIN_REQUEST_STATUS.SUCCEEDED),
  ]);
  const rows = await storedMessages(target);
  assert.deepEqual(placed(rows), [
    [askId, 1, stream.turnId, true],
    ["checking", 3, stream.turnId, true],
    ["reading-one", 4, stream.turnId, true],
    [stream.turnId, 5, stream.turnId, true],
  ]);
  assert.deepEqual(rows[3]?.parts, REPLY_PARTS);
  assert.deepEqual(await counters(target), { message: 6, event: 1 });

  // The reading of the answer lands after it, read from the journal where it now stands.
  assert.ok(Result.isSuccess(await spoken("reading", 9_000)));
  const reading = (await storedMessages(target)).find((row) => row.clientId === "reading");
  assert.equal(reading?.seq, 6);
  assert.equal(reading?.turnId, stream.turnId);
  assert.deepEqual(reading?.metadata, {
    author: MESSAGE_AUTHOR.VOICE_MODEL,
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: "vs_fixture_1",
    from_ms: 9_000,
    to_ms: 10_000,
    delegation_id: askId,
    read_from: rows[3]?.id,
  });

  // The answer told again is a repeat, and moves nothing.
  await feed(target, [stream.answered(randomUUID(), REPLY_PARTS)]);
  assert.deepEqual(
    (await storedMessages(target)).map((row) => row.seq),
    [1, 3, 4, 5, 6],
  );
  assert.deepEqual(await counters(target), { message: 7, event: 1 });
});

test("Luke's words about an ask said before the ask learned its turn follow the ask's line into the turn at the received message, in the order said, and never stand as a group of their own", async () => {
  const target = await conversation();
  const asks = askRecord();
  const stream = new Stream();
  const askId = randomUUID();
  const spoken = (clientId: string, fromMs: number, readFrom?: string) =>
    database.run(
      writer.upsertSpokenRow(target, {
        role: MESSAGE_ROLE.ASSISTANT,
        clientId,
        text: `said ${fromMs}`,
        metadata: {
          author: MESSAGE_AUTHOR.VOICE_MODEL,
          channel: MESSAGE_CHANNEL.VOICE,
          voice_session_id: "vs_fixture_1",
          from_ms: fromMs,
          to_ms: fromMs + 1_000,
          delegation_id: askId,
          ...(readFrom === undefined ? undefined : { read_from: readFrom }),
        },
      }),
    );
  // The ask is recorded but its dispatch has not named a turn; Luke has already said he is checking.
  const ask = await database.run(
    asks.record({
      userId: target.userId,
      conversationId: target.conversationId,
      clientId: askId,
      origin: "spoken",
      createdAt: new Date(NOW),
    }),
  );
  assert.ok(Result.isSuccess(await spoken("checking", 1_500)));
  assert.ok(Result.isSuccess(await spoken("desk", 2_500)));
  // A briefing read aloud in the same breath names the delegation too, but is the briefing's.
  const briefing = randomUUID();
  assert.ok(Result.isSuccess(await spoken("briefing-reading", 2_800, briefing)));
  const before = (await storedMessages(target)).map((row) => [row.clientId, row.seq, row.turnId]);
  assert.deepEqual(before, [
    ["checking", 1, null],
    ["desk", 2, null],
    ["briefing-reading", 3, null],
  ]);

  // The dispatch names the turn, eve starts it and tells the received message: the relay attaches.
  await database.run(
    asks.dispatchOnce(target, ask.id, () =>
      Effect.succeed({ sessionId: "wrun_1", turnId: stream.turnId }),
    ),
  );
  await feed(target, [
    stream.started(BRAIN_TURN_ORIGIN.SPOKEN, BRAIN_TURN_TRIGGER.ASK),
    stream.words(askId, "What is the fixture session doing?", TYPED_ASK),
  ]);
  const attached = await database.run(writer.attachAskLines(target, stream.turnId));
  assert.ok(Result.isSuccess(attached));
  if (!Result.isSuccess(attached)) return;
  assert.equal(attached.success.length, 2);
  const placed = (rows: Awaited<ReturnType<typeof storedMessages>>) =>
    rows.map((row) => [row.clientId, row.seq, row.turnId]);
  assert.deepEqual(placed(await storedMessages(target)), [
    ["briefing-reading", 3, null],
    [askId, 4, stream.turnId],
    ["checking", 5, stream.turnId],
    ["desk", 6, stream.turnId],
  ]);

  // The turn's work then closes behind them, and a second attach finds nothing left outside.
  await feed(target, [
    stream.toolCall("call_1", "read_transcript", TRANSCRIPT_INPUT),
    stream.toolAnswered("call_1", "read_transcript", TRANSCRIPT_OUTPUT),
    stream.answered(randomUUID(), REPLY_PARTS),
    stream.ended(BRAIN_REQUEST_STATUS.SUCCEEDED),
  ]);
  assert.deepEqual(placed(await storedMessages(target)), [
    ["briefing-reading", 3, null],
    [askId, 4, stream.turnId],
    ["checking", 5, stream.turnId],
    ["desk", 6, stream.turnId],
    [stream.turnId, 7, stream.turnId],
  ]);
  const again = await database.run(writer.attachAskLines(target, stream.turnId));
  assert.ok(Result.isSuccess(again));
  if (!Result.isSuccess(again)) return;
  assert.deepEqual(again.success, []);
});

test("attaching a spoken ask gives the developer's rows the delegation in place and keeps their ids; a row keeps the delegation as it grows; the turn takes the rows in order once known; a row another delegation owns is left alone", async () => {
  const target = await conversation();
  const SPOKEN = {
    author: MESSAGE_AUTHOR.DEVELOPER,
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: "vs_fixture_4",
  } as const;
  const developerRow = (clientId: string, text: string, fromMs: number, toMs: number) =>
    database.run(
      writer.upsertSpokenRow(target, {
        role: MESSAGE_ROLE.USER,
        clientId,
        text,
        metadata: { ...SPOKEN, from_ms: fromMs, to_ms: toMs },
      }),
    );
  assert.ok(Result.isSuccess(await developerRow("row-a", "Open the failing", 1000, 2200)));
  assert.ok(Result.isSuccess(await developerRow("row-b", "one.", 6000, 6400)));
  assert.ok(
    Result.isSuccess(
      await database.run(
        writer.upsertSpokenRow(target, {
          role: MESSAGE_ROLE.ASSISTANT,
          clientId: "luke-a",
          text: "Mm-hmm.",
          metadata: { ...SPOKEN, author: MESSAGE_AUTHOR.VOICE_MODEL, from_ms: 3000, to_ms: 3400 },
        }),
      ),
    ),
  );
  const before = await storedMessages(target);
  const revisionBefore = await journalRevision(target);

  // No turn known yet: each row takes the delegation into its metadata where it stands, at a bumped revision.
  const attached = await database.run(
    writer.attachSpokenAsk(target, { delegationId: "dl_1", rowIds: ["row-a", "row-b"] }),
  );
  assert.ok(Result.isSuccess(attached));
  if (!Result.isSuccess(attached)) return;
  assert.deepEqual(attached.success, [before[0]?.id, before[1]?.id]);
  const delegated = await storedMessages(target);
  assert.deepEqual(
    delegated.map((row) => [row.id, row.clientId, row.seq, row.turnId, row.metadata]),
    [
      [
        before[0]?.id,
        "row-a",
        before[0]?.seq,
        null,
        { ...SPOKEN, from_ms: 1000, to_ms: 2200, delegation_id: "dl_1" },
      ],
      [
        before[1]?.id,
        "row-b",
        before[1]?.seq,
        null,
        { ...SPOKEN, from_ms: 6000, to_ms: 6400, delegation_id: "dl_1" },
      ],
      [before[2]?.id, "luke-a", before[2]?.seq, null, before[2]?.metadata],
    ],
  );
  assert.ok((delegated[0]?.revision ?? 0) > (before[0]?.revision ?? 0));
  assert.ok(((await journalRevision(target)) ?? 0) > (revisionBefore ?? 0));
  // Told twice, the same rows are the delegation's; nothing moves.
  const twice = await database.run(
    writer.attachSpokenAsk(target, { delegationId: "dl_1", rowIds: ["row-a", "row-b"] }),
  );
  assert.ok(Result.isSuccess(twice));
  if (!Result.isSuccess(twice)) return;
  assert.deepEqual(twice.success, attached.success);
  assert.deepEqual(
    (await storedMessages(target)).map((row) => [row.seq, row.revision]),
    delegated.map((row) => [row.seq, row.revision]),
  );
  // A row keeps growing under its own id after the handover, and keeps the delegation as it grows.
  assert.ok(Result.isSuccess(await developerRow("row-b", "one. Please.", 6000, 7100)));
  const grown = (await storedMessages(target))[1];
  assert.deepEqual(
    [grown?.id, grown?.clientId, grown?.parts, grown?.metadata],
    [
      before[1]?.id,
      "row-b",
      [{ type: "text", text: "one. Please.", state: "done" }],
      { ...SPOKEN, from_ms: 6000, to_ms: 7100, delegation_id: "dl_1" },
    ],
  );
  // Another delegation naming the same row finds nothing of its own to take.
  const other = await database.run(
    writer.attachSpokenAsk(target, { delegationId: "dl_2", rowIds: ["row-a"] }),
  );
  assert.deepEqual(other, Result.succeed([]));
  assert.deepEqual((await storedMessages(target))[0]?.metadata, {
    ...SPOKEN,
    from_ms: 1000,
    to_ms: 2200,
    delegation_id: "dl_1",
  });

  // The ask learns its turn, whose first step already opened its journal: attaching now takes the
  // rows into the turn in the order they stood, at fresh places ahead of the journal, which moves behind.
  const asks = askRecord();
  const ask = await database.run(
    asks.record({
      userId: target.userId,
      conversationId: target.conversationId,
      clientId: "dl_1",
      origin: "spoken",
      createdAt: new Date(NOW),
    }),
  );
  const stream = new Stream();
  await feed(target, [stream.started(BRAIN_TURN_ORIGIN.SPOKEN, BRAIN_TURN_TRIGGER.ASK)]);
  await database.run(
    asks.dispatchOnce(target, ask.id, () =>
      Effect.succeed({ sessionId: "wrun_4", turnId: stream.turnId }),
    ),
  );
  await feed(target, [stream.step(1)]);
  const journal = (await storedMessages(target)).find((row) => row.clientId === stream.turnId);
  assert.ok(journal);
  const taken = await database.run(
    writer.attachSpokenAsk(target, { delegationId: "dl_1", rowIds: ["row-a", "row-b"] }),
  );
  assert.ok(Result.isSuccess(taken));
  if (!Result.isSuccess(taken)) return;
  assert.deepEqual(taken.success, attached.success);
  const after = await storedMessages(target);
  assert.deepEqual(
    after.map((row) => [row.id, row.clientId, row.turnId]),
    [
      [before[2]?.id, "luke-a", null],
      [before[0]?.id, "row-a", stream.turnId],
      [before[1]?.id, "row-b", stream.turnId],
      [journal.id, stream.turnId, stream.turnId],
    ],
  );
  assert.ok((after[1]?.seq ?? 0) > (journal.seq ?? 0));
  assert.ok((after[3]?.seq ?? 0) > (after[2]?.seq ?? 0));
  // Attaching nothing is nothing.
  assert.deepEqual(
    await database.run(writer.attachSpokenAsk(target, { delegationId: "dl_1", rowIds: [] })),
    Result.succeed([]),
  );
  // A delegation id the vocabulary refuses is a refusal, and the row stands as it was: the stream
  // admits any opaque delegation id, and a row it cannot be read back with is never written.
  assert.ok(Result.isSuccess(await developerRow("row-c", "And this.", 9000, 9400)));
  const standing = (await storedMessages(target)).find((row) => row.clientId === "row-c");
  const refused = await database.run(
    writer.attachSpokenAsk(target, { delegationId: "x".repeat(129), rowIds: ["row-c"] }),
  );
  assert.ok(Result.isFailure(refused));
  if (!Result.isFailure(refused)) return;
  assert.equal(refused.failure.refusal, STORE_WRITE_REFUSAL.MESSAGE_REFUSED);
  assert.deepEqual(
    (await storedMessages(target)).find((row) => row.clientId === "row-c"),
    standing,
  );
});
