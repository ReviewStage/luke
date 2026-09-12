import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONVERSATION_VIEW_ACTION_OUTCOME,
  CONVERSATION_VIEW_SOURCE,
  CONVERSATION_VIEW_TOOL_KIND,
} from "@sidecar/session";
import {
  CONVERSATION_EVENT_KIND,
  isRecord,
  MESSAGE_RATING,
  SCHEMA_REFUSAL,
  TURN_ORIGIN,
  TURN_STATUS,
  type UnparsedWireValue,
  type WireValue,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { type Schema as EffectSchema, Either } from "effect";
import { test } from "vitest";
import {
  brainTurnsAnswerSchema,
  changesAnswerSchema,
  changesRequestSchema,
  conversationEventsAnswerSchema,
  conversationMessagesAnswerSchema,
  encodeSequenceReadCursor,
  encodeTurnReadCursor,
  READ_CURSOR_BOUNDS,
  READ_PAGE_BOUNDS,
  readLimitSchema,
  sequenceReadCursorSchema,
  turnReadCursorSchema,
  unreadableRowRefusalSchema,
} from "./reads-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

const FIXTURE_DIRECTORY = path.join(fileURLToPath(import.meta.url), "../../fixtures/reads");

const FIXTURE = {
  MESSAGES: "conversation-messages-answer.json",
  EVENTS: "conversation-events-answer.json",
  TURNS: "brain-turns-answer.json",
  CHANGES_REQUEST: "changes-request.json",
  CHANGES_ANSWER: "changes-answer.json",
} as const;

const MAIN = "3c000000-0000-4000-8000-000000000001";
const OBSERVED = "3c000000-0000-4000-8000-000000000002";
const TURN = "1a000000-0000-4000-8000-000000000003";
const DEVICE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

async function fixture(name: (typeof FIXTURE)[keyof typeof FIXTURE]): Promise<UnparsedWireValue> {
  // SAFETY: the fixture files are JSON this repository commits; the schema under test is the validation.
  return JSON.parse(
    await readFile(path.join(FIXTURE_DIRECTORY, name), "utf8"),
  ) as UnparsedWireValue;
}

function expectRead<Value, Encoded>(
  schema: EffectSchema.Schema<Value, Encoded>,
  value: UnparsedWireValue,
): Value {
  const read = readEither(schema)(value);
  if (Either.isLeft(read)) assert.fail(`${read.left.refusal} at ${read.left.path.join(".")}`);
  return read.right;
}

function parse<Value, Encoded>(
  schema: EffectSchema.Schema<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Either.getOrUndefined(readEither(schema)(value));
}

test("a sequence cursor round-trips in one canonical string whatever order its positions arrived in", () => {
  const forward = encodeSequenceReadCursor([
    { conversationId: MAIN, seq: 2 },
    { conversationId: OBSERVED, seq: 32 },
  ]);
  const backward = encodeSequenceReadCursor([
    { conversationId: OBSERVED, seq: 32 },
    { conversationId: MAIN, seq: 2 },
  ]);
  assert.equal(forward, backward);
  assert.deepEqual(parse(sequenceReadCursorSchema, forward), {
    positions: [
      { conversationId: MAIN, seq: 2 },
      { conversationId: OBSERVED, seq: 32 },
    ],
  });
  assert.deepEqual(parse(sequenceReadCursorSchema, encodeSequenceReadCursor([])), {
    positions: [],
  });
});

test("a sequence cursor this build did not mint the shape of is refused, naming why", () => {
  const encode = (value: WireValue) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const refusalOf = (value: UnparsedWireValue) =>
    Either.match(readEither(sequenceReadCursorSchema)(value), {
      onLeft: (refused) => refused.refusal,
      onRight: () => undefined,
    });
  assert.equal(refusalOf(undefined), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf("not base64url!"), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(
    refusalOf(Buffer.from("{oops", "utf8").toString("base64url")),
    SCHEMA_REFUSAL.MALFORMED,
  );
  assert.equal(
    refusalOf(encode({ positions: [{ conversationId: "main", seq: 1 }] })),
    SCHEMA_REFUSAL.MALFORMED,
  );
  assert.equal(
    refusalOf(encode({ positions: [{ conversationId: MAIN, seq: -1 }] })),
    SCHEMA_REFUSAL.MALFORMED,
  );
  assert.equal(
    refusalOf(
      encode({
        positions: [
          { conversationId: OBSERVED, seq: 1 },
          { conversationId: MAIN, seq: 1 },
        ],
      }),
    ),
    SCHEMA_REFUSAL.MALFORMED,
  );
  assert.equal(
    refusalOf(
      encode({
        positions: [
          { conversationId: MAIN, seq: 1 },
          { conversationId: MAIN, seq: 2 },
        ],
      }),
    ),
    SCHEMA_REFUSAL.MALFORMED,
  );
  const crowded = Array.from({ length: READ_CURSOR_BOUNDS.MAX_CONVERSATIONS + 1 }, (_, index) => ({
    conversationId: `3c000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    seq: 1,
  }));
  assert.equal(refusalOf(encode({ positions: crowded })), SCHEMA_REFUSAL.TOO_LARGE);
  assert.equal(
    refusalOf("A".repeat(READ_CURSOR_BOUNDS.MAX_ENCODED_LENGTH + 1)),
    SCHEMA_REFUSAL.TOO_LARGE,
  );
  assert.throws(() => encodeSequenceReadCursor([{ conversationId: "main", seq: 1 }]), TypeError);
});

test("a turn cursor keeps the store's microsecond instant and the id whole", () => {
  const cursor = { changedAt: "2026-09-10 12:00:00.000500+00", id: TURN };
  assert.deepEqual(parse(turnReadCursorSchema, encodeTurnReadCursor(cursor)), cursor);
  const refusalOf = (value: WireValue) =>
    Either.match(
      readEither(turnReadCursorSchema)(
        Buffer.from(JSON.stringify(value), "utf8").toString("base64url"),
      ),
      { onLeft: (refused) => refused.refusal, onRight: () => undefined },
    );
  assert.equal(refusalOf({ changedAt: 1757505600000, id: TURN }), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(
    refusalOf({ changedAt: "2026-09-10T12:00:00.000Z", id: TURN }),
    SCHEMA_REFUSAL.MALFORMED,
  );
  assert.equal(refusalOf({ changedAt: "2026-09-10 12:00:00+00" }), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(
    refusalOf({ changedAt: "2026-09-10 12:00:00+00", id: "turn-3" }),
    SCHEMA_REFUSAL.MALFORMED,
  );
});

test("a page bound is a whole number inside the page's own maximum", () => {
  assert.equal(parse(readLimitSchema, 1), 1);
  assert.equal(parse(readLimitSchema, READ_PAGE_BOUNDS.MAX_LIMIT), READ_PAGE_BOUNDS.MAX_LIMIT);
  assert.equal(parse(readLimitSchema, 0), undefined);
  assert.equal(parse(readLimitSchema, READ_PAGE_BOUNDS.MAX_LIMIT + 1), undefined);
  assert.equal(parse(readLimitSchema, 2.5), undefined);
});

test("the messages answer fixture reads as the view's groups, each message's tools decided, under a cursor that decodes to the page's positions", async () => {
  const answer = expectRead(conversationMessagesAnswerSchema, await fixture(FIXTURE.MESSAGES));
  assert.deepEqual(
    answer.conversations.map((conversation) => [conversation.id, conversation.kind]),
    [
      [MAIN, CONVERSATION_VIEW_SOURCE.MAIN],
      [OBSERVED, CONVERSATION_VIEW_SOURCE.OBSERVED],
    ],
  );
  const [mainEntry] = answer.conversations;
  assert.equal(
    mainEntry?.kind === CONVERSATION_VIEW_SOURCE.MAIN && mainEntry.openedAt,
    1757505000000,
  );
  const raw = await fixture(FIXTURE.MESSAGES);
  assert.ok(isRecord(raw));
  assert.equal(
    parse(conversationMessagesAnswerSchema, {
      ...raw,
      conversations: [{ id: MAIN, kind: CONVERSATION_VIEW_SOURCE.MAIN }],
    }),
    undefined,
  );
  const [main, observed] = answer.groups;
  assert.ok(main && observed);
  assert.equal(main.source.kind, CONVERSATION_VIEW_SOURCE.MAIN);
  assert.equal(main.conversationId, MAIN);
  assert.equal(main.turn?.origin, TURN_ORIGIN.TYPED);
  assert.equal(main.turn?.status, TURN_STATUS.SETTLED);
  assert.deepEqual(
    main.messages.map((message) => message.seq),
    [1, 2],
  );
  assert.deepEqual(
    main.messages.map((message) => message.tools.map((tool) => tool.kind)),
    [[], [CONVERSATION_VIEW_TOOL_KIND.ACTION]],
  );
  const action = main.messages[1]?.tools[0];
  assert.equal(
    action?.kind === CONVERSATION_VIEW_TOOL_KIND.ACTION && action.outcome,
    CONVERSATION_VIEW_ACTION_OUTCOME.ACCEPTED,
  );
  assert.equal(observed.source.kind, CONVERSATION_VIEW_SOURCE.OBSERVED);
  assert.equal(
    observed.source.kind === CONVERSATION_VIEW_SOURCE.OBSERVED &&
      observed.source.session.providerId,
    "conductor",
  );
  assert.deepEqual(observed.messages[0]?.rating, { rating: MESSAGE_RATING.UP });
  assert.equal(main.messages[1]?.rating, undefined);
  const announce = observed.messages[0]?.tools[0];
  assert.equal(announce?.kind, CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE);
  assert.equal(announce?.kind === CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE && announce.unspoken, false);
  assert.deepEqual(parse(sequenceReadCursorSchema, answer.next), {
    positions: [
      { conversationId: MAIN, seq: 2 },
      { conversationId: OBSERVED, seq: 32 },
    ],
  });
  assert.equal(answer.hasMore, false);
});

test("a messages answer whose group holds a message that is not a record, or a cursor that does not decode, is refused whole rather than thinned", async () => {
  const raw = await fixture(FIXTURE.MESSAGES);
  assert.ok(isRecord(raw));
  assert.notEqual(parse(conversationMessagesAnswerSchema, raw), undefined);
  const groups = raw.groups;
  assert.ok(Array.isArray(groups));
  const [firstGroup, ...otherGroups] = groups;
  assert.ok(isRecord(firstGroup) && Array.isArray(firstGroup.messages));
  const [, ...otherMessages] = firstGroup.messages;
  const thinned = {
    ...raw,
    groups: [
      { ...firstGroup, messages: [{ message: "not a message" }, ...otherMessages] },
      ...otherGroups,
    ],
  };
  assert.equal(parse(conversationMessagesAnswerSchema, thinned), undefined);
  assert.equal(parse(conversationMessagesAnswerSchema, { ...raw, next: "%%%" }), undefined);
});

test("the events answer fixture reads each event's kind, device, and payload as written", async () => {
  const answer = expectRead(conversationEventsAnswerSchema, await fixture(FIXTURE.EVENTS));
  assert.deepEqual(
    answer.events.map((event) => [event.seq, event.kind]),
    [
      [1, CONVERSATION_EVENT_KIND.SPEECH_OFFERED],
      [2, CONVERSATION_EVENT_KIND.SPEECH_CLAIMED],
      [3, CONVERSATION_EVENT_KIND.RATING],
    ],
  );
  assert.equal(answer.events[0]?.deviceId, undefined);
  assert.equal(answer.events[1]?.deviceId, DEVICE);
  assert.deepEqual(answer.events[2]?.payload, { rating: "up" });
  assert.deepEqual(
    parse(sequenceReadCursorSchema, answer.next)?.positions.map((p) => p.seq),
    [0, 3],
  );
});

test("the turns answer fixture reads each turn with its own cursor, and the answer's cursor is the last turn's", async () => {
  const answer = expectRead(brainTurnsAnswerSchema, await fixture(FIXTURE.TURNS));
  assert.deepEqual(
    answer.turns.map((turn) => [turn.origin, turn.status, turn.conversationId]),
    [
      [TURN_ORIGIN.TYPED, TURN_STATUS.SETTLED, MAIN],
      [TURN_ORIGIN.ROSTER_DIFF, TURN_STATUS.SETTLED, OBSERVED],
    ],
  );
  assert.equal(answer.turns[0]?.model, "gpt-5");
  assert.equal(answer.turns[1]?.model, undefined);
  assert.equal(answer.next, answer.turns[1]?.cursor);
  assert.deepEqual(parse(turnReadCursorSchema, answer.next ?? ""), {
    changedAt: "2026-09-10 12:02:02.4+00",
    id: TURN,
  });
});

test("the change-signal request names the device and carries each instant as a number, null, or absent, and refuses anything else", async () => {
  assert.deepEqual(expectRead(changesRequestSchema, await fixture(FIXTURE.CHANGES_REQUEST)), {
    deviceId: DEVICE,
    activeUntil: 1757505900000,
    quietUntil: null,
  });
  assert.deepEqual(parse(changesRequestSchema, { deviceId: DEVICE }), { deviceId: DEVICE });
  assert.equal(parse(changesRequestSchema, { deviceId: "mac" }), undefined);
  assert.equal(parse(changesRequestSchema, { deviceId: DEVICE, activeUntil: "soon" }), undefined);
  assert.equal(parse(changesRequestSchema, { deviceId: DEVICE, quietUntil: -1 }), undefined);
  assert.equal(
    parse(changesRequestSchema, { deviceId: DEVICE, pushToken: "ab".repeat(32) }),
    undefined,
  );
});

test("the change-signal answer fixture reads every head as the cursor a caught-up device would hold", async () => {
  const answer = expectRead(changesAnswerSchema, await fixture(FIXTURE.CHANGES_ANSWER));
  assert.equal(answer.seen, true);
  assert.deepEqual(
    parse(sequenceReadCursorSchema, answer.messages)?.positions.map((p) => p.seq),
    [2, 32],
  );
  assert.deepEqual(
    parse(sequenceReadCursorSchema, answer.events)?.positions.map((p) => p.seq),
    [0, 3],
  );
  assert.equal(parse(turnReadCursorSchema, answer.turns ?? "")?.id, TURN);
  assert.equal(answer.rosterObservedAt, 1757505780000);
  assert.deepEqual(
    parse(changesAnswerSchema, { seen: false, messages: answer.messages, events: answer.events }),
    { seen: false, messages: answer.messages, events: answer.events },
  );
});

test("the unreadable-row refusal reads to the row it names and nothing else reads as one", () => {
  assert.deepEqual(
    parse(unreadableRowRefusalSchema, {
      error: HOSTED_API_ERROR.UNREADABLE_ROW,
      unreadableRow: { conversationId: MAIN.toUpperCase(), seq: 4 },
    }),
    { conversationId: MAIN, seq: 4 },
  );
  assert.equal(
    parse(unreadableRowRefusalSchema, {
      error: HOSTED_API_ERROR.UNAVAILABLE,
      unreadableRow: { conversationId: MAIN, seq: 4 },
    }),
    undefined,
  );
  assert.equal(
    parse(unreadableRowRefusalSchema, {
      error: HOSTED_API_ERROR.UNREADABLE_ROW,
      unreadableRow: { conversationId: MAIN, seq: 0 },
    }),
    undefined,
  );
  assert.equal(
    parse(unreadableRowRefusalSchema, { error: HOSTED_API_ERROR.UNREADABLE_ROW }),
    undefined,
  );
});
