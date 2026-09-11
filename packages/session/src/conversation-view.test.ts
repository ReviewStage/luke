import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONVERSATION_EVENT_KIND,
  type ConversationEventKind,
  MESSAGE_AUTHOR,
  MESSAGE_RATING,
  MESSAGE_ROLE,
  type SchemaRead,
  TURN_ORIGIN,
  unparsedWire,
  type WireBoundaryInput,
} from "@sidecar/wire";
import { type ToolSet, tool } from "ai";
import { test } from "vitest";
import { z } from "zod";
import {
  CONVERSATION_VIEW_ACTION_OUTCOME,
  CONVERSATION_VIEW_SOURCE,
  CONVERSATION_VIEW_TOOL_KIND,
  type ConversationViewEvent,
  type ConversationViewInput,
  type ConversationViewStoredMessage,
  type ConversationViewToolKinds,
  type ConversationViewTurn,
  selectConversationView,
} from "./conversation-view.js";
import { TOOL_PART_STATE } from "./ui-messages/tool-parts.js";
import { readStoredUIMessages, type StoredUIMessage } from "./ui-messages/validate.js";

const FIXTURE_DIRECTORY = path.join(fileURLToPath(import.meta.url), "../../fixtures");

const FIXTURE = {
  TYPED_ASK: "typed-ask.json",
  SPOKEN_ASK: "spoken-ask.json",
  OBSERVATION_ANNOUNCED: "observation-announced.json",
  OBSERVATION_ACTED: "observation-acted.json",
  OBSERVATION_IDLE: "observation-idle.json",
  CHILD_COMPLETION: "child-completion.json",
} as const;

type FixtureName = (typeof FIXTURE)[keyof typeof FIXTURE];

const TURN = {
  TYPED: "1a000000-0000-4000-8000-000000000001",
  SPOKEN: "1a000000-0000-4000-8000-000000000002",
  ANNOUNCED: "1a000000-0000-4000-8000-000000000003",
  ACTED: "1a000000-0000-4000-8000-000000000004",
  CHILD: "1a000000-0000-4000-8000-000000000006",
} as const;

const OBSERVED_SESSION = {
  providerId: "conductor",
  providerSessionId: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50",
};

const sessionIdentity = z.object({ provider_id: z.string(), provider_session_id: z.string() });

const actionOutput = z.object({
  status: z.enum(["accepted", "unknown", "refused"]),
  reason: z.string().optional(),
  target: z
    .object({
      providerId: z.string(),
      providerSessionId: z.string().optional(),
      title: z.string().optional(),
      agentId: z.string().optional(),
    })
    .optional(),
});

/** The registry the fixtures are held to: the brain's names, with schemas the test declares. */
const TOOLS: ToolSet = {
  announce: tool({
    description: "Hand the developer one spoken briefing.",
    inputSchema: z.object({ briefing: z.string() }),
  }),
  read_transcript: tool({
    description: "Reads the tail of an observed session's transcript.",
    inputSchema: sessionIdentity,
    outputSchema: z.object({ lines: z.array(z.string()) }),
  }),
  send_session_message: tool({
    description: "Send a message to an observed session.",
    inputSchema: sessionIdentity.extend({ text: z.string() }),
    outputSchema: actionOutput,
  }),
  run_session_control: tool({
    description: "Run a control advertised by an observed session.",
    inputSchema: sessionIdentity.extend({ control_id: z.string() }),
    outputSchema: actionOutput,
  }),
};

const TOOL_KINDS: ConversationViewToolKinds = new Map([
  ["announce", CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE],
  ["send_session_message", CONVERSATION_VIEW_TOOL_KIND.ACTION],
  ["run_session_control", CONVERSATION_VIEW_TOOL_KIND.ACTION],
]);

/** A fixture row as the file spells it: the message still unread, beside its columns. */
type FixtureRow = Omit<ConversationViewStoredMessage, "message"> & { message: WireBoundaryInput };

type FixtureFile = {
  main: FixtureRow[];
  observed: { session: typeof OBSERVED_SESSION; messages: FixtureRow[] }[];
  turns: ConversationViewTurn[];
  events: ConversationViewEvent[];
};

/** A committed fixture file, read as the shape its reader says it has; the messages inside are still read back under the vocabulary before anything trusts them. */
async function readFixtureFile<Shape>(directory: string, name: string): Promise<Shape> {
  // SAFETY: the fixture files are JSON this repository commits, each in the shape its one reader names.
  return JSON.parse(await readFile(path.join(FIXTURE_DIRECTORY, directory, name), "utf8")) as Shape;
}

function expectOk<Value>(read: SchemaRead<Value>): Value {
  assert.equal(read.ok, true);
  if (!read.ok) throw new Error("unreachable");
  return read.value;
}

/** The rows read back under the vocabulary, in the order they were handed over. */
async function readRows(rows: readonly FixtureRow[]): Promise<ConversationViewStoredMessage[]> {
  const read = expectOk(
    await readStoredUIMessages(unparsedWire(rows.map((row) => row.message)), TOOLS),
  );
  return read.map((message, index) => {
    const row = rows[index];
    if (row === undefined) throw new Error("unreachable");
    return { message, seq: row.seq, turnId: row.turnId, createdAt: row.createdAt };
  });
}

async function loadView(name: FixtureName): Promise<ConversationViewInput> {
  const file = await readFixtureFile<FixtureFile>("conversation-view", name);
  const [main, ...observed] = await Promise.all([
    readRows(file.main),
    ...file.observed.map((conversation) => readRows(conversation.messages)),
  ]);
  return {
    main,
    observed: file.observed.map((conversation, index) => ({
      session: conversation.session,
      messages: observed[index] ?? [],
    })),
    turns: file.turns,
    events: file.events,
    toolKinds: TOOL_KINDS,
  };
}

function speechEvents(
  messageId: string,
  kinds: readonly ConversationEventKind[],
): ConversationViewEvent[] {
  return kinds.map((kind, index) => ({ messageId, kind, seq: index + 1 }));
}

/** Who a stored message says wrote it; a system row says nothing. */
function authorOf(message: StoredUIMessage | undefined): string | undefined {
  if (message === undefined || message.role === MESSAGE_ROLE.SYSTEM) return undefined;
  return message.metadata.author;
}

function messageIds(input: ConversationViewInput): string[] {
  return [
    ...input.main.map((row) => row.message.id),
    ...input.observed.flatMap((conversation) => conversation.messages.map((row) => row.message.id)),
  ];
}

test("a typed ask and its reply are one group of main's, whole and in sequence", async () => {
  const input = await loadView(FIXTURE.TYPED_ASK);
  const groups = selectConversationView(input);
  assert.equal(groups.length, 1);
  const [group] = groups;
  assert.equal(group?.turnId, TURN.TYPED);
  assert.deepEqual(group?.source, { kind: CONVERSATION_VIEW_SOURCE.MAIN });
  assert.equal(group?.turn?.origin, TURN_ORIGIN.TYPED);
  assert.deepEqual(
    group?.messages.map((message) => message.message.id),
    messageIds(input),
  );
  assert.deepEqual(
    group?.messages.map((message) => message.tools.length),
    [0, 0],
  );
  assert.deepEqual(
    group?.messages.map((message) => message.message.parts.length),
    input.main.map((row) => row.message.parts.length),
  );
});

test("a spoken ask keeps its voice metadata, and its transcript read is a collapsed detail", async () => {
  const input = await loadView(FIXTURE.SPOKEN_ASK);
  const groups = selectConversationView(input);
  assert.equal(groups.length, 1);
  const [group] = groups;
  assert.equal(group?.turn?.origin, TURN_ORIGIN.SPOKEN);
  const [ask, reply] = group?.messages ?? [];
  assert.equal(ask?.message, input.main[0]?.message);
  assert.equal(authorOf(ask?.message), MESSAGE_AUTHOR.DEVELOPER);
  assert.deepEqual(reply?.tools, [
    {
      kind: CONVERSATION_VIEW_TOOL_KIND.DETAIL,
      toolCallId: "call_2a0000000000000001",
      toolName: "read_transcript",
      state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
    },
  ]);
  assert.equal(reply?.message.parts.length, input.main[1]?.message.parts.length);
});

test("an observation that announced crosses as its announce part alone, under the observed session", async () => {
  const input = await loadView(FIXTURE.OBSERVATION_ANNOUNCED);
  const groups = selectConversationView(input);
  assert.equal(groups.length, 1);
  const [group] = groups;
  assert.equal(group?.turnId, TURN.ANNOUNCED);
  assert.equal(group?.turn?.origin, TURN_ORIGIN.ROSTER_DIFF);
  assert.deepEqual(group?.source, {
    kind: CONVERSATION_VIEW_SOURCE.OBSERVED,
    session: OBSERVED_SESSION,
  });
  assert.equal(group?.messages.length, 1);
  const [message] = group?.messages ?? [];
  assert.equal(message?.message.id, input.observed[0]?.messages[1]?.message.id);
  assert.deepEqual(
    message?.message.parts.map((part) => part.type),
    ["tool-announce"],
  );
  assert.deepEqual(message?.tools, [
    {
      kind: CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE,
      toolCallId: "call_3a0000000000000002",
      toolName: "announce",
      state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
      unspoken: false,
    },
  ]);
});

test("an announcement is unspoken when its latest speech event is the expiry, whatever came before or beside it", async () => {
  const input = await loadView(FIXTURE.OBSERVATION_ANNOUNCED);
  const announcementId = input.observed[0]?.messages[1]?.message.id ?? "";
  const unspokenUnder = (kinds: readonly ConversationEventKind[]) => {
    const [group] = selectConversationView({
      ...input,
      events: speechEvents(announcementId, kinds),
    });
    const [part] = group?.messages[0]?.tools ?? [];
    return part?.kind === CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE ? part.unspoken : undefined;
  };
  assert.equal(unspokenUnder([]), false);
  assert.equal(
    unspokenUnder([CONVERSATION_EVENT_KIND.SPEECH_OFFERED, CONVERSATION_EVENT_KIND.SPEECH_HELD]),
    false,
  );
  assert.equal(
    unspokenUnder([CONVERSATION_EVENT_KIND.SPEECH_OFFERED, CONVERSATION_EVENT_KIND.SPEECH_EXPIRED]),
    true,
  );
  assert.equal(
    unspokenUnder([
      CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
      CONVERSATION_EVENT_KIND.SPEECH_SPOKEN,
    ]),
    false,
  );
  assert.equal(
    unspokenUnder([
      CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
      CONVERSATION_EVENT_KIND.RATING,
    ]),
    true,
  );
  const reversed = [
    ...speechEvents(announcementId, [
      CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
    ]),
  ].reverse();
  const [group] = selectConversationView({ ...input, events: reversed });
  const [part] = group?.messages[0]?.tools ?? [];
  assert.equal(part?.kind === CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE && part.unspoken, true);
});

test("a message carries its latest rating by event sequence, a re-rating replaces it in the view, and an unreadable newest rating folds as none", async () => {
  const input = await loadView(FIXTURE.OBSERVATION_ANNOUNCED);
  const announcementId = input.observed[0]?.messages[1]?.message.id ?? "";
  const ratingUnder = (events: readonly ConversationViewEvent[]) => {
    const [group] = selectConversationView({ ...input, events });
    return group?.messages[0]?.rating;
  };
  assert.equal(ratingUnder([]), undefined);
  assert.deepEqual(
    ratingUnder([
      { messageId: announcementId, kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED, seq: 1 },
      {
        messageId: announcementId,
        kind: CONVERSATION_EVENT_KIND.RATING,
        seq: 2,
        rating: { rating: MESSAGE_RATING.UP },
      },
    ]),
    { rating: MESSAGE_RATING.UP },
  );
  assert.deepEqual(
    ratingUnder([
      {
        messageId: announcementId,
        kind: CONVERSATION_EVENT_KIND.RATING,
        seq: 3,
        rating: { rating: MESSAGE_RATING.DOWN, note: "Too early." },
      },
      {
        messageId: announcementId,
        kind: CONVERSATION_EVENT_KIND.RATING,
        seq: 2,
        rating: { rating: MESSAGE_RATING.UP },
      },
    ]),
    { rating: MESSAGE_RATING.DOWN, note: "Too early." },
  );
  assert.equal(
    ratingUnder([
      {
        messageId: announcementId,
        kind: CONVERSATION_EVENT_KIND.RATING,
        seq: 2,
        rating: { rating: MESSAGE_RATING.UP },
      },
      { messageId: announcementId, kind: CONVERSATION_EVENT_KIND.RATING, seq: 3 },
    ]),
    undefined,
  );
  assert.equal(
    ratingUnder([
      {
        messageId: "2b000000-0000-4000-8000-000000000099",
        kind: CONVERSATION_EVENT_KIND.RATING,
        seq: 2,
        rating: { rating: MESSAGE_RATING.UP },
      },
    ]),
    undefined,
  );
});

test("an observation that acted crosses as its action parts, the refused one flagged and collapsed", async () => {
  const input = await loadView(FIXTURE.OBSERVATION_ACTED);
  const groups = selectConversationView(input);
  assert.equal(groups.length, 1);
  const [group] = groups;
  assert.equal(group?.turnId, TURN.ACTED);
  assert.equal(group?.turn?.origin, TURN_ORIGIN.HOLD_RELEASE);
  assert.equal(group?.messages.length, 1);
  const [message] = group?.messages ?? [];
  assert.deepEqual(
    message?.message.parts.map((part) => part.type),
    ["tool-send_session_message", "tool-run_session_control", "tool-send_session_message"],
  );
  assert.deepEqual(message?.tools, [
    {
      kind: CONVERSATION_VIEW_TOOL_KIND.ACTION,
      toolCallId: "call_4a0000000000000001",
      toolName: "send_session_message",
      state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
      outcome: CONVERSATION_VIEW_ACTION_OUTCOME.ACCEPTED,
    },
    {
      kind: CONVERSATION_VIEW_TOOL_KIND.ACTION,
      toolCallId: "call_4a0000000000000002",
      toolName: "run_session_control",
      state: TOOL_PART_STATE.OUTPUT_ERROR,
      outcome: CONVERSATION_VIEW_ACTION_OUTCOME.REFUSED,
    },
    {
      kind: CONVERSATION_VIEW_TOOL_KIND.ACTION,
      toolCallId: "call_4a0000000000000003",
      toolName: "send_session_message",
      state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
      outcome: CONVERSATION_VIEW_ACTION_OUTCOME.UNKNOWN,
    },
  ]);
});

test("an observed turn whose only action was refused still crosses, with the refusal flagged", async () => {
  const input = await loadView(FIXTURE.OBSERVATION_ACTED);
  const [conversation] = input.observed;
  if (conversation === undefined) throw new Error("unreachable");
  const messages = conversation.messages.map((row) => ({
    ...row,
    message: {
      ...row.message,
      parts: row.message.parts.filter((part) => part.type !== "tool-send_session_message"),
    },
  }));
  const groups = selectConversationView({
    ...input,
    observed: [{ ...conversation, messages }],
  });
  assert.deepEqual(
    groups.flatMap((group) => group.messages.flatMap((message) => message.tools)),
    [
      {
        kind: CONVERSATION_VIEW_TOOL_KIND.ACTION,
        toolCallId: "call_4a0000000000000002",
        toolName: "run_session_control",
        state: TOOL_PART_STATE.OUTPUT_ERROR,
        outcome: CONVERSATION_VIEW_ACTION_OUTCOME.REFUSED,
      },
    ],
  );
});

test("an action's outcome is read from its part alone: pending until settled, refused on error, and by the envelope's status once answered", async () => {
  const input = await loadView(FIXTURE.OBSERVATION_ACTED);
  const [conversation] = input.observed;
  if (conversation === undefined) throw new Error("unreachable");
  const messages = conversation.messages.map((row) => ({
    ...row,
    message: {
      ...row.message,
      parts: row.message.parts.map((part): StoredUIMessage["parts"][number] =>
        part.type === "tool-run_session_control" && "toolCallId" in part
          ? {
              type: part.type,
              toolCallId: part.toolCallId,
              state: TOOL_PART_STATE.INPUT_AVAILABLE,
              input: part.input,
            }
          : part,
      ),
    },
  }));
  const groups = selectConversationView({ ...input, observed: [{ ...conversation, messages }] });
  assert.deepEqual(
    groups.flatMap((group) =>
      group.messages.flatMap((message) =>
        message.tools.map((tool) => [
          tool.state,
          tool.kind === CONVERSATION_VIEW_TOOL_KIND.ACTION ? tool.outcome : undefined,
        ]),
      ),
    ),
    [
      [TOOL_PART_STATE.OUTPUT_AVAILABLE, CONVERSATION_VIEW_ACTION_OUTCOME.ACCEPTED],
      [TOOL_PART_STATE.INPUT_AVAILABLE, CONVERSATION_VIEW_ACTION_OUTCOME.PENDING],
      [TOOL_PART_STATE.OUTPUT_AVAILABLE, CONVERSATION_VIEW_ACTION_OUTCOME.UNKNOWN],
    ],
  );
});

test("a tool the view was not told about is a detail, so an observed action it does not know never crosses", async () => {
  const input = await loadView(FIXTURE.OBSERVATION_ACTED);
  const toolKinds: ConversationViewToolKinds = new Map([
    ["announce", CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE],
  ]);
  assert.equal(selectConversationView({ ...input, toolKinds }).length, 0);
});

test("an observation that did nothing is not shown at all", async () => {
  const input = await loadView(FIXTURE.OBSERVATION_IDLE);
  assert.deepEqual(selectConversationView(input), []);
});

test("a child's completion is a message of main's, under its own turn", async () => {
  const input = await loadView(FIXTURE.CHILD_COMPLETION);
  const groups = selectConversationView(input);
  assert.equal(groups.length, 1);
  const [group] = groups;
  assert.equal(group?.turnId, TURN.CHILD);
  assert.equal(group?.turn?.origin, TURN_ORIGIN.CHILD_COMPLETION);
  assert.deepEqual(group?.source, { kind: CONVERSATION_VIEW_SOURCE.MAIN });
  assert.equal(authorOf(group?.messages[0]?.message), MESSAGE_AUTHOR.CHILD);
});

/** Every fixture's rows, one input: two conversations' worth of turns interleaved by time. */
async function loadEveryView(): Promise<ConversationViewInput> {
  const views = await Promise.all(Object.values(FIXTURE).map(loadView));
  return {
    main: views.flatMap((view) => view.main),
    observed: [
      {
        session: OBSERVED_SESSION,
        messages: views.flatMap((view) =>
          view.observed.flatMap((conversation) => conversation.messages),
        ),
      },
    ],
    turns: views.flatMap((view) => view.turns),
    events: views.flatMap((view) => view.events),
    toolKinds: TOOL_KINDS,
  };
}

test("groups are ordered by time across main and the observed conversations, whatever order the rows arrived in", async () => {
  const input = await loadEveryView();
  const expected = [TURN.TYPED, TURN.SPOKEN, TURN.ANNOUNCED, TURN.ACTED, TURN.CHILD];
  const groups = selectConversationView(input);
  assert.deepEqual(
    groups.map((group) => group.turnId),
    expected,
  );
  const reversed: ConversationViewInput = {
    ...input,
    main: [...input.main].reverse(),
    observed: input.observed.map((conversation) => ({
      ...conversation,
      messages: [...conversation.messages].reverse(),
    })),
    turns: [...input.turns].reverse(),
  };
  assert.deepEqual(selectConversationView(reversed), groups);
});

test("groups whose earliest messages share an instant fall back to the queue order, then the turn id", async () => {
  const typed = await loadView(FIXTURE.TYPED_ASK);
  const child = await loadView(FIXTURE.CHILD_COMPLETION);
  const instant = typed.main[0]?.createdAt ?? 0;
  const sameInstant = (rows: readonly ConversationViewStoredMessage[]) =>
    rows.map((row, index) => ({ ...row, createdAt: instant + index }));
  const main = [...sameInstant(typed.main), ...sameInstant(child.main)];
  const [typedTurn] = typed.turns;
  const [childTurn] = child.turns;
  if (typedTurn === undefined || childTurn === undefined) throw new Error("unreachable");
  const laterTyped = { ...typedTurn, queuedAt: childTurn.queuedAt + 1 };
  const order = (turns: readonly ConversationViewTurn[]) =>
    selectConversationView({ ...typed, main, turns }).map((group) => group.turnId);
  assert.deepEqual(order([laterTyped, childTurn]), [TURN.CHILD, TURN.TYPED]);
  assert.deepEqual(order([typedTurn, childTurn]), [TURN.TYPED, TURN.CHILD]);
  assert.deepEqual(order([childTurn]), [TURN.CHILD, TURN.TYPED]);
  assert.deepEqual(order([]), [TURN.TYPED, TURN.CHILD]);
});

test("a compaction row of main's is not shown, since the rows it folded still are", async () => {
  const input = await loadView(FIXTURE.TYPED_ASK);
  const compaction = await readFixtureFile<WireBoundaryInput>("ui-messages", "compaction.json");
  const [message] = expectOk(await readStoredUIMessages(unparsedWire([compaction]), TOOLS));
  if (message === undefined) throw new Error("unreachable");
  const last = input.main.at(-1);
  if (last === undefined) throw new Error("unreachable");
  const folded: ConversationViewStoredMessage = {
    message,
    seq: last.seq + 1,
    turnId: last.turnId,
    createdAt: last.createdAt + 100,
  };
  const groups = selectConversationView({ ...input, main: [...input.main, folded] });
  assert.deepEqual(
    groups.map((group) => group.messages.length),
    [2],
  );
});

test("a message whose turn row is missing is still shown, with no turn beside it", async () => {
  const input = await loadView(FIXTURE.TYPED_ASK);
  const [group] = selectConversationView({ ...input, turns: [] });
  assert.equal(group?.turnId, TURN.TYPED);
  assert.equal(group?.turn, undefined);
  assert.equal(group?.messages.length, 2);
});

test("the turn row rides on the group as the store held it", async () => {
  const input = await loadView(FIXTURE.TYPED_ASK);
  const [turn] = input.turns;
  const [group] = selectConversationView(input);
  assert.deepEqual(group?.turn, turn satisfies ConversationViewTurn | undefined);
});

test("selection leaves its input untouched", async () => {
  const input = await loadEveryView();
  const before = JSON.stringify(input);
  selectConversationView(input);
  assert.equal(JSON.stringify(input), before);
});
