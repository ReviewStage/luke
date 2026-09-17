import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  type BrainTurnsAnswer,
  brainTurnsAnswerSchema,
  type ConversationEventsAnswer,
  type ConversationMessagesAnswer,
  type ConversationReadMessage,
  changesAnswerSchema,
  conversationEventsAnswerSchema,
  conversationMessagesAnswerSchema,
  encodeSequenceReadCursor,
  HOSTED_API_ERROR,
  READ_PAGE_BOUNDS,
  sequenceReadCursorSchema,
  turnReadCursorSchema,
} from "@sidecar/hosted";
import {
  CONVERSATION_VIEW_SOURCE,
  CONVERSATION_VIEW_TOOL_KIND,
  type ConversationViewSource,
  type ConversationViewTurn,
} from "@sidecar/session";
import {
  CONVERSATION_EVENT_KIND,
  EXCESS_KEYS,
  isRecord,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_RATING,
  MESSAGE_ROLE,
  OBSERVATION_SOURCE,
  RATING_WORD,
  type SpokenAskMetadata,
  TURN_ORIGIN,
  TURN_STATUS,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
  type WireRecord,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { and, eq, sql } from "drizzle-orm";
import { Effect, Schema as EffectSchema, Result } from "effect";
import { afterAll } from "vitest";
import { ASK_ORIGIN, type StoredUIMessage } from "../server/core";
import { db } from "../server/db/query";
import { conversations, messages, providerCursors, turns } from "../server/db/storage-schema";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { handleChanges } from "../server/hosted/change-signal";
import {
  handleBrainTurns,
  handleConversationEvents,
  handleConversationMessages,
  type ResourceReadOptions,
} from "../server/hosted/resource-reads";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import { EpochMillisColumnSchema } from "../server/hosted/store/database";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  amendMessageInPlace,
  insertConversation as insertConversationRow,
  insertEvent as insertEventRow,
  insertMessage as insertMessageRow,
  insertProviderCursor,
  insertTurn as insertTurnRow,
  readConversationById,
  readEventsByMessage,
  readMessageById,
  readMessagesByConversation,
  readMessagesByConversationTyped,
} from "./support/store-rows";

/**
 * The three reads over the real store and migrations: two devices paging at
 * different bounds converge on the same messages in the same order under the
 * same cursor, a Clear leaves the next read and the cursor at once, a row the
 * catalog cannot read refuses the page naming the row, and the events and
 * turns page behind cursors of their own.
 */

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const database = await openHostedStoreTestDatabase({ at: NOW });
afterAll(() => database.close());
const writer = await database.run(storeWriter({ tools: CATALOG_TOOL_SET }));

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

const SESSION = {
  providerId: "conductor",
  providerSessionId: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50",
} as const;
const SESSION_FIELDS = {
  provider_id: SESSION.providerId,
  provider_session_id: SESSION.providerSessionId,
} as const;

const TYPED_ASK = { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED } as const;
const BRAIN_REPLY = { author: MESSAGE_AUTHOR.BRAIN } as const;
const TRANSCRIPT_CHANGE = {
  author: MESSAGE_AUTHOR.BRAIN,
  source: OBSERVATION_SOURCE.TRANSCRIPT_CHANGE,
} as const;

type MessageParts = StoredUIMessage["parts"];

function toolPart(
  name: string,
  callId: string,
  input: WireRecord,
  state: "output-available" | "input-available" = "output-available",
): MessageParts[number] {
  const settled = state === "output-available" ? { output: {} } : {};
  // SAFETY: a stored tool part in the SDK's own shape; the read under the catalog registry is the validation.
  return {
    type: `tool-${name}`,
    toolCallId: callId,
    state,
    input,
    ...settled,
  } as unknown as MessageParts[number];
}

/**
 * Moves a conversation's own allocation past a row a test wrote itself, as
 * the writer's allocation would have moved it.
 *
 * Note that there is one of these per counter rather than one taking the
 * counter's name, because the update names the column it also compares
 * against and the builder spells a column rather than interpolating its name.
 */
function bumpMessageCounter(conversationId: string, seq: number): Promise<void> {
  return database.run(
    Effect.asVoid(
      db
        .update(conversations)
        .set({ nextMessageSeq: sql`greatest(${conversations.nextMessageSeq}, ${seq + 1})` })
        .where(eq(conversations.id, conversationId)),
    ),
  );
}

function bumpEventCounter(conversationId: string, seq: number): Promise<void> {
  return database.run(
    Effect.asVoid(
      db
        .update(conversations)
        .set({ nextEventSeq: sql`greatest(${conversations.nextEventSeq}, ${seq + 1})` })
        .where(eq(conversations.id, conversationId)),
    ),
  );
}

/** A conversation opened an hour before the fixture's rows, as a main stands before anything is written under it. */
async function insertConversation(
  userId: string,
  row: Omit<Parameters<typeof insertConversationRow>[1], "userId"> = {},
): Promise<string> {
  return insertConversationRow(database.run, {
    kind: CONVERSATION_KIND.MAIN,
    createdAt: new Date(NOW - 3_600_000),
    ...row,
    userId,
  });
}

async function insertTurn(
  userId: string,
  conversationId: string,
  row: Partial<Omit<Parameters<typeof insertTurnRow>[1], "userId" | "conversationId">> = {},
): Promise<string> {
  return insertTurnRow(database.run, {
    origin: TURN_ORIGIN.TYPED,
    status: TURN_STATUS.SETTLED,
    queuedAt: new Date(NOW),
    ...row,
    userId,
    conversationId,
  });
}

/**
 * Inserts the row and moves the conversation's counter past it, as the
 * writer's allocation would have. The row is finished as it lands, as the
 * writer finishes a user's and a compaction's row and a settled reply; a test
 * writing a row still in flight says so with `finishedAt: null`.
 */
async function insertMessage(
  userId: string,
  conversationId: string,
  seq: number,
  row: Partial<
    Omit<Parameters<typeof insertMessageRow>[1], "userId" | "conversationId" | "seq">
  > = {},
): Promise<string> {
  const id = await insertMessageRow(database.run, {
    clientId: `client-${seq}`,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: `ask ${seq}` }],
    metadata: TYPED_ASK,
    createdAt: new Date(NOW + seq * 1000),
    finishedAt: new Date(NOW + seq * 1000 + 500),
    ...row,
    userId,
    conversationId,
    seq,
  });
  await bumpMessageCounter(conversationId, seq);
  return id;
}

async function insertEvent(
  userId: string,
  conversationId: string,
  messageId: string,
  seq: number,
  row: Partial<
    Omit<Parameters<typeof insertEventRow>[1], "userId" | "conversationId" | "messageId" | "seq">
  > = {},
): Promise<string> {
  const id = await insertEventRow(database.run, {
    kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
    createdAt: new Date(NOW + seq * 1000),
    ...row,
    userId,
    conversationId,
    messageId,
    seq,
  });
  await bumpEventCounter(conversationId, seq);
  return id;
}

/** Every column of the account's cursor rows, because what a Clear must leave untouched is the whole row. */
function readProviderCursorRows(userId: string) {
  return database.run(
    db
      .select()
      .from(providerCursors)
      .where(eq(providerCursors.userId, userId))
      .orderBy(providerCursors.providerSessionId),
  );
}

const READ_QUERY = {
  AFTER: "after",
  LIMIT: "limit",
} as const;

const READ_PATH = {
  MESSAGES: "/api/conversation/messages",
  EVENTS: "/api/conversation/events",
  TURNS: "/api/brain/turns",
} as const;

/** The query a read takes, with the bound spelled as a client might misspell it. */
interface ReadQuery {
  after?: string;
  limit?: number | string;
}

function request(path: string, query: ReadQuery = {}, method = "GET", authorized = true): Request {
  const url = new URL(`https://luke.test${path}`);
  if (query.after !== undefined) url.searchParams.set(READ_QUERY.AFTER, query.after);
  if (query.limit !== undefined) url.searchParams.set(READ_QUERY.LIMIT, String(query.limit));
  return new Request(url, {
    method,
    headers: authorized ? { authorization: "Bearer token-1" } : {},
  });
}

function options(userId: string, req: Request): ResourceReadOptions {
  return {
    request: req,
    resolveUserId: () => Effect.succeedSome(userId),
    store: database.store,
  };
}

async function answered<Value, Encoded>(
  response: Response,
  schema: EffectSchema.Codec<Value, Encoded>,
): Promise<Value> {
  assert.equal(response.status, 200);
  // SAFETY: the response body is the route's own JSON; the schema read is the validation.
  const body = (await response.json()) as UnparsedWireValue;
  // An answer's family was declared tolerant, so the read drops a key a newer
  // service may have added rather than refusing the answer for it.
  const read = readEither(schema, { excess: EXCESS_KEYS.DROP })(body);
  if (Result.isFailure(read))
    assert.fail(`${read.failure.refusal} at ${read.failure.path.join(".")}`);
  return read.success;
}

function parse<Value, Encoded>(
  schema: EffectSchema.Codec<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Result.getOrUndefined(readEither(schema)(value));
}

/**
 * A device's own picture of the Conversation, kept the way a client keeps
 * it: groups merged by turn, each message held once by id at the sequence
 * its latest delivery gave it, conversations an answer no longer lists
 * dropped, and the whole ordered as the view orders it — earliest message,
 * then the turn's queue instant, then the id.
 */
interface ClientGroup {
  conversationId: string;
  source: ConversationViewSource;
  turn: ConversationViewTurn | undefined;
  messages: Map<number, ConversationReadMessage>;
}

class Device {
  readonly groups = new Map<string, ClientGroup>();
  /** Where each message held stands, by id: the one place a message has on this device. */
  readonly places = new Map<string, { turnId: string; seq: number }>();
  cursor: string | undefined;

  constructor(
    private readonly userId: string,
    private readonly limit: number,
  ) {}

  async poll(): Promise<ConversationMessagesAnswer> {
    const query: ReadQuery = { limit: this.limit };
    if (this.cursor !== undefined) query.after = this.cursor;
    const answer = await answered(
      await database.run(
        handleConversationMessages(options(this.userId, request(READ_PATH.MESSAGES, query))),
      ),
      conversationMessagesAnswerSchema,
    );
    const standing = new Set(answer.conversations.map((conversation) => conversation.id));
    for (const [turnId, group] of this.groups) {
      if (!standing.has(group.conversationId)) this.groups.delete(turnId);
    }
    for (const group of answer.groups) {
      const held = this.groups.get(group.turnId) ?? {
        conversationId: group.conversationId,
        source: group.source,
        turn: undefined,
        messages: new Map<number, ConversationReadMessage>(),
      };
      if (group.turn) held.turn = group.turn;
      for (const message of group.messages) {
        const id = String(message.message.id);
        const place = this.places.get(id);
        if (place && (place.turnId !== group.turnId || place.seq !== message.seq)) {
          const previous = place.turnId === group.turnId ? held : this.groups.get(place.turnId);
          previous?.messages.delete(place.seq);
          if (previous && previous !== held && previous.messages.size === 0) {
            this.groups.delete(place.turnId);
          }
        }
        held.messages.set(message.seq, message);
        this.places.set(id, { turnId: group.turnId, seq: message.seq });
      }
      this.groups.set(group.turnId, held);
    }
    this.cursor = answer.next;
    return answer;
  }

  async catchUp(): Promise<void> {
    for (let polls = 0; polls < 50; polls += 1) {
      const answer = await this.poll();
      if (!answer.hasMore) return;
    }
    throw new Error("a device never caught up");
  }

  /** Every message id in view order, each behind the id of the turn that groups it. */
  ordered(): readonly [string, string][] {
    const placed = [...this.groups].map(([turnId, group]) => {
      const messages = [...group.messages.values()].sort((a, b) => a.seq - b.seq);
      return {
        turnId,
        group,
        messages,
        instant: Math.min(...messages.map((message) => message.placedAt)),
      };
    });
    placed.sort(
      (a, b) =>
        a.instant - b.instant ||
        (a.group.turn?.queuedAt ?? Number.MAX_SAFE_INTEGER) -
          (b.group.turn?.queuedAt ?? Number.MAX_SAFE_INTEGER) ||
        (a.turnId < b.turnId ? -1 : 1),
    );
    return placed.flatMap(({ turnId, messages }) =>
      messages.map((message): [string, string] => [turnId, String(message.message.id)]),
    );
  }
}

/** A main and an observed conversation with the rows the view selects from, and the ids a device should end up holding. */
async function populate(userId: string) {
  const main = await insertConversation(userId);
  const observed = await insertConversation(userId, {
    kind: CONVERSATION_KIND.OBSERVED,
    providerId: SESSION.providerId,
    providerSessionId: SESSION.providerSessionId,
  });
  const typed = await insertTurn(userId, main, { queuedAt: new Date(NOW) });
  const roster = await insertTurn(userId, observed, {
    origin: TURN_ORIGIN.TRANSCRIPT_CHANGE,
    queuedAt: new Date(NOW + 10_000),
  });
  const later = await insertTurn(userId, main, { queuedAt: new Date(NOW + 20_000) });
  const idle = await insertTurn(userId, observed, {
    origin: TURN_ORIGIN.TRANSCRIPT_CHANGE,
    queuedAt: new Date(NOW + 30_000),
  });

  const ask = await insertMessage(userId, main, 1, { turnId: typed });
  const sent = await insertMessage(userId, main, 2, {
    turnId: typed,
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: BRAIN_REPLY,
    parts: [
      toolPart("send_session_message", "call_1a0000000000000001", {
        ...SESSION_FIELDS,
        text: "Run the tests.",
      }),
      { type: "text", text: "Sent." },
    ],
    finishedAt: new Date(NOW + 2500),
  });
  const look = await insertMessage(userId, observed, 1, {
    turnId: roster,
    metadata: TRANSCRIPT_CHANGE,
    createdAt: new Date(NOW + 11_000),
    parts: [{ type: "text", text: "Roster: the session moved to waiting." }],
  });
  const announced = await insertMessage(userId, observed, 2, {
    turnId: roster,
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: BRAIN_REPLY,
    createdAt: new Date(NOW + 12_000),
    parts: [
      toolPart("read_transcript", "call_3a0000000000000001", SESSION_FIELDS),
      toolPart("announce", "call_3a0000000000000002", { briefing: "The session is waiting." }),
    ],
    finishedAt: new Date(NOW + 12_500),
  });
  await insertEvent(userId, observed, announced, 1);
  await insertEvent(userId, observed, announced, 2, {
    kind: CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
  });
  const secondAsk = await insertMessage(userId, main, 3, {
    turnId: later,
    createdAt: new Date(NOW + 21_000),
  });
  const read = await insertMessage(userId, main, 4, {
    turnId: later,
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: BRAIN_REPLY,
    createdAt: new Date(NOW + 22_000),
    parts: [
      toolPart("read_transcript", "call_4a0000000000000001", SESSION_FIELDS),
      { type: "text", text: "Nothing new." },
    ],
  });
  await insertMessage(userId, observed, 3, {
    turnId: idle,
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: BRAIN_REPLY,
    createdAt: new Date(NOW + 31_000),
    parts: [toolPart("read_transcript", "call_5a0000000000000001", SESSION_FIELDS)],
  });

  const expected: readonly [string, string][] = [
    [typed, ask],
    [typed, sent],
    [roster, announced],
    [later, secondAsk],
    [later, read],
  ];
  return { main, observed, turns: { typed, roster, later, idle }, messages: { look }, expected };
}

/** The provider slot a reasoning part keeps its opaque replay item under, as the brain writes it. */
const REPLAY_SLOT = {
  openai: { itemId: "rs_fixture_0f3a1c22", reasoningEncryptedContent: "Zml4dHVyZS1vcGFxdWU=" },
};

it.effect(
  "a spoken ask's transcript row tied to its turn is answered inside the turn's group beside the reply, not as a group of its own; a row no turn owns still stands alone under its message id",
  () =>
    Effect.promise(async () => {
      const userId = await database.createUser();
      const main = await insertConversation(userId);
      const spoken = await insertTurn(userId, main, { origin: TURN_ORIGIN.SPOKEN });
      // The writer places the developer's line ahead of the turn's work; the view keeps the store's sequence.
      const transcript = await insertMessage(userId, main, 1, {
        clientId: "dl_1",
        turnId: spoken,
        metadata: {
          author: MESSAGE_AUTHOR.DEVELOPER,
          channel: MESSAGE_CHANNEL.VOICE,
          voice_session_id: "vs_1",
          delegation_id: "dl_1",
          from_ms: 0,
          to_ms: 2500,
        },
        parts: [{ type: "text", text: "What needs me?" }],
      });
      const reply = await insertMessage(userId, main, 2, {
        turnId: spoken,
        role: MESSAGE_ROLE.ASSISTANT,
        metadata: BRAIN_REPLY,
        parts: [{ type: "text", text: "One agent finished.", state: "done" }],
      });
      const unowned = await insertMessage(userId, main, 3, {
        clientId: "dl_2",
        metadata: {
          author: MESSAGE_AUTHOR.DEVELOPER,
          channel: MESSAGE_CHANNEL.VOICE,
          voice_session_id: "vs_1",
          delegation_id: "dl_2",
          from_ms: 3000,
          to_ms: 4000,
        },
        parts: [{ type: "text", text: "And now?" }],
      });

      const answer = await answered(
        await database.run(
          handleConversationMessages(options(userId, request(READ_PATH.MESSAGES))),
        ),
        conversationMessagesAnswerSchema,
      );
      assert.deepEqual(
        answer.groups.map((group) => [
          group.turnId,
          group.turn?.id,
          group.messages.map((row) => String(row.message.id)),
        ]),
        [
          [spoken, spoken, [transcript, reply]],
          [unowned, undefined, [unowned]],
        ],
      );
    }),
);

it.effect(
  "the page carries where each row is placed, and a spoken row placed before a typed turn's rows were written is answered ahead of them",
  () =>
    Effect.promise(async () => {
      const userId = await database.createUser();
      const main = await insertConversation(userId);
      const typed = await insertTurn(userId, main, { queuedAt: new Date(NOW) });
      const spoken = await insertTurn(userId, main, {
        origin: TURN_ORIGIN.SPOKEN,
        queuedAt: new Date(NOW + 20_000),
      });
      const ask = await insertMessage(userId, main, 1, { turnId: typed });
      // Written at settle, twenty seconds after the typed ask, but its words began five seconds before it.
      const line = await insertMessage(userId, main, 2, {
        clientId: "dl_placed",
        turnId: spoken,
        metadata: {
          author: MESSAGE_AUTHOR.DEVELOPER,
          channel: MESSAGE_CHANNEL.VOICE,
          voice_session_id: "vs_1",
          delegation_id: "dl_placed",
          from_ms: 0,
          to_ms: 2_500,
        },
        parts: [{ type: "text", text: "Before the typing." }],
        createdAt: new Date(NOW + 21_000),
        placedAt: new Date(NOW - 4_000),
      });

      const device = new Device(userId, 10);
      const answer = await device.poll();
      assert.deepEqual(device.ordered(), [
        [spoken, line],
        [typed, ask],
      ]);
      // The page itself comes in the view's order, each row saying where it was written and where it stands.
      assert.deepEqual(
        answer.groups.flatMap((group) =>
          group.messages.map((row) => [row.createdAt, row.placedAt] as const),
        ),
        [
          [NOW + 21_000, NOW - 4_000],
          [NOW + 1_000, NOW + 1_000],
        ],
      );
    }),
);

it.effect(
  "a device that read a spoken line before its turn took it reads the line again, in the turn's group ahead of the reply, and lets the standalone group go",
  () =>
    Effect.promise(async () => {
      const userId = await database.createUser();
      const main = await insertConversation(userId);
      const target = { userId, conversationId: main };
      const delegationId = "dl_early";
      const askEffects = askRecord();
      const asks = {
        record: (write: Parameters<typeof askEffects.record>[0]) =>
          database.run(askEffects.record(write)),
        dispatchOnce: (
          target: Parameters<typeof askEffects.dispatchOnce>[0],
          id: string,
          dispatch: Parameters<typeof askEffects.dispatchOnce>[2],
        ) => database.run(askEffects.dispatchOnce(target, id, dispatch)),
      };
      const ask = await asks.record({
        userId,
        conversationId: main,
        clientId: delegationId,
        origin: ASK_ORIGIN.SPOKEN,
        createdAt: new Date(NOW),
      });
      // The voice writer's cut of the transcript lands while the ask still waits for its turn.
      const line = await spokenLine(target, delegationId, "What needs me?", {
        author: MESSAGE_AUTHOR.DEVELOPER,
        channel: MESSAGE_CHANNEL.VOICE,
      });
      assert.ok(line.ok);
      const early = new Device(userId, READ_PAGE_BOUNDS.MAX_LIMIT);
      await early.catchUp();
      assert.deepEqual(early.ordered(), [[line.id, line.id]]);
      const passed = parse(sequenceReadCursorSchema, early.cursor ?? "");
      // The attach gave the row its delegation in place, at the conversation's first revision.
      assert.deepEqual(passed, { positions: [{ conversationId: main, seq: 1, revision: 1 }] });

      // The turn starts and takes the ask's line, then writes its reply.
      const turn = await insertTurn(userId, main, {
        origin: TURN_ORIGIN.SPOKEN,
        status: TURN_STATUS.RUNNING,
        queuedAt: new Date(NOW + 1000),
      });
      await asks.dispatchOnce(target, ask.id, async () => ({ sessionId: "wrun_1", turnId: turn }));
      const attached = await database.run(writer.attachAskLines(target, turn));
      assert.deepEqual(attached, { ok: true, attached: [line.id] });
      const reply = await insertMessage(userId, main, 3, {
        clientId: turn,
        turnId: turn,
        role: MESSAGE_ROLE.ASSISTANT,
        metadata: BRAIN_REPLY,
        parts: [{ type: "text", text: "One agent finished.", state: "done" }],
      });

      const expected: readonly [string, string][] = [
        [turn, line.id],
        [turn, reply],
      ];
      await early.catchUp();
      assert.deepEqual(early.ordered(), expected);
      assert.equal(early.groups.has(line.id), false);
      const late = new Device(userId, READ_PAGE_BOUNDS.MAX_LIMIT);
      await late.catchUp();
      assert.deepEqual(late.ordered(), expected);
      assert.equal(late.cursor, early.cursor);
    }),
);

it.effect(
  "a line the turn takes with its journal already open still precedes the reply: the journal moves behind it, and a device that previewed the journal reads both again in the store's order",
  () =>
    Effect.promise(async () => {
      const userId = await database.createUser();
      const main = await insertConversation(userId);
      const target = { userId, conversationId: main };
      const delegationId = "dl_late_attach";
      const askEffects = askRecord();
      const asks = {
        record: (write: Parameters<typeof askEffects.record>[0]) =>
          database.run(askEffects.record(write)),
        dispatchOnce: (
          target: Parameters<typeof askEffects.dispatchOnce>[0],
          id: string,
          dispatch: Parameters<typeof askEffects.dispatchOnce>[2],
        ) => database.run(askEffects.dispatchOnce(target, id, dispatch)),
      };
      const ask = await asks.record({
        userId,
        conversationId: main,
        clientId: delegationId,
        origin: ASK_ORIGIN.SPOKEN,
        createdAt: new Date(NOW),
      });
      // The voice writer's cut lands before the ask learned its turn, so it stands unattached.
      const line = await spokenLine(target, delegationId, "What needs me?", {
        author: MESSAGE_AUTHOR.DEVELOPER,
        channel: MESSAGE_CHANNEL.VOICE,
      });
      assert.ok(line.ok);
      // The turn's first step opens the journal before the received message that takes the line in.
      const turn = await insertTurn(userId, main, {
        origin: TURN_ORIGIN.SPOKEN,
        status: TURN_STATUS.RUNNING,
        queuedAt: new Date(NOW + 1000),
      });
      const journal = await insertMessage(userId, main, 2, {
        clientId: turn,
        turnId: turn,
        role: MESSAGE_ROLE.ASSISTANT,
        metadata: BRAIN_REPLY,
        parts: [{ type: "text", text: "One", state: "streaming" }],
        finishedAt: null,
      });
      const device = new Device(userId, READ_PAGE_BOUNDS.MAX_LIMIT);
      await device.catchUp();
      assert.deepEqual(device.ordered(), [
        [line.id, line.id],
        [turn, journal],
      ]);

      await asks.dispatchOnce(target, ask.id, async () => ({ sessionId: "wrun_1", turnId: turn }));
      const attached = await database.run(writer.attachAskLines(target, turn));
      assert.deepEqual(attached, { ok: true, attached: [line.id] });

      // Read in sequence: both moved past the sequences they stood at, the line ahead of the journal.
      const bySeq = await readMessagesByConversationTyped(database.run, main);
      assert.deepEqual(
        bySeq.map((row) => [row.id, row.turnId]),
        [
          [line.id, turn],
          [journal, turn],
        ],
      );
      assert.ok((bySeq[0]?.seq ?? 0) > 2);
      assert.ok((bySeq[1]?.seq ?? 0) > (bySeq[0]?.seq ?? 0));

      await device.catchUp();
      assert.deepEqual(device.ordered(), [
        [turn, line.id],
        [turn, journal],
      ]);
      assert.equal(device.groups.has(line.id), false);
      const late = new Device(userId, READ_PAGE_BOUNDS.MAX_LIMIT);
      await late.catchUp();
      assert.deepEqual(late.ordered(), device.ordered());
    }),
);

it.effect("a message's replay slot never leaves the service, and the stored row keeps it", () =>
  Effect.promise(async () => {
    const userId = await database.createUser();
    const main = await insertConversation(userId);
    const typed = await insertTurn(userId, main);
    await insertMessage(userId, main, 1, { turnId: typed });
    const reply = await insertMessage(userId, main, 2, {
      turnId: typed,
      role: MESSAGE_ROLE.ASSISTANT,
      metadata: BRAIN_REPLY,
      parts: [
        { type: "step-start" },
        {
          type: "reasoning",
          text: "Read the tail first.",
          state: "done",
          providerMetadata: REPLAY_SLOT,
        },
        {
          type: "text",
          text: "It is waiting.",
          state: "done",
          providerMetadata: { openai: { itemId: "msg_1" } },
        },
      ],
    });

    const answer = await answered(
      await database.run(handleConversationMessages(options(userId, request(READ_PATH.MESSAGES)))),
      conversationMessagesAnswerSchema,
    );
    const parts = answer.groups.flatMap((group) =>
      group.messages.flatMap((row) => wireParts(row.message.parts)),
    );
    assert.equal(parts.length, 4);
    assert.deepEqual(
      parts.map((part) => "providerMetadata" in part),
      [false, false, false, false],
    );
    assert.deepEqual(
      parts.filter((part) => part.type === "reasoning"),
      [{ type: "reasoning", text: "Read the tail first.", state: "done" }],
    );

    const stored = await readMessageById(database.run, reply);
    assert.ok(stored);
    // SAFETY: the parts column is jsonb, read back as the JSON the test wrote.
    const storedParts = wireParts(unparsedWire(stored.parts as WireBoundaryInput));
    assert.deepEqual(storedParts[1]?.providerMetadata, REPLAY_SLOT);
    assert.deepEqual(storedParts[2]?.providerMetadata, { openai: { itemId: "msg_1" } });
  }),
);

/** A message's parts as JSON records, the way a device parses them; anything else fails the test. */
function wireParts(parts: UnparsedWireValue): WireRecord[] {
  assert.ok(Array.isArray(parts));
  return parts.map((part) => {
    assert.ok(isRecord(part));
    return part;
  });
}

it.effect("the gate order is method, bearer, and query, and every refusal is one shape", () =>
  Effect.promise(async () => {
    const userId = await database.createUser();
    for (const [path, handle] of [
      [READ_PATH.MESSAGES, handleConversationMessages],
      [READ_PATH.EVENTS, handleConversationEvents],
      [READ_PATH.TURNS, handleBrainTurns],
    ] as const) {
      const wrongMethod = await database.run(handle(options(userId, request(path, {}, "POST"))));
      assert.equal(wrongMethod.status, 405);
      assert.equal((await wrongMethod.json()).error, HOSTED_API_ERROR.METHOD_NOT_ALLOWED);

      const anonymous = await database.run(
        handle({
          ...options(userId, request(path, {}, "GET", false)),
          resolveUserId: () => Effect.succeedNone,
        }),
      );
      assert.equal(anonymous.status, 401);
      assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);

      const refusals: ReadQuery[] = [
        { after: "%%%" },
        { limit: 0 },
        { limit: 201 },
        { limit: "two" },
      ];
      for (const query of refusals) {
        const refused = await database.run(handle(options(userId, request(path, query))));
        assert.equal(refused.status, 400, JSON.stringify(query));
        assert.equal((await refused.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
      }
    }
  }),
);

it.effect(
  "two devices paging at different bounds converge on the same messages in the same order under the same cursor",
  () =>
    Effect.promise(async () => {
      const userId = await database.createUser();
      const { main, observed, turns: ids, expected } = await populate(userId);

      const narrow = new Device(userId, 2);
      const wide = new Device(userId, 200);
      await narrow.catchUp();
      await wide.catchUp();

      assert.deepEqual(narrow.ordered(), expected);
      assert.deepEqual(wide.ordered(), expected);
      assert.equal(narrow.cursor, wide.cursor);
      assert.deepEqual(parse(sequenceReadCursorSchema, wide.cursor ?? ""), {
        positions: [
          { conversationId: main, seq: 4, revision: 0 },
          { conversationId: observed, seq: 3, revision: 0 },
        ].sort((a, b) => (a.conversationId < b.conversationId ? -1 : 1)),
      });

      const announced = wide.groups.get(ids.roster);
      assert.ok(announced);
      assert.equal(announced.source.kind, CONVERSATION_VIEW_SOURCE.OBSERVED);
      assert.deepEqual(
        announced.source.kind === CONVERSATION_VIEW_SOURCE.OBSERVED && announced.source.session,
        SESSION,
      );
      assert.equal(announced.turn?.origin, TURN_ORIGIN.TRANSCRIPT_CHANGE);
      const crossing = announced.messages.get(2);
      assert.ok(crossing);
      const parts = crossing.message.parts;
      assert.ok(Array.isArray(parts));
      assert.equal(parts.length, 1);
      assert.deepEqual(
        crossing.tools.map((tool) => [tool.kind, tool.toolName]),
        [[CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE, "announce"]],
      );
      const announce = crossing.tools[0];
      assert.equal(
        announce?.kind === CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE && announce.unspoken,
        true,
      );
      assert.equal(wide.groups.has(ids.idle), false);

      const sent = wide.groups.get(ids.typed)?.messages.get(2);
      assert.deepEqual(
        sent?.tools.map((tool) => tool.kind),
        [CONVERSATION_VIEW_TOOL_KIND.ACTION],
      );
      const read = wide.groups.get(ids.later)?.messages.get(4);
      assert.deepEqual(
        read?.tools.map((tool) => tool.kind),
        [CONVERSATION_VIEW_TOOL_KIND.DETAIL],
      );

      const quiet = await wide.poll();
      assert.deepEqual(quiet.groups, []);
      assert.equal(quiet.hasMore, false);
      assert.equal(quiet.next, narrow.cursor);
    }),
);

it.effect(
  "a message still in flight is passed like any other, handed back on the read after each write to it and once more as it finishes, and never between",
  () =>
    Effect.promise(async () => {
      const userId = await database.createUser();
      const { main, observed, expected } = await populate(userId);
      const running = await insertTurn(userId, main, {
        status: TURN_STATUS.RUNNING,
        queuedAt: new Date(NOW + 40_000),
      });
      const ask = await insertMessage(userId, main, 5, {
        turnId: running,
        createdAt: new Date(NOW + 41_000),
      });
      const journal = await insertMessage(userId, main, 6, {
        turnId: running,
        role: MESSAGE_ROLE.ASSISTANT,
        metadata: BRAIN_REPLY,
        createdAt: new Date(NOW + 42_000),
        finishedAt: null,
        parts: [
          toolPart(
            "send_session_message",
            "call_7a0000000000000001",
            { ...SESSION_FIELDS, text: "Run the tests." },
            "input-available",
          ),
        ],
      });
      const mainPosition = (cursor: string | undefined) =>
        parse(sequenceReadCursorSchema, cursor ?? "")?.positions.find(
          (p) => p.conversationId === main,
        );
      const states = () =>
        device.groups
          .get(running)
          ?.messages.get(6)
          ?.tools.map((tool) => tool.state);

      const device = new Device(userId, 200);
      await device.catchUp();
      assert.deepEqual(device.ordered(), [...expected, [running, ask], [running, journal]]);
      // The cursor passes the row in flight and carries the conversation's revision, untouched so far.
      assert.deepEqual(mainPosition(device.cursor), { conversationId: main, seq: 6, revision: 0 });
      assert.deepEqual(states(), ["input-available"]);

      // Nothing written: the read answers nothing and the cursor stands.
      const quiet = await device.poll();
      assert.deepEqual(quiet.groups, []);
      assert.equal(quiet.hasMore, false);
      assert.deepEqual(mainPosition(quiet.next), { conversationId: main, seq: 6, revision: 0 });

      // A write to the journal: the read answers that row alone, and the cursor takes the revision.
      await amendMessageInPlace(database.run, {
        conversationId: main,
        id: journal,
        parts: [
          toolPart("send_session_message", "call_7a0000000000000001", {
            ...SESSION_FIELDS,
            text: "Run the tests.",
          }),
        ],
      });
      const written = await device.poll();
      assert.deepEqual(
        written.groups.flatMap((group) => group.messages.map((message) => message.seq)),
        [6],
      );
      assert.equal(written.hasMore, false);
      assert.deepEqual(mainPosition(written.next), { conversationId: main, seq: 6, revision: 1 });
      assert.deepEqual(states(), ["output-available"]);

      // The finish: the settled row once more, at its sequence, and quiet after.
      await amendMessageInPlace(database.run, {
        conversationId: main,
        id: journal,
        parts: [
          toolPart("send_session_message", "call_7a0000000000000001", {
            ...SESSION_FIELDS,
            text: "Run the tests.",
          }),
          { type: "text", text: "Sent." },
        ],
        finishedAt: new Date(NOW + 45_000),
      });
      const finished = await device.poll();
      assert.deepEqual(
        finished.groups.flatMap((group) => group.messages.map((message) => message.seq)),
        [6],
      );
      assert.deepEqual(mainPosition(finished.next), { conversationId: main, seq: 6, revision: 2 });
      const settledParts = device.groups.get(running)?.messages.get(6)?.message.parts;
      assert.equal(Array.isArray(settledParts) && settledParts.length, 2);
      const settled = await device.poll();
      assert.deepEqual(settled.groups, []);
      assert.equal(settled.hasMore, false);

      // A device from before rows carried a revision reads once as before and is re-minted in the new shape.
      const legacy = new Device(userId, 200);
      legacy.cursor = encodeSequenceReadCursor([
        { conversationId: main, seq: 5 },
        { conversationId: observed, seq: 3 },
      ]);
      const caught = await legacy.poll();
      assert.deepEqual(
        caught.groups.flatMap((group) => group.messages.map((message) => message.seq)),
        [6],
      );
      assert.deepEqual(mainPosition(caught.next), { conversationId: main, seq: 6, revision: 2 });
    }),
);

it.effect("a conversation longer than one page is read to its end on the default bound", () =>
  Effect.promise(async () => {
    const userId = await database.createUser();
    const main = await insertConversation(userId);
    const turn = await insertTurn(userId, main);
    const count = READ_PAGE_BOUNDS.MAX_LIMIT + 1;
    for (let seq = 1; seq <= count; seq += 1)
      await insertMessage(userId, main, seq, { turnId: turn });

    const device = new Device(userId, READ_PAGE_BOUNDS.MAX_LIMIT);
    const first = await device.poll();
    assert.equal(first.hasMore, true);
    assert.equal(first.groups[0]?.messages.length, READ_PAGE_BOUNDS.MAX_LIMIT);
    const second = await device.poll();
    assert.equal(second.hasMore, false);
    assert.equal(second.groups[0]?.messages.length, 1);
    assert.equal(device.groups.get(turn)?.messages.size, count);
  }),
);

it.effect(
  "a journal written in place is answered ahead of the rows past the cursor, and a page cut among the rows written in place names the revision it reached",
  () =>
    Effect.promise(async () => {
      const userId = await database.createUser();
      const { main, observed, expected } = await populate(userId);
      const running = await insertTurn(userId, main, {
        status: TURN_STATUS.RUNNING,
        queuedAt: new Date(NOW + 40_000),
      });
      const journal = await insertMessage(userId, main, 5, {
        turnId: running,
        role: MESSAGE_ROLE.ASSISTANT,
        metadata: BRAIN_REPLY,
        createdAt: new Date(NOW + 41_000),
        finishedAt: null,
        parts: [
          toolPart("read_transcript", "call_8a0000000000000001", SESSION_FIELDS, "input-available"),
        ],
      });
      const positions = (cursor: string | undefined) =>
        new Map(
          (parse(sequenceReadCursorSchema, cursor ?? "")?.positions ?? []).map((position) => [
            position.conversationId,
            [position.seq, position.revision],
          ]),
        );

      const device = new Device(userId, 1);
      await device.catchUp();
      assert.deepEqual(device.ordered(), [...expected, [running, journal]]);
      assert.deepEqual(
        positions(device.cursor),
        new Map([
          [main, [5, 0]],
          [observed, [3, 0]],
        ]),
      );

      // Two rows of the main written in place, the journal at the head first
      // and an older row after it: a bound of one answers them oldest write
      // first, naming the revision each page reached and saying more stands
      // until a page comes back empty, whatever the rows' sequences.
      const [first] = await readMessagesByConversationTyped(database.run, main);
      assert.ok(first);
      await amendMessageInPlace(database.run, {
        conversationId: main,
        id: journal,
        parts: [toolPart("read_transcript", "call_8a0000000000000001", SESSION_FIELDS)],
      });
      await amendMessageInPlace(database.run, {
        conversationId: main,
        id: first.id,
        parts: [{ type: "text", text: "Edited ask.", state: "done" }],
      });
      const pageOne = await device.poll();
      assert.deepEqual(
        pageOne.groups.flatMap((group) => group.messages.map((message) => message.seq)),
        [5],
      );
      assert.equal(pageOne.hasMore, true);
      assert.deepEqual(positions(pageOne.next).get(main), [5, 1]);
      const pageTwo = await device.poll();
      assert.deepEqual(
        pageTwo.groups.flatMap((group) => group.messages.map((message) => message.seq)),
        [1],
      );
      assert.equal(pageTwo.hasMore, true);
      assert.deepEqual(positions(pageTwo.next).get(main), [5, 2]);
      const pageEmpty = await device.poll();
      assert.deepEqual(pageEmpty.groups, []);
      assert.equal(pageEmpty.hasMore, false);
      assert.deepEqual(positions(pageEmpty.next).get(main), [5, 2]);

      // A new row past the position is read at its sequence, and the cursor stands at the head.
      const late = await insertMessage(userId, main, 6, {
        turnId: running,
        createdAt: new Date(NOW + 43_000),
      });
      const pageThree = await device.poll();
      assert.deepEqual(
        pageThree.groups.flatMap((group) => group.messages.map((message) => message.seq)),
        [6],
      );
      assert.equal(pageThree.hasMore, false);
      assert.deepEqual(positions(pageThree.next).get(main), [6, 2]);
      assert.deepEqual(device.ordered(), [...expected, [running, journal], [running, late]]);
      assert.deepEqual(
        device.groups
          .get(running)
          ?.messages.get(5)
          ?.tools.map((tool) => tool.state),
        ["output-available"],
      );

      // A device reading everything at once holds the same rows in the same order.
      const wide = new Device(userId, 200);
      await wide.catchUp();
      assert.deepEqual(wide.ordered(), device.ordered());
      assert.equal(wide.cursor, device.cursor);
    }),
);

it.effect(
  "a cleared main is absent from the next read: its groups leave the device, its position leaves the cursor, and the new main takes its place",
  () =>
    Effect.promise(async () => {
      const userId = await database.createUser();
      const { main, observed, turns: ids } = await populate(userId);
      const device = new Device(userId, 200);
      await device.catchUp();
      assert.equal(device.groups.has(ids.typed), true);

      const { opened } = await database.run(
        database.store.main.clear(userId, new Date(NOW + 60_000)),
      );
      const answer = await device.poll();
      assert.deepEqual(
        answer.conversations.map((conversation) => conversation.id).sort(),
        [opened, observed].sort(),
      );
      const mainEntry = answer.conversations.find((conversation) => conversation.id === opened);
      assert.equal(
        mainEntry?.kind === CONVERSATION_VIEW_SOURCE.MAIN && mainEntry.openedAt,
        NOW + 60_000,
      );
      // The device still holds the observed group it read before the Clear; the client's own rule drops rows older than the new main.
      assert.deepEqual([...device.groups.keys()], [ids.roster]);
      assert.deepEqual(
        parse(sequenceReadCursorSchema, answer.next)
          ?.positions.map((position) => [position.conversationId, position.seq])
          .sort(),
        [
          [opened, 0],
          [observed, 3],
        ].sort(),
      );
      assert.equal(
        parse(sequenceReadCursorSchema, answer.next)?.positions.some(
          (p) => p.conversationId === main,
        ),
        false,
      );

      const fresh = new Device(userId, 200);
      await fresh.catchUp();
      assert.deepEqual(fresh.ordered(), []);
      assert.deepEqual(
        parse(sequenceReadCursorSchema, fresh.cursor ?? "")
          ?.positions.map((position) => [position.conversationId, position.seq])
          .sort(),
        [
          [opened, 0],
          [observed, 3],
        ].sort(),
      );
    }),
);

it.effect(
  "a Clear empties the thread of observed rows from before the new main and keeps the ones after it, and the observed conversation itself stands untouched",
  () =>
    Effect.promise(async () => {
      const userId = await database.createUser();
      const { observed, turns: ids } = await populate(userId);
      await insertProviderCursor(database.run, {
        userId,
        providerId: SESSION.providerId,
        providerSessionId: SESSION.providerSessionId,
        cursor: "msg_0000000000000042",
      });
      const before = {
        conversation: await readConversationById(database.run, observed),
        messages: await readMessagesByConversation(database.run, observed),
        cursors: await readProviderCursorRows(userId),
      };
      assert.equal(before.messages.length, 3);

      const clearedAt = NOW + 60_000;
      const { opened } = await database.run(database.store.main.clear(userId, new Date(clearedAt)));
      const laterTurn = await insertTurn(userId, observed, {
        origin: TURN_ORIGIN.TRANSCRIPT_CHANGE,
        queuedAt: new Date(clearedAt + 10_000),
      });
      const laterAnnounce = await insertMessage(userId, observed, 4, {
        turnId: laterTurn,
        role: MESSAGE_ROLE.ASSISTANT,
        metadata: BRAIN_REPLY,
        createdAt: new Date(clearedAt + 12_000),
        parts: [
          toolPart("announce", "call_9a0000000000000001", { briefing: "The session finished." }),
        ],
      });

      const fresh = new Device(userId, 200);
      await fresh.catchUp();
      assert.deepEqual(fresh.ordered(), [[laterTurn, laterAnnounce]]);
      assert.equal(fresh.groups.has(ids.roster), false);
      const mainEntry = (await fresh.poll()).conversations.find((c) => c.id === opened);
      assert.equal(
        mainEntry?.kind === CONVERSATION_VIEW_SOURCE.MAIN && mainEntry.openedAt,
        clearedAt,
      );

      const heads = await database.run(
        handleChanges({
          request: new Request("https://luke.test/api/changes", {
            method: "POST",
            headers: { authorization: "Bearer token-1", "content-type": "application/json" },
            body: JSON.stringify({ deviceId: "7c9e6679-7425-40de-944b-e07fc1f90ae7" }),
          }),
          resolveUserId: () => Effect.succeedSome(userId),
          store: database.store,
          touchDevice: () => Effect.succeed(false),
        }),
      );
      const head = parse(
        changesAnswerSchema,
        // SAFETY: the response body is the route's own JSON; the schema read is the validation.
        (await heads.json()) as UnparsedWireValue,
      );
      assert.equal(head?.messages, fresh.cursor);

      const after = {
        conversation: await readConversationById(database.run, observed),
        messages: await readMessagesByConversation(database.run, observed),
        cursors: await readProviderCursorRows(userId),
      };
      assert.equal(after.conversation[0]?.deletedAt, null);
      assert.deepEqual(after.cursors, before.cursors);
      assert.deepEqual(
        after.messages.filter((row) => Number(row.seq) <= 3),
        before.messages,
      );
      assert.equal(after.messages.length, 4);
      assert.equal(
        EffectSchema.decodeUnknownSync(EpochMillisColumnSchema)(
          after.conversation[0]?.nextMessageSeq,
        ),
        5,
      );
      const whole = await database.run(
        database.store.messages.list(userId, observed, CATALOG_TOOL_SET),
      );
      assert.equal(whole.ok, true);
      assert.deepEqual(whole.ok ? whole.value.map((record) => record.seq) : [], [1, 2, 3, 4]);
    }),
);

it.effect(
  "a message carries its latest rating on a device's first page, a re-rating changes the next page, a withdrawal leaves it unrated, and the events record keeps every rating as its own row",
  () =>
    Effect.promise(async () => {
      const userId = await database.createUser();
      const { main, turns: ids } = await populate(userId);
      const MessageIdRowSchema = EffectSchema.Struct({
        id: EffectSchema.String,
        seq: EpochMillisColumnSchema,
      });
      const sent = (await readMessagesByConversation(database.run, main))
        .map((row) => EffectSchema.decodeUnknownSync(MessageIdRowSchema)(row))
        .find((row) => row.seq === 2);
      assert.ok(sent);
      const first = await insertEvent(userId, main, sent.id, 1, {
        kind: CONVERSATION_EVENT_KIND.RATING,
        deviceId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        payload: { rating: MESSAGE_RATING.UP },
      });

      const fresh = new Device(userId, 200);
      await fresh.catchUp();
      const before = fresh.groups.get(ids.typed)?.messages.get(2);
      assert.deepEqual(before?.rating, { rating: MESSAGE_RATING.UP });
      assert.equal(fresh.groups.get(ids.typed)?.messages.get(1)?.rating, undefined);
      assert.equal(fresh.groups.get(ids.roster)?.messages.get(2)?.rating, undefined);

      const second = await insertEvent(userId, main, sent.id, 2, {
        kind: CONVERSATION_EVENT_KIND.RATING,
        deviceId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        payload: { rating: MESSAGE_RATING.DOWN, note: "Sent the wrong session." },
      });
      const rerated = new Device(userId, 200);
      await rerated.catchUp();
      assert.deepEqual(rerated.groups.get(ids.typed)?.messages.get(2)?.rating, {
        rating: MESSAGE_RATING.DOWN,
        note: "Sent the wrong session.",
      });

      // The developer takes the verdict back: the next page folds no rating onto the message, and the older verdicts do not stand in for it.
      const third = await insertEvent(userId, main, sent.id, 3, {
        kind: CONVERSATION_EVENT_KIND.RATING,
        deviceId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        payload: { rating: RATING_WORD.WITHDRAWN },
      });
      const unrated = new Device(userId, 200);
      await unrated.catchUp();
      assert.equal(unrated.groups.get(ids.typed)?.messages.get(2)?.rating, undefined);

      const EventRowSchema = EffectSchema.Struct({
        id: EffectSchema.String,
        seq: EpochMillisColumnSchema,
        kind: EffectSchema.String,
        payload: EffectSchema.Unknown,
      });
      const record = (await readEventsByMessage(database.run, sent.id))
        .map((row) => EffectSchema.decodeUnknownSync(EventRowSchema)(row))
        .filter((row) => row.kind === CONVERSATION_EVENT_KIND.RATING);
      assert.deepEqual(
        record.map((row) => [row.id, row.seq, row.payload]),
        [
          [first, 1, { rating: MESSAGE_RATING.UP }],
          [second, 2, { rating: MESSAGE_RATING.DOWN, note: "Sent the wrong session." }],
          [third, 3, { rating: RATING_WORD.WITHDRAWN }],
        ],
      );
      const listed = await database.run(database.store.events.list(userId, main));
      assert.deepEqual(
        listed.map((event) => [event.id, event.kind]),
        [
          [first, CONVERSATION_EVENT_KIND.RATING],
          [second, CONVERSATION_EVENT_KIND.RATING],
          [third, CONVERSATION_EVENT_KIND.RATING],
        ],
      );
    }),
);

it.effect(
  "a row naming a tool the catalog has retired is answered without that part, and a row whose input the catalog refuses refuses the page whole, naming the row",
  () =>
    Effect.promise(async () => {
      const userId = await database.createUser();
      const { main } = await populate(userId);
      const device = new Device(userId, 200);
      await device.catchUp();
      // Where the device stood before either row: the second read asks from here too, since the first advances the cursor.
      const before = device.cursor ?? "";

      await insertMessage(userId, main, 5, {
        role: MESSAGE_ROLE.ASSISTANT,
        metadata: BRAIN_REPLY,
        parts: [
          toolPart("nobody_registered", "call_6a0000000000000001", {}),
          { type: "text", text: "Done.", state: "done" },
        ],
      });
      const retired = await device.poll();
      const answered = retired.groups
        .flatMap((group) => group.messages)
        .find((message) => message.seq === 5);
      assert.deepEqual(answered?.message.parts, [{ type: "text", text: "Done.", state: "done" }]);
      assert.deepEqual(answered?.tools, []);

      // Scoped to this test's conversation: on CI every store suite shares one database, and an unscoped delete of seq 5 took a neighbour's row twice today.
      await database.run(
        Effect.asVoid(
          db.delete(messages).where(and(eq(messages.conversationId, main), eq(messages.seq, 5))),
        ),
      );
      await insertMessage(userId, main, 5, {
        role: MESSAGE_ROLE.ASSISTANT,
        metadata: BRAIN_REPLY,
        parts: [toolPart("announce", "call_6a0000000000000002", { briefing: 42 })],
      });
      const refusedInput = await database.run(
        handleConversationMessages(options(userId, request(READ_PATH.MESSAGES, { after: before }))),
      );
      assert.equal(refusedInput.status, 500);
      assert.equal((await refusedInput.json()).unreadableRow.seq, 5);
    }),
);

it.effect("events page behind a cursor of their own and two devices converge on them", () =>
  Effect.promise(async () => {
    const userId = await database.createUser();
    const { main, observed, messages: ids } = await populate(userId);
    await insertEvent(userId, observed, ids.look, 3, {
      kind: CONVERSATION_EVENT_KIND.RATING,
      deviceId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      payload: { rating: "down" },
    });

    const wide = await answered(
      await database.run(handleConversationEvents(options(userId, request(READ_PATH.EVENTS)))),
      conversationEventsAnswerSchema,
    );
    assert.deepEqual(
      wide.events.map((event) => [event.conversationId, event.seq, event.kind]),
      [
        [observed, 1, CONVERSATION_EVENT_KIND.SPEECH_OFFERED],
        [observed, 2, CONVERSATION_EVENT_KIND.SPEECH_EXPIRED],
        [observed, 3, CONVERSATION_EVENT_KIND.RATING],
      ],
    );
    assert.deepEqual(wide.events[2]?.payload, { rating: "down" });
    assert.equal(wide.hasMore, false);

    const narrow: ConversationEventsAnswer["events"][number][] = [];
    let cursor: string | undefined;
    for (let polls = 0; polls < 10; polls += 1) {
      const query: ReadQuery = { limit: 1 };
      if (cursor !== undefined) query.after = cursor;
      const page = await answered(
        await database.run(
          handleConversationEvents(options(userId, request(READ_PATH.EVENTS, query))),
        ),
        conversationEventsAnswerSchema,
      );
      narrow.push(...page.events);
      cursor = page.next;
      if (!page.hasMore) break;
    }
    assert.deepEqual(
      narrow.map((event) => event.id),
      wide.events.map((event) => event.id),
    );
    assert.equal(cursor, wide.next);
    assert.deepEqual(
      parse(sequenceReadCursorSchema, wide.next)
        ?.positions.map((position) => [position.conversationId, position.seq])
        .sort(),
      [
        [main, 0],
        [observed, 3],
      ].sort(),
    );
  }),
);

it.effect(
  "turns are answered in the order they last changed, again when a stamp moves, behind the cursor the store minted",
  () =>
    Effect.promise(async () => {
      const userId = await database.createUser();
      const { turns: ids, main } = await populate(userId);

      const all = await answered(
        await database.run(handleBrainTurns(options(userId, request(READ_PATH.TURNS)))),
        brainTurnsAnswerSchema,
      );
      assert.deepEqual(
        all.turns.map((turn) => turn.id),
        [ids.typed, ids.roster, ids.later, ids.idle],
      );
      assert.equal(all.turns[0]?.conversationId, main);
      assert.equal(all.hasMore, false);
      assert.equal(all.next, all.turns[3]?.cursor);

      const settledAt = new Date(NOW + 90_000);
      await database.run(
        Effect.asVoid(
          db
            .update(turns)
            .set({ status: TURN_STATUS.SETTLED, settledAt, model: "gpt-5" })
            .where(eq(turns.id, ids.typed)),
        ),
      );
      const changed = await answered(
        await database.run(
          handleBrainTurns(options(userId, request(READ_PATH.TURNS, { after: all.next ?? "" }))),
        ),
        brainTurnsAnswerSchema,
      );
      assert.deepEqual(
        changed.turns.map((turn) => [turn.id, turn.status, turn.model, turn.settledAt]),
        [[ids.typed, TURN_STATUS.SETTLED, "gpt-5", settledAt.getTime()]],
      );
      assert.equal(changed.hasMore, false);
      assert.equal(parse(turnReadCursorSchema, changed.next ?? "")?.id, ids.typed);

      const paged: BrainTurnsAnswer = await answered(
        await database.run(
          handleBrainTurns(options(userId, request(READ_PATH.TURNS, { limit: 2 }))),
        ),
        brainTurnsAnswerSchema,
      );
      assert.equal(paged.turns.length, 2);
      assert.equal(paged.hasMore, true);
      const rest = await answered(
        await database.run(
          handleBrainTurns(
            options(userId, request(READ_PATH.TURNS, { after: paged.next ?? "", limit: 2 })),
          ),
        ),
        brainTurnsAnswerSchema,
      );
      assert.deepEqual(
        [...paged.turns, ...rest.turns].map((turn) => turn.id),
        [ids.roster, ids.later, ids.idle, ids.typed],
      );
      assert.equal(rest.hasMore, true);

      const quiet = await answered(
        await database.run(
          handleBrainTurns(options(userId, request(READ_PATH.TURNS, { after: rest.next ?? "" }))),
        ),
        brainTurnsAnswerSchema,
      );
      assert.deepEqual(quiet.turns, []);
      assert.equal(quiet.next, rest.next);
      assert.equal(quiet.hasMore, false);
    }),
);

it.effect(
  "the latest turn position stops at a given cursor, so an empty page never moves past a turn unread",
  () =>
    Effect.promise(async () => {
      const userId = await database.createUser();
      const { main, turns: ids } = await populate(userId);
      const extra = await insertTurn(userId, main, { queuedAt: new Date(NOW + 15_000) });
      const all = await database.run(database.store.turns.list(userId));
      assert.deepEqual(
        all.map((turn) => turn.id),
        [ids.typed, ids.roster, extra, ids.later, ids.idle],
      );
      const [, roster, gone, later, idle] = all;
      assert.ok(roster && gone && later && idle);
      assert.deepEqual(await database.run(database.store.turns.latest(userId)), idle.cursor);
      assert.deepEqual(
        await database.run(database.store.turns.latest(userId, gone.cursor)),
        gone.cursor,
      );
      await database.run(Effect.asVoid(db.delete(turns).where(eq(turns.id, extra))));
      assert.deepEqual(
        await database.run(database.store.turns.latest(userId, gone.cursor)),
        roster.cursor,
      );
      assert.deepEqual(
        await database.run(database.store.turns.latest(userId, later.cursor)),
        later.cursor,
      );
    }),
);

it.effect(
  "a queued turn is the opener's inbox and not the record: the turns read and its head skip it until the relay moves it to running",
  () =>
    Effect.promise(async () => {
      const userId = await database.createUser();
      const { main, turns: ids } = await populate(userId);
      const queued = await insertTurn(userId, main, {
        status: TURN_STATUS.QUEUED,
        queuedAt: new Date(NOW + 60_000),
      });
      const listed = await database.run(database.store.turns.list(userId));
      assert.deepEqual(
        listed.map((turn) => turn.id),
        [ids.typed, ids.roster, ids.later, ids.idle],
      );
      const head = listed.at(-1);
      assert.ok(head);
      assert.deepEqual(await database.run(database.store.turns.latest(userId)), head.cursor);

      await database.run(
        Effect.asVoid(
          db
            .update(turns)
            .set({ status: TURN_STATUS.RUNNING, startedAt: new Date(NOW + 61_000) })
            .where(eq(turns.id, queued)),
        ),
      );
      const started = await database.run(database.store.turns.list(userId, { after: head.cursor }));
      assert.deepEqual(
        started.map((turn) => [turn.id, turn.status]),
        [[queued, TURN_STATUS.RUNNING]],
      );
      assert.deepEqual(await database.run(database.store.turns.latest(userId)), started[0]?.cursor);
    }),
);

it.effect(
  "a turns cursor naming a turn a Clear took moves back to the last turn at or before it, and to nothing when no turn stands",
  () =>
    Effect.promise(async () => {
      const userId = await database.createUser();
      const { turns: ids, observed } = await populate(userId);
      await database.run(
        Effect.asVoid(
          db
            .update(turns)
            .set({ settledAt: new Date(NOW + 90_000) })
            .where(eq(turns.id, ids.typed)),
        ),
      );
      const all = await answered(
        await database.run(handleBrainTurns(options(userId, request(READ_PATH.TURNS)))),
        brainTurnsAnswerSchema,
      );
      assert.equal(all.turns.at(-1)?.id, ids.typed);
      const stale = all.next ?? "";

      await database.run(database.store.main.clear(userId, new Date(NOW + 100_000)));
      const moved = await answered(
        await database.run(
          handleBrainTurns(options(userId, request(READ_PATH.TURNS, { after: stale }))),
        ),
        brainTurnsAnswerSchema,
      );
      assert.deepEqual(moved.turns, []);
      assert.equal(moved.hasMore, false);
      assert.equal(parse(turnReadCursorSchema, moved.next ?? "")?.id, ids.idle);
      const head = await database.run(database.store.turns.latest(userId));
      assert.deepEqual(parse(turnReadCursorSchema, moved.next ?? ""), head);
      const settled = await answered(
        await database.run(
          handleBrainTurns(options(userId, request(READ_PATH.TURNS, { after: moved.next ?? "" }))),
        ),
        brainTurnsAnswerSchema,
      );
      assert.deepEqual(settled.turns, []);
      assert.equal(settled.next, moved.next);

      await database.run(
        Effect.asVoid(db.delete(conversations).where(eq(conversations.id, observed))),
      );
      const none = await answered(
        await database.run(
          handleBrainTurns(options(userId, request(READ_PATH.TURNS, { after: moved.next ?? "" }))),
        ),
        brainTurnsAnswerSchema,
      );
      assert.deepEqual(none.turns, []);
      assert.equal(none.next, undefined);
      assert.equal(none.hasMore, false);
    }),
);
