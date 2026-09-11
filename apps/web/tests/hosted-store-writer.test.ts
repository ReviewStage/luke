import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type ToolSet, tool, type UIMessage } from "ai";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, test } from "vitest";
import { z } from "zod";
import {
  ACTION_OUTPUT_STATUS,
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  type BrainRequestRecord,
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
import {
  CONVERSATION_KIND,
  conversations,
  events,
  messages,
  turns,
} from "../server/db/storage-schema";
import {
  type ConversationTarget,
  STORE_WRITE_EFFECT,
  STORE_WRITE_REFUSAL,
  type StoreWriteResult,
  storeWriter,
} from "../server/hosted/store";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * The store writer over the real migrations on PGlite. Synthetic fixtures
 * throughout: no real title, branch, transcript, or spoken word. What these
 * tests hold to is the record the plan describes — which rows a turn of each
 * kind leaves, in which states, in which order — and never the words in them.
 */

const NOW = 1_800_000_000_000;

type TurnFailure = NonNullable<BrainRequestRecord["failure"]>;

/** The one failure word the fixtures need, typed against the run's own set so a misspelling fails to compile. */
const MODEL_FAILURE: TurnFailure = "model";

const database = await openHostedStoreTestDatabase();
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

const writer = await storeWriter({ db: database.db, tools: TOOLS, now: () => new Date(NOW) });

/** Messages as they cross into the reader: their JSON shape, which is what a row holds. */
function asWire(stored: readonly UIMessage[]): UnparsedWireValue {
  return unparsedWire(JSON.parse(JSON.stringify(stored)));
}

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
      responseIds?: readonly string[];
      at?: number;
    } = {},
  ): BrainRunEvent {
    return this.event({
      kind: BRAIN_RUN_EVENT.TURN_ENDED,
      status,
      ...(options.failure !== undefined ? { failure: options.failure } : undefined),
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
  for (const event of stream) results.push(await writer.consume(target, event));
  return results;
}

function effects(results: readonly StoreWriteResult[]): readonly string[] {
  return results.map((result) => (result.ok ? result.effect : result.refusal));
}

async function storedMessages(target: ConversationTarget) {
  return database.db
    .select({
      seq: messages.seq,
      role: messages.role,
      clientId: messages.clientId,
      turnId: messages.turnId,
      parts: messages.parts,
      metadata: messages.metadata,
      finishedAt: messages.finishedAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, target.conversationId))
    .orderBy(asc(messages.seq));
}

async function storedTurn(turnId: string) {
  const [row] = await database.db
    .select({
      origin: turns.origin,
      status: turns.status,
      queuedAt: turns.queuedAt,
      startedAt: turns.startedAt,
      settledAt: turns.settledAt,
      failure: turns.failure,
      usage: turns.usage,
      responseIds: turns.responseIds,
    })
    .from(turns)
    .where(eq(turns.id, turnId));
  return row;
}

async function counters(target: ConversationTarget) {
  const [row] = await database.db
    .select({ message: conversations.nextMessageSeq, event: conversations.nextEventSeq })
    .from(conversations)
    .where(eq(conversations.id, target.conversationId));
  return row;
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
  await assert.rejects(storeWriter({ db: database.db, tools: narrow }));
  const undeclared: ToolSet = {
    read_transcript: tool({
      description: "Reads the tail of an observed session's transcript.",
      inputSchema: z.object({ providerId: z.string(), providerSessionId: z.string() }),
    }),
  };
  await storeWriter({ db: database.db, tools: undeclared });
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

  const read = await readStoredUIMessages(
    asWire(
      rows.map((row) => ({
        id: row.clientId,
        role: row.role,
        metadata: row.metadata,
        parts: row.parts,
      })),
    ),
    TOOLS,
  );
  assert.equal(read.ok, true);
});

test("an observation turn on an observed conversation is a roster-diff turn whose words the brain wrote for itself", async () => {
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
      source: OBSERVATION_SOURCE.ROSTER_LOOK,
    }),
    stream.toolCall("call_a", "announce", ANNOUNCE_INPUT),
    stream.toolAnswered("call_a", "announce", { status: "accepted" }),
    stream.answered(randomUUID(), announceParts),
    stream.ended(BRAIN_REQUEST_STATUS.SUCCEEDED),
  ]);
  assert.equal(
    results.every((result) => result.ok),
    true,
  );

  const rows = await storedMessages(target);
  assert.deepEqual(
    rows.map((row) => [row.seq, row.role, row.metadata]),
    [
      [
        1,
        MESSAGE_ROLE.USER,
        { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.ROSTER_LOOK },
      ],
      [2, MESSAGE_ROLE.ASSISTANT, { author: MESSAGE_AUTHOR.BRAIN }],
    ],
  );
  assert.deepEqual(rows[1]?.parts, announceParts);
  const turn = await storedTurn(stream.turnId);
  assert.deepEqual(
    [turn?.origin, turn?.status, turn?.responseIds],
    [TURN_ORIGIN.ROSTER_DIFF, TURN_STATUS.SETTLED, []],
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
  assert.equal(
    results.every((result) => result.ok),
    true,
  );
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
  assert.equal(
    results.every((result) => result.ok),
    true,
  );

  const rows = await storedMessages(target);
  const journal = rows[1];
  assert.ok(journal);
  assert.equal(journal.finishedAt, null);
  assert.deepEqual(journal.parts, [answeredCall("call_1"), pendingCall("call_2")]);
  const turn = await storedTurn(stream.turnId);
  assert.equal(turn?.status, TURN_STATUS.RUNNING);

  const read = await readStoredUIMessages(
    asWire([
      {
        id: journal.clientId,
        role: journal.role,
        metadata: journal.metadata,
        parts: journal.parts,
      },
    ]),
    TOOLS,
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
    first.push(await writer.consume(target, event));
    second.push(await writer.consume(target, event));
  }
  assert.equal(
    first.every((result) => result.ok && result.effect === STORE_WRITE_EFFECT.WRITTEN),
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
  assert.equal(
    results.every((result) => result.ok),
    true,
  );
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
  const again = await writer.consume(
    target,
    stream.toolFailed(
      "call_r",
      "read_transcript",
      "The session is not in the roster.",
      ACTION_OUTPUT_STATUS.REFUSED,
    ),
  );
  assert.deepEqual(again, { ok: true, effect: STORE_WRITE_EFFECT.REPEATED });
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
  assert.equal(
    results.every((result) => result.ok),
    true,
  );
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
  const read = await readStoredUIMessages(
    asWire([
      {
        id: journal.clientId,
        role: journal.role,
        metadata: journal.metadata,
        parts: journal.parts,
      },
    ]),
    TOOLS,
  );
  assert.equal(read.ok, true);
  const turn = await storedTurn(stream.turnId);
  assert.deepEqual([turn?.status, turn?.failure], [TURN_STATUS.CANCELLED, null]);

  const late = await writer.consume(
    target,
    stream.toolAnswered("call_1", "read_transcript", TRANSCRIPT_OUTPUT),
  );
  assert.deepEqual(late, { ok: false, refusal: STORE_WRITE_REFUSAL.FINISHED });
  const again = await writer.consume(target, stream.ended(BRAIN_REQUEST_STATUS.SUCCEEDED));
  assert.deepEqual(again, { ok: true, effect: STORE_WRITE_EFFECT.REPEATED });
});

test("a turn that failed records its failure word, and one that timed out without a word records the status it ended in", async () => {
  const target = await conversation();
  const failed = new Stream();
  await feed(target, [
    failed.started(BRAIN_TURN_ORIGIN.SPOKEN, BRAIN_TURN_TRIGGER.ASK),
    failed.ended(BRAIN_REQUEST_STATUS.FAILED, { failure: MODEL_FAILURE }),
  ]);
  const timedOut = new Stream();
  await feed(target, [
    timedOut.started(BRAIN_TURN_ORIGIN.HOLD_RELEASE, BRAIN_TURN_TRIGGER.HOLD_RELEASED),
    timedOut.ended(BRAIN_REQUEST_STATUS.TIMED_OUT),
  ]);
  const failedTurn = await storedTurn(failed.turnId);
  const timedOutTurn = await storedTurn(timedOut.turnId);
  assert.deepEqual(
    [failedTurn?.origin, failedTurn?.status, failedTurn?.failure],
    [TURN_ORIGIN.SPOKEN, TURN_STATUS.FAILED, MODEL_FAILURE],
  );
  assert.deepEqual(
    [timedOutTurn?.origin, timedOutTurn?.status, timedOutTurn?.failure],
    [TURN_ORIGIN.HOLD_RELEASE, TURN_STATUS.FAILED, BRAIN_REQUEST_STATUS.TIMED_OUT],
  );
});

test("a queued turn keeps the origin it was queued under through running to settled, and is queued once", async () => {
  const target = await conversation();
  const stream = new Stream();
  const queued = await writer.enqueueTurn(target, {
    turnId: stream.turnId,
    origin: TURN_ORIGIN.SPOKEN,
    model: "gpt-fixture",
  });
  assert.deepEqual(queued, { ok: true, turnId: stream.turnId, effect: STORE_WRITE_EFFECT.WRITTEN });
  const twice = await writer.enqueueTurn(target, {
    turnId: stream.turnId,
    origin: TURN_ORIGIN.TYPED,
  });
  assert.deepEqual(twice, { ok: true, turnId: stream.turnId, effect: STORE_WRITE_EFFECT.REPEATED });
  assert.equal((await storedTurn(stream.turnId))?.status, TURN_STATUS.QUEUED);

  const started = await writer.consume(
    target,
    stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK, NOW + 500),
  );
  assert.deepEqual(started, { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN });
  const running = await storedTurn(stream.turnId);
  assert.deepEqual(
    [running?.origin, running?.status, running?.queuedAt?.getTime(), running?.startedAt?.getTime()],
    [TURN_ORIGIN.SPOKEN, TURN_STATUS.RUNNING, NOW, NOW + 500],
  );
  await writer.consume(target, stream.ended(BRAIN_REQUEST_STATUS.SUCCEEDED));
  assert.equal((await storedTurn(stream.turnId))?.status, TURN_STATUS.SETTLED);

  const minted = await writer.enqueueTurn(target, { origin: TURN_ORIGIN.ROSTER_DIFF });
  assert.equal(minted.ok, true);
  if (!minted.ok) return;
  assert.equal((await storedTurn(minted.turnId))?.origin, TURN_ORIGIN.ROSTER_DIFF);
});

test("a sequence already taken under the counter is the retry signal: the write lands on the next free position and the counter is re-aligned", async () => {
  const target = await conversation();
  const stream = new Stream();
  await writer.consume(target, stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK));
  const before = await counters(target);
  assert.ok(before);
  await database.db.insert(messages).values({
    userId: target.userId,
    conversationId: target.conversationId,
    seq: before.message,
    clientId: "taken-outside-the-counter",
    role: MESSAGE_ROLE.SYSTEM,
    parts: [{ type: "text", text: "taken" }],
  });
  const askId = randomUUID();
  const result = await writer.consume(target, stream.words(askId, "hello", TYPED_ASK));
  assert.deepEqual(result, { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN });
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
  await writer.consume(target, stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK));

  const unregistered = await writer.consume(target, stream.toolCall("call_x", "list_sessions", {}));
  assert.deepEqual(unregistered, {
    ok: false,
    refusal: STORE_WRITE_REFUSAL.MESSAGE_REFUSED,
    reason: SCHEMA_REFUSAL.NOT_REGISTERED,
    path: [0, "parts", 0, "type"],
  });

  const wrongInput = await writer.consume(
    target,
    stream.toolCall("call_y", "read_transcript", { providerId: 7 }),
  );
  assert.equal(wrongInput.ok, false);
  if (wrongInput.ok) return;
  assert.equal(wrongInput.refusal, STORE_WRITE_REFUSAL.MESSAGE_REFUSED);
  assert.equal("reason" in wrongInput && wrongInput.reason, SCHEMA_REFUSAL.MALFORMED);

  const decorated = await writer.consume(
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
  );
  assert.equal(decorated.ok, false);
  if (decorated.ok) return;
  assert.equal(decorated.refusal, STORE_WRITE_REFUSAL.MESSAGE_REFUSED);

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
  const noConversation = await writer.consume(
    elsewhere,
    stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK),
  );
  assert.deepEqual(noConversation, { ok: false, refusal: STORE_WRITE_REFUSAL.NO_CONVERSATION });

  const other = await conversation();
  const otherUser = { userId: other.userId, conversationId: target.conversationId };
  const wrongUser = await writer.consume(
    otherUser,
    stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK),
  );
  assert.deepEqual(wrongUser, { ok: false, refusal: STORE_WRITE_REFUSAL.NO_CONVERSATION });

  const noTurn = await writer.consume(
    target,
    stream.toolCall("call_1", "read_transcript", TRANSCRIPT_INPUT),
  );
  assert.deepEqual(noTurn, { ok: false, refusal: STORE_WRITE_REFUSAL.NO_TURN });
  const noTurnAnswer = await writer.consume(
    target,
    stream.toolAnswered("call_1", "read_transcript", TRANSCRIPT_OUTPUT),
  );
  assert.deepEqual(noTurnAnswer, { ok: false, refusal: STORE_WRITE_REFUSAL.NO_TURN });
  const noTurnWords = await writer.consume(target, stream.words(randomUUID(), "hi", TYPED_ASK));
  assert.deepEqual(noTurnWords, { ok: false, refusal: STORE_WRITE_REFUSAL.NO_TURN });
  const noTurnEnd = await writer.consume(target, stream.ended(BRAIN_REQUEST_STATUS.SUCCEEDED));
  assert.deepEqual(noTurnEnd, { ok: false, refusal: STORE_WRITE_REFUSAL.NO_TURN });

  await writer.consume(target, stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK));
  const noCall = await writer.consume(
    target,
    stream.toolAnswered("call_never_told", "read_transcript", TRANSCRIPT_OUTPUT),
  );
  assert.deepEqual(noCall, { ok: false, refusal: STORE_WRITE_REFUSAL.NO_CALL });
  assert.deepEqual(await storedMessages(target), []);
});

test("a cleared conversation is written by nothing, like one that never was", async () => {
  const target = await conversation();
  await database.db
    .update(conversations)
    .set({ deletedAt: new Date(NOW) })
    .where(eq(conversations.id, target.conversationId));
  const stream = new Stream();
  const started = await writer.consume(
    target,
    stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK),
  );
  assert.deepEqual(started, { ok: false, refusal: STORE_WRITE_REFUSAL.NO_CONVERSATION });
  const queued = await writer.enqueueTurn(target, { origin: TURN_ORIGIN.TYPED });
  assert.deepEqual(queued, { ok: false, refusal: STORE_WRITE_REFUSAL.NO_CONVERSATION });
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
  const same = await writer.consume(target, stream.answered(randomUUID(), REPLY_PARTS));
  assert.deepEqual(same, { ok: true, effect: STORE_WRITE_EFFECT.REPEATED });
  const different = await writer.consume(
    target,
    stream.answered(randomUUID(), [
      { type: UI_PART_TYPE.TEXT, text: "Second thoughts.", state: UI_PART_STATE.DONE },
    ]),
  );
  assert.deepEqual(different, { ok: false, refusal: STORE_WRITE_REFUSAL.FINISHED });
  const [, reply] = await storedMessages(target);
  assert.deepEqual(reply?.parts, REPLY_PARTS);
});

test("a reasoning item naming no id is not journaled, since nothing could tell its repeat from a second item", async () => {
  const target = await conversation();
  const stream = new Stream();
  await writer.consume(target, stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK));
  const unnamed = await writer.consume(
    target,
    stream.event({
      kind: BRAIN_RUN_EVENT.REASONING_COMPLETED,
      summary: "Thinking.",
      item: { type: "reasoning" },
    }),
  );
  assert.deepEqual(unnamed, { ok: true, effect: STORE_WRITE_EFFECT.IGNORED });
  const named = await writer.consume(target, stream.reasoning("rs_9", "Thinking."));
  assert.deepEqual(named, { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN });
  const again = await writer.consume(target, stream.reasoning("rs_9", "Thinking."));
  assert.deepEqual(again, { ok: true, effect: STORE_WRITE_EFFECT.REPEATED });
  const [journal] = await storedMessages(target);
  assert.deepEqual(journal?.parts, [
    { type: UI_PART_TYPE.REASONING, id: "rs_9", text: "Thinking.", state: UI_PART_STATE.DONE },
  ]);
});

test("the relay's own events and the stream's compaction event write nothing", async () => {
  const target = await conversation();
  const stream = new Stream();
  await writer.consume(target, stream.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK));
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

test("a compaction is written once by its owner as an assistant row naming what it folded", async () => {
  const target = await conversation();
  const stream = new Stream();
  const askId = randomUUID();
  await feed(target, developerTurn(stream, askId, randomUUID()));
  const [ask] = await storedMessages(target);
  assert.ok(ask);
  const compaction = {
    clientId: "compaction-1",
    turnId: stream.turnId,
    text: "Earlier the developer asked after the fixture session.",
    firstKeptMessageId: ask.clientId,
    tokensBefore: 4_200,
  };
  assert.deepEqual(await writer.recordCompaction(target, compaction), {
    ok: true,
    effect: STORE_WRITE_EFFECT.WRITTEN,
  });
  assert.deepEqual(await writer.recordCompaction(target, compaction), {
    ok: true,
    effect: STORE_WRITE_EFFECT.REPEATED,
  });
  const rows = await storedMessages(target);
  assert.deepEqual(
    rows.map((row) => [row.seq, row.role, row.clientId, row.finishedAt !== null]),
    [
      [1, MESSAGE_ROLE.USER, askId, true],
      [2, MESSAGE_ROLE.ASSISTANT, stream.turnId, true],
      [3, MESSAGE_ROLE.ASSISTANT, "compaction-1", true],
    ],
  );
  assert.deepEqual(rows[2]?.metadata, {
    author: MESSAGE_AUTHOR.BRAIN,
    compaction: { first_kept_message_id: ask.clientId, tokens_before: 4_200 },
  });
  assert.deepEqual(rows[2]?.parts, [
    { type: UI_PART_TYPE.TEXT, text: compaction.text, state: UI_PART_STATE.DONE },
  ]);

  const unknownTurn = await writer.recordCompaction(target, {
    ...compaction,
    clientId: "compaction-2",
    turnId: randomUUID(),
  });
  assert.deepEqual(unknownTurn, { ok: false, refusal: STORE_WRITE_REFUSAL.NO_TURN });

  const uncounted = await writer.recordCompaction(target, {
    clientId: "compaction-3",
    text: "Earlier still.",
    firstKeptMessageId: ask.clientId,
  });
  assert.deepEqual(uncounted, { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN });
  const [, , , uncountedRow] = await storedMessages(target);
  assert.deepEqual(uncountedRow?.metadata, {
    author: MESSAGE_AUTHOR.BRAIN,
    compaction: { first_kept_message_id: ask.clientId },
  });

  const wordless = await writer.recordCompaction(target, {
    clientId: "compaction-4",
    text: "   ",
    firstKeptMessageId: ask.clientId,
  });
  assert.equal(wordless.ok, false);
  if (wordless.ok) return;
  assert.equal(wordless.refusal, STORE_WRITE_REFUSAL.MESSAGE_REFUSED);
});

test("events about a message are numbered by the conversation's own event sequence, and one about no message is refused", async () => {
  const target = await conversation();
  const stream = new Stream();
  await feed(target, developerTurn(stream, randomUUID(), randomUUID()));
  const [, reply] = await database.db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.conversationId, target.conversationId))
    .orderBy(asc(messages.seq));
  assert.ok(reply);
  const offered = await writer.recordEvent(target, {
    messageId: reply.id,
    kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
  });
  const claimed = await writer.recordEvent(target, {
    messageId: reply.id,
    kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
    deviceId: "device-1",
    payload: { at: NOW },
  });
  assert.equal(offered.ok && offered.seq, 1);
  assert.equal(claimed.ok && claimed.seq, 2);
  const stored = await database.db
    .select({
      seq: events.seq,
      kind: events.kind,
      deviceId: events.deviceId,
      payload: events.payload,
    })
    .from(events)
    .where(and(eq(events.conversationId, target.conversationId), eq(events.messageId, reply.id)))
    .orderBy(asc(events.seq));
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

  const noMessage = await writer.recordEvent(target, {
    messageId: randomUUID(),
    kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
  });
  assert.deepEqual(noMessage, { ok: false, refusal: STORE_WRITE_REFUSAL.NO_MESSAGE });

  const other = await conversation();
  const elsewhere = await writer.recordEvent(other, {
    messageId: reply.id,
    kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
  });
  assert.deepEqual(elsewhere, { ok: false, refusal: STORE_WRITE_REFUSAL.NO_MESSAGE });

  const secondClaim = await writer.recordEvent(target, {
    messageId: reply.id,
    kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
    deviceId: "device-2",
  });
  assert.deepEqual(secondClaim, { ok: false, refusal: STORE_WRITE_REFUSAL.ALREADY_CLAIMED });
  assert.deepEqual(await counters(target), { message: 3, event: 3 });
});
