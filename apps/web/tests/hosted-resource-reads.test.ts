import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  type BrainTurnsAnswer,
  brainTurnsAnswerSchema,
  type ConversationEventsAnswer,
  type ConversationMessagesAnswer,
  type ConversationReadMessage,
  conversationEventsAnswerSchema,
  conversationMessagesAnswerSchema,
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
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  OBSERVATION_SOURCE,
  type Schema,
  TURN_ORIGIN,
  TURN_STATUS,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { eq, sql } from "drizzle-orm";
import { CONVERSATION_KIND, conversations, events, messages, turns } from "../server/db/schema";
import {
  handleBrainTurns,
  handleConversationEvents,
  handleConversationMessages,
  type ResourceReadOptions,
} from "../server/hosted/resource-reads";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * The three reads over the real store and migrations: two devices paging at
 * different bounds converge on the same messages in the same order under the
 * same cursor, a Clear leaves the next read and the cursor at once, a row the
 * catalog cannot read refuses the page naming the row, and the events and
 * turns page behind cursors of their own.
 */

const database = await openHostedStoreTestDatabase();
after(() => database.close());

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
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
const ROSTER_LOOK = {
  author: MESSAGE_AUTHOR.BRAIN,
  source: OBSERVATION_SOURCE.ROSTER_LOOK,
} as const;

type MessageParts = (typeof messages.$inferInsert)["parts"];

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

async function insertConversation(
  userId: string,
  row: Partial<typeof conversations.$inferInsert> = {},
): Promise<string> {
  const [inserted] = await database.db
    .insert(conversations)
    .values({ userId, kind: CONVERSATION_KIND.MAIN, ...row })
    .returning({ id: conversations.id });
  assert.ok(inserted);
  return inserted.id;
}

async function insertTurn(
  userId: string,
  conversationId: string,
  row: Partial<typeof turns.$inferInsert> = {},
): Promise<string> {
  const [inserted] = await database.db
    .insert(turns)
    .values({
      userId,
      conversationId,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.SETTLED,
      queuedAt: new Date(NOW),
      ...row,
    })
    .returning({ id: turns.id });
  assert.ok(inserted);
  return inserted.id;
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
  row: Partial<typeof messages.$inferInsert> = {},
): Promise<string> {
  const [inserted] = await database.db
    .insert(messages)
    .values({
      userId,
      conversationId,
      seq,
      clientId: `client-${seq}`,
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: `ask ${seq}` }],
      metadata: TYPED_ASK,
      createdAt: new Date(NOW + seq * 1000),
      finishedAt: new Date(NOW + seq * 1000 + 500),
      ...row,
    })
    .returning({ id: messages.id });
  assert.ok(inserted);
  await database.db
    .update(conversations)
    .set({ nextMessageSeq: sql`greatest(${conversations.nextMessageSeq}, ${seq + 1})` })
    .where(eq(conversations.id, conversationId));
  return inserted.id;
}

async function insertEvent(
  userId: string,
  conversationId: string,
  messageId: string,
  seq: number,
  row: Partial<typeof events.$inferInsert> = {},
): Promise<string> {
  const [inserted] = await database.db
    .insert(events)
    .values({
      userId,
      conversationId,
      messageId,
      seq,
      kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      createdAt: new Date(NOW + seq * 1000),
      ...row,
    })
    .returning({ id: events.id });
  assert.ok(inserted);
  await database.db
    .update(conversations)
    .set({ nextEventSeq: sql`greatest(${conversations.nextEventSeq}, ${seq + 1})` })
    .where(eq(conversations.id, conversationId));
  return inserted.id;
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
  return { request: req, resolveUserId: async () => userId, store: database.store, now: () => NOW };
}

async function answered<Value>(response: Response, schema: Schema<Value>): Promise<Value> {
  assert.equal(response.status, 200);
  // SAFETY: the response body is the route's own JSON; the schema read is the validation.
  const body = (await response.json()) as UnparsedWireValue;
  const read = schema.read(body);
  if (!read.ok) assert.fail(`${read.refusal} at ${read.path.join(".")}`);
  return read.value;
}

/**
 * A device's own picture of the Conversation, kept the way a client keeps
 * it: groups merged by turn, messages kept by sequence, conversations an
 * answer no longer lists dropped, and the whole ordered as the view orders
 * it — earliest message, then the turn's queue instant, then the id.
 */
interface ClientGroup {
  conversationId: string;
  source: ConversationViewSource;
  turn: ConversationViewTurn | undefined;
  messages: Map<number, ConversationReadMessage>;
}

class Device {
  readonly groups = new Map<string, ClientGroup>();
  cursor: string | undefined;

  constructor(
    private readonly userId: string,
    private readonly limit: number,
  ) {}

  async poll(): Promise<ConversationMessagesAnswer> {
    const query: ReadQuery = { limit: this.limit };
    if (this.cursor !== undefined) query.after = this.cursor;
    const answer = await answered(
      await handleConversationMessages(options(this.userId, request(READ_PATH.MESSAGES, query))),
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
      for (const message of group.messages) held.messages.set(message.seq, message);
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
        instant: Math.min(...messages.map((message) => message.createdAt)),
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
    origin: TURN_ORIGIN.ROSTER_DIFF,
    queuedAt: new Date(NOW + 10_000),
  });
  const later = await insertTurn(userId, main, { queuedAt: new Date(NOW + 20_000) });
  const idle = await insertTurn(userId, observed, {
    origin: TURN_ORIGIN.ROSTER_DIFF,
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
    metadata: ROSTER_LOOK,
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

test("the gate order is method, bearer, and query, and every refusal is one shape", async () => {
  const userId = await database.createUser();
  for (const [path, handle] of [
    [READ_PATH.MESSAGES, handleConversationMessages],
    [READ_PATH.EVENTS, handleConversationEvents],
    [READ_PATH.TURNS, handleBrainTurns],
  ] as const) {
    const wrongMethod = await handle(options(userId, request(path, {}, "POST")));
    assert.equal(wrongMethod.status, 405);
    assert.equal((await wrongMethod.json()).error, HOSTED_API_ERROR.METHOD_NOT_ALLOWED);

    const anonymous = await handle({
      ...options(userId, request(path, {}, "GET", false)),
      resolveUserId: async () => undefined,
    });
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);

    const refusals: ReadQuery[] = [
      { after: "%%%" },
      { limit: 0 },
      { limit: 201 },
      { limit: "two" },
    ];
    for (const query of refusals) {
      const refused = await handle(options(userId, request(path, query)));
      assert.equal(refused.status, 400, JSON.stringify(query));
      assert.equal((await refused.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
    }
  }
});

test("two devices paging at different bounds converge on the same messages in the same order under the same cursor", async () => {
  const userId = await database.createUser();
  const { main, observed, turns: ids, expected } = await populate(userId);

  const narrow = new Device(userId, 2);
  const wide = new Device(userId, 200);
  await narrow.catchUp();
  await wide.catchUp();

  assert.deepEqual(narrow.ordered(), expected);
  assert.deepEqual(wide.ordered(), expected);
  assert.equal(narrow.cursor, wide.cursor);
  assert.deepEqual(sequenceReadCursorSchema.parse(wide.cursor ?? ""), {
    positions: [
      { conversationId: main, seq: 4 },
      { conversationId: observed, seq: 3 },
    ].sort((a, b) => (a.conversationId < b.conversationId ? -1 : 1)),
  });

  const announced = wide.groups.get(ids.roster);
  assert.ok(announced);
  assert.equal(announced.source.kind, CONVERSATION_VIEW_SOURCE.OBSERVED);
  assert.deepEqual(
    announced.source.kind === CONVERSATION_VIEW_SOURCE.OBSERVED && announced.source.session,
    SESSION,
  );
  assert.equal(announced.turn?.origin, TURN_ORIGIN.ROSTER_DIFF);
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
  assert.equal(announce?.kind === CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE && announce.unspoken, true);
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
});

test("a message still in flight is answered on every read and passed only once it finishes", async () => {
  const userId = await database.createUser();
  const { main, expected } = await populate(userId);
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
    sequenceReadCursorSchema.parse(cursor ?? "")?.positions.find((p) => p.conversationId === main)
      ?.seq;

  const device = new Device(userId, 200);
  await device.catchUp();
  assert.deepEqual(device.ordered(), [...expected, [running, ask], [running, journal]]);
  assert.equal(mainPosition(device.cursor), 5);
  const inFlight = device.groups.get(running)?.messages.get(6);
  assert.deepEqual(
    inFlight?.tools.map((tool) => tool.state),
    ["input-available"],
  );

  const again = await device.poll();
  assert.deepEqual(
    again.groups.flatMap((group) => group.messages.map((message) => message.seq)),
    [6],
  );
  assert.equal(again.hasMore, false);
  assert.equal(mainPosition(again.next), 5);

  await database.db
    .update(messages)
    .set({
      parts: [
        toolPart("send_session_message", "call_7a0000000000000001", {
          ...SESSION_FIELDS,
          text: "Run the tests.",
        }),
        { type: "text", text: "Sent." },
      ],
      finishedAt: new Date(NOW + 45_000),
    })
    .where(eq(messages.id, journal));
  const finished = await device.poll();
  assert.deepEqual(
    finished.groups.flatMap((group) => group.messages.map((message) => message.seq)),
    [6],
  );
  assert.equal(mainPosition(finished.next), 6);
  assert.deepEqual(
    device.groups
      .get(running)
      ?.messages.get(6)
      ?.tools.map((tool) => tool.state),
    ["output-available"],
  );
  const quiet = await device.poll();
  assert.deepEqual(quiet.groups, []);
  assert.equal(quiet.hasMore, false);
});

test("a conversation longer than one page is read to its end on the default bound", async () => {
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
});

test("an open journal at the front of the page does not hold the other conversations' rows behind it", async () => {
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

  const narrowest = new Device(userId, 1);
  const firstPage = await narrowest.poll();
  assert.ok(
    firstPage.groups.flatMap((group) => group.messages).length <=
      1 + READ_PAGE_BOUNDS.PREVIEW_ROWS * firstPage.conversations.length,
  );
  await narrowest.catchUp();
  assert.deepEqual(narrowest.ordered(), [...expected, [running, journal]]);
  const positions = sequenceReadCursorSchema.parse(narrowest.cursor ?? "")?.positions ?? [];
  assert.deepEqual(
    new Map(positions.map((position) => [position.conversationId, position.seq])),
    new Map([
      [main, 4],
      [observed, 3],
    ]),
  );
});

test("a cleared main is absent from the next read: its groups leave the device, its position leaves the cursor, and the new main takes its place", async () => {
  const userId = await database.createUser();
  const { main, observed, turns: ids } = await populate(userId);
  const device = new Device(userId, 200);
  await device.catchUp();
  assert.equal(device.groups.has(ids.typed), true);

  const { opened } = await database.store.main.clear(userId, new Date(NOW + 60_000));
  const answer = await device.poll();
  assert.deepEqual(
    answer.conversations.map((conversation) => conversation.id).sort(),
    [opened, observed].sort(),
  );
  assert.deepEqual([...device.groups.keys()], [ids.roster]);
  assert.deepEqual(
    sequenceReadCursorSchema
      .parse(answer.next)
      ?.positions.map((position) => [position.conversationId, position.seq])
      .sort(),
    [
      [opened, 0],
      [observed, 3],
    ].sort(),
  );
  assert.equal(
    sequenceReadCursorSchema.parse(answer.next)?.positions.some((p) => p.conversationId === main),
    false,
  );

  const fresh = new Device(userId, 200);
  await fresh.catchUp();
  assert.deepEqual(
    fresh.ordered().map(([turnId]) => turnId),
    [ids.roster],
  );
});

test("a row the catalog cannot read refuses the page whole, naming the row, whether the tool is unregistered or its input refused", async () => {
  const userId = await database.createUser();
  const { main } = await populate(userId);
  const device = new Device(userId, 200);
  await device.catchUp();

  await insertMessage(userId, main, 5, {
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: BRAIN_REPLY,
    parts: [toolPart("nobody_registered", "call_6a0000000000000001", {})],
  });
  const unregistered = await handleConversationMessages(
    options(userId, request(READ_PATH.MESSAGES, { after: device.cursor ?? "" })),
  );
  assert.equal(unregistered.status, 500);
  assert.deepEqual(await unregistered.json(), {
    error: HOSTED_API_ERROR.UNREADABLE_ROW,
    unreadableRow: { conversationId: main, seq: 5 },
  });

  await database.db.delete(messages).where(eq(messages.seq, 5));
  await insertMessage(userId, main, 5, {
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: BRAIN_REPLY,
    parts: [toolPart("announce", "call_6a0000000000000002", { briefing: 42 })],
  });
  const refusedInput = await handleConversationMessages(
    options(userId, request(READ_PATH.MESSAGES, { after: device.cursor ?? "" })),
  );
  assert.equal(refusedInput.status, 500);
  assert.equal((await refusedInput.json()).unreadableRow.seq, 5);
});

test("events page behind a cursor of their own and two devices converge on them", async () => {
  const userId = await database.createUser();
  const { main, observed, messages: ids } = await populate(userId);
  await insertEvent(userId, observed, ids.look, 3, {
    kind: CONVERSATION_EVENT_KIND.RATING,
    deviceId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    payload: { rating: "down" },
  });

  const wide = await answered(
    await handleConversationEvents(options(userId, request(READ_PATH.EVENTS))),
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
      await handleConversationEvents(options(userId, request(READ_PATH.EVENTS, query))),
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
    sequenceReadCursorSchema
      .parse(wide.next)
      ?.positions.map((position) => [position.conversationId, position.seq])
      .sort(),
    [
      [main, 0],
      [observed, 3],
    ].sort(),
  );
});

test("turns are answered in the order they last changed, again when a stamp moves, behind the cursor the store minted", async () => {
  const userId = await database.createUser();
  const { turns: ids, main } = await populate(userId);

  const all = await answered(
    await handleBrainTurns(options(userId, request(READ_PATH.TURNS))),
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
  await database.db
    .update(turns)
    .set({ status: TURN_STATUS.SETTLED, settledAt, model: "gpt-5" })
    .where(eq(turns.id, ids.typed));
  const changed = await answered(
    await handleBrainTurns(options(userId, request(READ_PATH.TURNS, { after: all.next ?? "" }))),
    brainTurnsAnswerSchema,
  );
  assert.deepEqual(
    changed.turns.map((turn) => [turn.id, turn.status, turn.model, turn.settledAt]),
    [[ids.typed, TURN_STATUS.SETTLED, "gpt-5", settledAt.getTime()]],
  );
  assert.equal(changed.hasMore, false);
  assert.equal(turnReadCursorSchema.parse(changed.next ?? "")?.id, ids.typed);

  const paged: BrainTurnsAnswer = await answered(
    await handleBrainTurns(options(userId, request(READ_PATH.TURNS, { limit: 2 }))),
    brainTurnsAnswerSchema,
  );
  assert.equal(paged.turns.length, 2);
  assert.equal(paged.hasMore, true);
  const rest = await answered(
    await handleBrainTurns(
      options(userId, request(READ_PATH.TURNS, { after: paged.next ?? "", limit: 2 })),
    ),
    brainTurnsAnswerSchema,
  );
  assert.deepEqual(
    [...paged.turns, ...rest.turns].map((turn) => turn.id),
    [ids.roster, ids.later, ids.idle, ids.typed],
  );
  assert.equal(rest.hasMore, true);

  const quiet = await answered(
    await handleBrainTurns(options(userId, request(READ_PATH.TURNS, { after: rest.next ?? "" }))),
    brainTurnsAnswerSchema,
  );
  assert.deepEqual(quiet.turns, []);
  assert.equal(quiet.next, rest.next);
  assert.equal(quiet.hasMore, false);
});

test("the latest turn position stops at a given cursor, so an empty page never moves past a turn unread", async () => {
  const userId = await database.createUser();
  const { main, turns: ids } = await populate(userId);
  const extra = await insertTurn(userId, main, { queuedAt: new Date(NOW + 15_000) });
  const all = await database.store.turns.list(userId);
  assert.deepEqual(
    all.map((turn) => turn.id),
    [ids.typed, ids.roster, extra, ids.later, ids.idle],
  );
  const [, roster, gone, later, idle] = all;
  assert.ok(roster && gone && later && idle);
  assert.deepEqual(await database.store.turns.latest(userId), idle.cursor);
  assert.deepEqual(await database.store.turns.latest(userId, gone.cursor), gone.cursor);
  await database.db.delete(turns).where(eq(turns.id, extra));
  assert.deepEqual(await database.store.turns.latest(userId, gone.cursor), roster.cursor);
  assert.deepEqual(await database.store.turns.latest(userId, later.cursor), later.cursor);
});

test("a turns cursor naming a turn a Clear took moves back to the last turn at or before it, and to nothing when no turn stands", async () => {
  const userId = await database.createUser();
  const { turns: ids, observed } = await populate(userId);
  await database.db
    .update(turns)
    .set({ settledAt: new Date(NOW + 90_000) })
    .where(eq(turns.id, ids.typed));
  const all = await answered(
    await handleBrainTurns(options(userId, request(READ_PATH.TURNS))),
    brainTurnsAnswerSchema,
  );
  assert.equal(all.turns.at(-1)?.id, ids.typed);
  const stale = all.next ?? "";

  await database.store.main.clear(userId, new Date(NOW + 100_000));
  const moved = await answered(
    await handleBrainTurns(options(userId, request(READ_PATH.TURNS, { after: stale }))),
    brainTurnsAnswerSchema,
  );
  assert.deepEqual(moved.turns, []);
  assert.equal(moved.hasMore, false);
  assert.equal(turnReadCursorSchema.parse(moved.next ?? "")?.id, ids.idle);
  const head = await database.store.turns.latest(userId);
  assert.deepEqual(turnReadCursorSchema.parse(moved.next ?? ""), head);
  const settled = await answered(
    await handleBrainTurns(options(userId, request(READ_PATH.TURNS, { after: moved.next ?? "" }))),
    brainTurnsAnswerSchema,
  );
  assert.deepEqual(settled.turns, []);
  assert.equal(settled.next, moved.next);

  await database.db.delete(conversations).where(eq(conversations.id, observed));
  const none = await answered(
    await handleBrainTurns(options(userId, request(READ_PATH.TURNS, { after: moved.next ?? "" }))),
    brainTurnsAnswerSchema,
  );
  assert.deepEqual(none.turns, []);
  assert.equal(none.next, undefined);
  assert.equal(none.hasMore, false);
});
