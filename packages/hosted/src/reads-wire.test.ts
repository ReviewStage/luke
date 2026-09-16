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
  EXCESS_KEYS,
  isRecord,
  MESSAGE_RATING,
  MESSAGE_ROLE,
  SCHEMA_REFUSAL,
  TURN_ORIGIN,
  TURN_STATUS,
  type UnparsedWireValue,
  type WireValue,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { type Schema as EffectSchema, Result } from "effect";
import { test } from "vitest";
import {
  AGENTS_READ_BOUNDS,
  agentsAnswerSchema,
  agentsHeadSchema,
  brainTurnsAnswerSchema,
  CHILD_STATUS,
  CHILDREN_READ_BOUNDS,
  changesAnswerSchema,
  changesRequestSchema,
  childrenAnswerSchema,
  childrenHeadSchema,
  conversationEventsAnswerSchema,
  conversationMessagesAnswerSchema,
  encodeAgentsHead,
  encodeChildrenHead,
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
  CHILDREN: "children-answer.json",
  CHILD_MESSAGES: "child-messages-answer.json",
  OBSERVED_MESSAGES: "observed-messages-answer.json",
  AGENTS: "agents-answer.json",
  CHANGES_REQUEST: "changes-request.json",
  CHANGES_ANSWER: "changes-answer.json",
} as const;

const MAIN = "3c000000-0000-4000-8000-000000000001";
const OBSERVED = "3c000000-0000-4000-8000-000000000002";
const SETTLED_AGENT = "3c000000-0000-4000-8000-000000000003";
const TURN = "1a000000-0000-4000-8000-000000000003";
const SETTLED_CHILD = "3c000000-0000-4000-8000-000000000011";
const RUNNING_CHILD = "3c000000-0000-4000-8000-000000000012";
const DEVICE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

async function fixture(name: (typeof FIXTURE)[keyof typeof FIXTURE]): Promise<UnparsedWireValue> {
  // SAFETY: the fixture files are JSON this repository commits; the schema under test is the validation.
  return JSON.parse(
    await readFile(path.join(FIXTURE_DIRECTORY, name), "utf8"),
  ) as UnparsedWireValue;
}

/** A cursor's or a request's read: a key the declaration does not name refuses it. */
function expectRead<S extends EffectSchema.ConstraintDecoder<unknown>>(
  schema: S,
  value: UnparsedWireValue,
): S["Type"] {
  const read = readEither(schema)(value);
  if (Result.isFailure(read))
    assert.fail(`${read.failure.refusal} at ${read.failure.path.join(".")}`);
  return read.success;
}

/** The same, for an answer: a key a newer service added is dropped rather than refused. */
function expectReadAnswer<S extends EffectSchema.ConstraintDecoder<unknown>>(
  schema: S,
  value: UnparsedWireValue,
): S["Type"] {
  const read = readEither(schema, { excess: EXCESS_KEYS.DROP })(value);
  if (Result.isFailure(read))
    assert.fail(`${read.failure.refusal} at ${read.failure.path.join(".")}`);
  return read.success;
}

function parse<S extends EffectSchema.ConstraintDecoder<unknown>>(
  schema: S,
  value: UnparsedWireValue,
): S["Type"] | undefined {
  return Result.getOrUndefined(readEither(schema)(value));
}

function parseAnswer<S extends EffectSchema.ConstraintDecoder<unknown>>(
  schema: S,
  value: UnparsedWireValue,
): S["Type"] | undefined {
  return Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(value));
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

test("a position carries the conversation's revision where the resource keeps one, and none where it does not", () => {
  const withRevision = encodeSequenceReadCursor([
    { conversationId: MAIN, seq: 2, revision: 7 },
    { conversationId: OBSERVED, seq: 32 },
  ]);
  assert.deepEqual(parse(sequenceReadCursorSchema, withRevision), {
    positions: [
      { conversationId: MAIN, seq: 2, revision: 7 },
      { conversationId: OBSERVED, seq: 32 },
    ],
  });
  // The same positions at another revision are another string, which is what moves a device to read.
  assert.notEqual(
    withRevision,
    encodeSequenceReadCursor([
      { conversationId: MAIN, seq: 2, revision: 8 },
      { conversationId: OBSERVED, seq: 32 },
    ]),
  );
  // A revision below zero is a shape this build does not mint.
  assert.throws(
    () => encodeSequenceReadCursor([{ conversationId: MAIN, seq: 2, revision: -1 }]),
    TypeError,
  );
});

test("a sequence cursor this build did not mint the shape of is refused, naming why", () => {
  const encode = (value: WireValue) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const refusalOf = (value: UnparsedWireValue) =>
    Result.match(readEither(sequenceReadCursorSchema)(value), {
      onFailure: (refused) => refused.refusal,
      onSuccess: () => undefined,
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
    Result.match(
      readEither(turnReadCursorSchema)(
        Buffer.from(JSON.stringify(value), "utf8").toString("base64url"),
      ),
      { onFailure: (refused) => refused.refusal, onSuccess: () => undefined },
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
  const answer = expectReadAnswer(
    conversationMessagesAnswerSchema,
    await fixture(FIXTURE.MESSAGES),
  );
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
    parseAnswer(conversationMessagesAnswerSchema, {
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
  assert.notEqual(parseAnswer(conversationMessagesAnswerSchema, raw), undefined);
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
  assert.equal(parseAnswer(conversationMessagesAnswerSchema, thinned), undefined);
  assert.equal(parseAnswer(conversationMessagesAnswerSchema, { ...raw, next: "%%%" }), undefined);
});

test("the events answer fixture reads each event's kind, device, and payload as written", async () => {
  const answer = expectReadAnswer(conversationEventsAnswerSchema, await fixture(FIXTURE.EVENTS));
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
  const answer = expectReadAnswer(brainTurnsAnswerSchema, await fixture(FIXTURE.TURNS));
  assert.deepEqual(
    answer.turns.map((turn) => [turn.origin, turn.status, turn.conversationId]),
    [
      [TURN_ORIGIN.TYPED, TURN_STATUS.SETTLED, MAIN],
      [TURN_ORIGIN.TRANSCRIPT_CHANGE, TURN_STATUS.SETTLED, OBSERVED],
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

test("a turn on the wire carries its failure word and never the row's failure detail, on the turns answer and under a messages group alike", async () => {
  const turns = await fixture(FIXTURE.TURNS);
  assert.ok(isRecord(turns) && Array.isArray(turns.turns) && isRecord(turns.turns[0]));
  const detailed = { ...turns, turns: [{ ...turns.turns[0], failureDetail: "MODEL_CALL_FAILED" }] };
  assert.notEqual(parse(brainTurnsAnswerSchema, turns), undefined);
  assert.equal(parse(brainTurnsAnswerSchema, detailed), undefined);
  const messages = await fixture(FIXTURE.MESSAGES);
  assert.ok(isRecord(messages) && Array.isArray(messages.groups) && isRecord(messages.groups[0]));
  const [group, ...groups] = messages.groups;
  assert.ok(isRecord(group) && isRecord(group.turn));
  const detailedGroup = { ...group, turn: { ...group.turn, failureDetail: "MODEL_CALL_FAILED" } };
  assert.notEqual(parse(conversationMessagesAnswerSchema, messages), undefined);
  assert.equal(
    parse(conversationMessagesAnswerSchema, { ...messages, groups: [detailedGroup, ...groups] }),
    undefined,
  );
});

test("the children answer fixture reads each child where its latest turn leaves it, with the stamps it reached and the words it was handed", async () => {
  const answer = expectReadAnswer(childrenAnswerSchema, await fixture(FIXTURE.CHILDREN));
  assert.deepEqual(
    answer.children.map((child) => [child.id, child.parentKind, child.status]),
    [
      [RUNNING_CHILD, CONVERSATION_VIEW_SOURCE.OBSERVED, CHILD_STATUS.RUNNING],
      [SETTLED_CHILD, CONVERSATION_VIEW_SOURCE.MAIN, CHILD_STATUS.SETTLED],
    ],
  );
  const [running, settled] = answer.children;
  assert.ok(running && settled);
  assert.equal(running.label, undefined);
  assert.equal(running.settledAt, undefined);
  assert.equal(running.failure, undefined);
  assert.equal(running.startedAt, 1757505780000);
  assert.equal(settled.label, "release notes");
  assert.equal(settled.parentConversationId, MAIN);
  assert.deepEqual(
    [settled.acceptedAt, settled.startedAt, settled.settledAt],
    [1757505600000, 1757505610000, 1757505700000],
  );
  // The excerpt is the line as the relay wrote it, the child's marker included; the device strips it.
  assert.equal(
    settled.task,
    "[subagent task] Draft the release notes for 0.6.0 from the merged pull requests.",
  );

  // A child is answered with no task before its line stands and with no stamps before a turn runs.
  assert.deepEqual(
    parseAnswer(childrenAnswerSchema, {
      children: [
        {
          id: SETTLED_CHILD,
          parentConversationId: MAIN,
          parentKind: CONVERSATION_VIEW_SOURCE.MAIN,
          status: CHILD_STATUS.ACCEPTED,
          acceptedAt: 1757505600000,
        },
      ],
    })?.children[0]?.task,
    undefined,
  );
  assert.deepEqual(parseAnswer(childrenAnswerSchema, { children: [] }), { children: [] });

  // A parent of a kind no delegation runs from, a status the store never derives, and a task past the excerpt bound are each refused.
  const raw = await fixture(FIXTURE.CHILDREN);
  assert.ok(isRecord(raw) && Array.isArray(raw.children));
  const [first, ...rest] = raw.children;
  assert.ok(isRecord(first));
  const withFirst = (child: Record<string, WireValue>) => ({
    children: [{ ...first, ...child }, ...rest],
  });
  assert.equal(parseAnswer(childrenAnswerSchema, withFirst({ parentKind: "child" })), undefined);
  assert.equal(
    parseAnswer(childrenAnswerSchema, withFirst({ status: TURN_STATUS.QUEUED })),
    undefined,
  );
  assert.equal(
    parseAnswer(
      childrenAnswerSchema,
      withFirst({ task: "w".repeat(CHILDREN_READ_BOUNDS.TASK_EXCERPT_CHARS + 1) }),
    ),
    undefined,
  );
  assert.notEqual(
    parseAnswer(
      childrenAnswerSchema,
      withFirst({ task: "w".repeat(CHILDREN_READ_BOUNDS.TASK_EXCERPT_CHARS) }),
    ),
    undefined,
  );
  const crowded = Array.from({ length: CHILDREN_READ_BOUNDS.MAX_CHILDREN + 1 }, () => first);
  assert.equal(parseAnswer(childrenAnswerSchema, { children: crowded }), undefined);
});

test("the child messages answer fixture is a main's page over the one child: its task line in a group of its own, the child turn's reply under its turn, and a cursor positioned on the child alone", async () => {
  const answer = expectReadAnswer(
    conversationMessagesAnswerSchema,
    await fixture(FIXTURE.CHILD_MESSAGES),
  );
  assert.deepEqual(
    answer.conversations.map((conversation) => [conversation.id, conversation.kind]),
    [[SETTLED_CHILD, CONVERSATION_VIEW_SOURCE.MAIN]],
  );
  const [taskLine, reply] = answer.groups;
  assert.ok(taskLine && reply);
  assert.equal(taskLine.turn, undefined);
  assert.equal(taskLine.turnId, taskLine.messages[0]?.message.id);
  assert.equal(reply.turn?.origin, TURN_ORIGIN.CHILD);
  assert.deepEqual(
    answer.groups.map((group) => [group.conversationId, group.source.kind, group.messages.length]),
    [
      [SETTLED_CHILD, CONVERSATION_VIEW_SOURCE.MAIN, 1],
      [SETTLED_CHILD, CONVERSATION_VIEW_SOURCE.MAIN, 1],
    ],
  );
  assert.deepEqual(parse(sequenceReadCursorSchema, answer.next), {
    positions: [{ conversationId: SETTLED_CHILD, seq: 2 }],
  });
  assert.equal(answer.hasMore, false);
});

test("the observed messages answer fixture is a main's page over the one observed conversation: the wake's line and Luke's reply under their transcript-change turn, whole, and a cursor positioned on it alone", async () => {
  const answer = expectReadAnswer(
    conversationMessagesAnswerSchema,
    await fixture(FIXTURE.OBSERVED_MESSAGES),
  );
  assert.deepEqual(
    answer.conversations.map((conversation) => [conversation.id, conversation.kind]),
    [[OBSERVED, CONVERSATION_VIEW_SOURCE.MAIN]],
  );
  const [wake] = answer.groups;
  assert.ok(wake);
  assert.equal(answer.groups.length, 1);
  assert.equal(wake.turnId, TURN);
  assert.equal(wake.turn?.origin, TURN_ORIGIN.TRANSCRIPT_CHANGE);
  assert.deepEqual(
    wake.messages.map((message) => [message.message.role, message.tools.length]),
    [
      [MESSAGE_ROLE.USER, 0],
      [MESSAGE_ROLE.ASSISTANT, 1],
    ],
  );
  assert.deepEqual(parse(sequenceReadCursorSchema, answer.next), {
    positions: [{ conversationId: OBSERVED, seq: 32 }],
  });
  assert.equal(answer.hasMore, false);
});

test("the agents answer fixture reads each agent by its session identity where its latest turn leaves it, with its queuing and the stamps it reached", async () => {
  const answer = expectReadAnswer(agentsAnswerSchema, await fixture(FIXTURE.AGENTS));
  assert.deepEqual(
    answer.agents.map((agent) => [agent.id, agent.providerId, agent.status]),
    [
      [OBSERVED, "conductor", CHILD_STATUS.RUNNING],
      [SETTLED_AGENT, "conductor", CHILD_STATUS.SETTLED],
    ],
  );
  const [running, settled] = answer.agents;
  assert.ok(running && settled);
  assert.equal(running.providerSessionId, "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50");
  assert.equal(running.settledAt, undefined);
  assert.equal(running.failure, undefined);
  // The title and workspace the service kept travel where it has them, and a row opened before it kept them carries neither.
  assert.deepEqual(
    [running.title, running.workspace],
    ["Fix the checkout tests", "power-vacation"],
  );
  assert.deepEqual([settled.title, settled.workspace], [undefined, undefined]);
  assert.deepEqual(
    [settled.acceptedAt, settled.queuedAt, settled.startedAt, settled.settledAt],
    [1757505000000, 1757505300000, 1757505310000, 1757505400000],
  );
  assert.deepEqual(parseAnswer(agentsAnswerSchema, { agents: [] }), { agents: [] });

  // A status the store never derives, a missing session identity, and a crowd past the bound are each refused.
  const raw = await fixture(FIXTURE.AGENTS);
  assert.ok(isRecord(raw) && Array.isArray(raw.agents));
  const [first, ...rest] = raw.agents;
  assert.ok(isRecord(first));
  const withFirst = (agent: Record<string, WireValue>) => ({
    agents: [{ ...first, ...agent }, ...rest],
  });
  assert.equal(
    parseAnswer(agentsAnswerSchema, withFirst({ status: TURN_STATUS.QUEUED })),
    undefined,
  );
  assert.equal(parseAnswer(agentsAnswerSchema, withFirst({ providerSessionId: " " })), undefined);
  // A blank title, or one past the bound, is refused rather than carried.
  assert.equal(parseAnswer(agentsAnswerSchema, withFirst({ title: " " })), undefined);
  assert.equal(
    parseAnswer(
      agentsAnswerSchema,
      withFirst({ workspace: "w".repeat(AGENTS_READ_BOUNDS.NAME_CHARS + 1) }),
    ),
    undefined,
  );
  const { providerId: _dropped, ...unnamed } = first;
  assert.equal(parseAnswer(agentsAnswerSchema, { agents: [unnamed, ...rest] }), undefined);
  // Every agent holds a turn, so one without its queuing is refused too.
  const { queuedAt: _unqueued, ...unqueued } = first;
  assert.equal(parseAnswer(agentsAnswerSchema, { agents: [unqueued, ...rest] }), undefined);
  const crowded = Array.from({ length: AGENTS_READ_BOUNDS.MAX_AGENTS + 1 }, () => first);
  assert.equal(parseAnswer(agentsAnswerSchema, { agents: crowded }), undefined);
});

test("an agents head is the turn cursor's shape minted from the agents' own stamps, and refuses anything else", () => {
  const head = { changedAt: "2026-09-10 12:02:02.4+00", id: OBSERVED };
  assert.deepEqual(parse(agentsHeadSchema, encodeAgentsHead(head)), head);
  assert.equal(parse(agentsHeadSchema, "not a head"), undefined);
  assert.throws(() => encodeAgentsHead({ changedAt: "soon", id: OBSERVED }), TypeError);
});

test("a children head is the turn cursor's shape minted from the children's own stamps, and refuses anything else", () => {
  const head = { changedAt: "2026-09-10 12:03:00+00", id: RUNNING_CHILD };
  assert.deepEqual(parse(childrenHeadSchema, encodeChildrenHead(head)), head);
  assert.equal(parse(childrenHeadSchema, "not a head"), undefined);
  assert.throws(() => encodeChildrenHead({ changedAt: "soon", id: RUNNING_CHILD }), TypeError);
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
  const answer = expectReadAnswer(changesAnswerSchema, await fixture(FIXTURE.CHANGES_ANSWER));
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
  assert.deepEqual(parse(childrenHeadSchema, answer.children ?? ""), {
    changedAt: "2026-09-10 12:03:00+00",
    id: RUNNING_CHILD,
  });
  assert.deepEqual(parse(agentsHeadSchema, answer.agents ?? ""), {
    changedAt: "2026-09-10 12:02:02.4+00",
    id: OBSERVED,
  });
  assert.equal(answer.rosterObservedAt, 1757505780000);
  assert.deepEqual(
    parseAnswer(changesAnswerSchema, {
      seen: false,
      messages: answer.messages,
      events: answer.events,
    }),
    { seen: false, messages: answer.messages, events: answer.events },
  );
  // A children or agents head that is not one this build mints refuses the answer, as any other head would.
  for (const head of [{ children: "%%%" }, { agents: "%%%" }]) {
    assert.equal(
      parseAnswer(changesAnswerSchema, {
        seen: true,
        messages: answer.messages,
        events: answer.events,
        ...head,
      }),
      undefined,
    );
  }
});

test("the unreadable-row refusal reads to the row it names and nothing else reads as one", () => {
  assert.deepEqual(
    parseAnswer(unreadableRowRefusalSchema, {
      error: HOSTED_API_ERROR.UNREADABLE_ROW,
      unreadableRow: { conversationId: MAIN.toUpperCase(), seq: 4 },
    }),
    { conversationId: MAIN, seq: 4 },
  );
  assert.equal(
    parseAnswer(unreadableRowRefusalSchema, {
      error: HOSTED_API_ERROR.UNAVAILABLE,
      unreadableRow: { conversationId: MAIN, seq: 4 },
    }),
    undefined,
  );
  assert.equal(
    parseAnswer(unreadableRowRefusalSchema, {
      error: HOSTED_API_ERROR.UNREADABLE_ROW,
      unreadableRow: { conversationId: MAIN, seq: 0 },
    }),
    undefined,
  );
  assert.equal(
    parseAnswer(unreadableRowRefusalSchema, { error: HOSTED_API_ERROR.UNREADABLE_ROW }),
    undefined,
  );
});
