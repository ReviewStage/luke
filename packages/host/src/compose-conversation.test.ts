import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ACTION_OUTPUT_STATUS } from "@sidecar/actions";
import { PRODUCT_EVENT, PRODUCT_RATED_MESSAGE_KIND } from "@sidecar/analytics";
import {
  CONVERSATION_RATE_STATUS,
  carried,
  GATEWAY_CLIENT_ROLE,
  GATEWAY_ERROR,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  GATEWAY_PROTOCOL_VERSION,
  type GatewayEventKind,
  type GatewayMethod,
} from "@sidecar/gateway";
import {
  type AgentRead,
  type AgentsAnswer,
  type BrainTurnsAnswer,
  CHILD_STATUS,
  type ChangesAnswer,
  type ChangesRequest,
  type ChildRead,
  type ChildrenAnswer,
  CONVERSATION_RATE_REFUSAL,
  CONVERSATION_READ_FAILURE,
  type ConversationEventsAnswer,
  type ConversationHistoryAnswer,
  type ConversationMessagesAnswer,
  type ConversationRateResult,
  type ConversationReadResult,
  type HistoryPageQuery,
  type HostedMessageRatingRequest,
  type NotebookAnswer,
  type ReadPageQuery,
} from "@sidecar/hosted";
import {
  CONVERSATION_VIEW_SOURCE,
  type ConversationViewSnapshot,
  type TranscriptSnapshot,
} from "@sidecar/session";
import {
  isRecord,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_RATING,
  MESSAGE_ROLE,
  RATING_WORD,
  TRANSCRIPT_KIND,
  TURN_ORIGIN,
  TURN_STATUS,
  type WireRecord,
  type WireValue,
} from "@sidecar/wire";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import {
  type AgentsSnapshot,
  type ChildrenSnapshot,
  type ConversationHeadsClient,
  type ConversationReadsClient,
  composeConversation,
} from "./compose-conversation.js";

const MAIN = "3c000000-0000-4000-8000-000000000001";
const TURN = "1a000000-0000-4000-8000-000000000001";
const DEVICE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ASK = "2b000000-0000-4000-8000-000000000001";
const REPLY = "2b000000-0000-4000-8000-000000000002";
const RATING_EVENT = "4d000000-0000-4000-8000-000000000001";
const CHILD = "5e000000-0000-4000-8000-000000000001";
const OTHER_CHILD = "5e000000-0000-4000-8000-000000000002";
const AGENT = "6f000000-0000-4000-8000-000000000001";
const NOW = 1_757_505_600_000;

const CHILD_ROW: ChildRead = {
  id: CHILD,
  parentConversationId: MAIN,
  parentKind: CONVERSATION_VIEW_SOURCE.MAIN,
  label: "tests",
  task: "Add a test for the retry.",
  status: CHILD_STATUS.RUNNING,
  acceptedAt: NOW,
  startedAt: NOW + 1,
};

/** The same child once its turn has settled: its rows stand still, so its transcript follows the head alone. */
const SETTLED_CHILD_ROW: ChildRead = {
  ...CHILD_ROW,
  status: CHILD_STATUS.SETTLED,
  settledAt: NOW + 2,
};

const AGENT_ROW: AgentRead = {
  id: AGENT,
  providerId: "conductor",
  providerSessionId: "session-a",
  status: CHILD_STATUS.SETTLED,
  acceptedAt: NOW,
  queuedAt: NOW,
  startedAt: NOW + 1,
  settledAt: NOW + 2,
};

const EMPTY_EVENTS: ConversationEventsAnswer = { events: [], next: "events-head", hasMore: false };
const EMPTY_TURNS: BrainTurnsAnswer = { turns: [], hasMore: false };
/** The tail of a Conversation with nothing in it yet: no rows, nothing older, and the forward cursor standing at an empty head. */
const EMPTY_TAIL: ConversationHistoryAnswer = {
  conversations: [{ id: MAIN, kind: CONVERSATION_VIEW_SOURCE.MAIN, openedAt: NOW - 60_000 }],
  groups: [],
  older: "tail",
  hasOlder: false,
  next: "",
};

function messagesAnswer(text: string, next = "messages-head"): ConversationMessagesAnswer {
  return {
    conversations: [{ id: MAIN, kind: CONVERSATION_VIEW_SOURCE.MAIN, openedAt: NOW - 60_000 }],
    groups: [
      {
        turnId: TURN,
        conversationId: MAIN,
        source: { kind: CONVERSATION_VIEW_SOURCE.MAIN },
        turn: { id: TURN, origin: TURN_ORIGIN.TYPED, status: TURN_STATUS.SETTLED, queuedAt: NOW },
        messages: [
          {
            message: {
              id: ASK,
              role: MESSAGE_ROLE.USER,
              metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
              parts: [{ type: "text", text }],
            },
            seq: 1,
            createdAt: NOW,
            placedAt: NOW,
            tools: [],
          },
          {
            message: {
              id: REPLY,
              role: MESSAGE_ROLE.ASSISTANT,
              metadata: { author: MESSAGE_AUTHOR.BRAIN },
              parts: [{ type: "text", text: "Hello back.", state: "done" }],
            },
            seq: 2,
            createdAt: NOW,
            placedAt: NOW,
            tools: [],
            rating: { rating: MESSAGE_RATING.UP },
          },
        ],
      },
    ],
    next,
    hasMore: false,
  };
}

function ok<Answer>(answer: Answer): ConversationReadResult<Answer> {
  return { ok: true, answer };
}

/** One page of a child's transcript: the hello exchange under the child's own conversation, and whether a page stands past it. */
function childPage(next: string, hasMore: boolean): ConversationMessagesAnswer {
  const page = messagesAnswer("Add a test for the retry.", next);
  return {
    ...page,
    conversations: [{ id: CHILD, kind: CONVERSATION_VIEW_SOURCE.MAIN, openedAt: NOW }],
    groups: page.groups.map((group) => ({ ...group, conversationId: CHILD })),
    hasMore,
  };
}

interface FakeClient extends ConversationReadsClient, ConversationHeadsClient {
  readonly calls: string[];
  changesAnswer: ChangesAnswer | undefined;
  messagesAnswer: ConversationReadResult<ConversationMessagesAnswer>;
  /** A gate a messages read waits at before answering, so a test can hold a poll open. */
  messagesGate: Effect.Effect<void>;
  /** The history pages in the order they are answered, the tail first; the last stands for every read after it. */
  historyAnswers: ConversationReadResult<ConversationHistoryAnswer>[];
  childrenAnswer: ConversationReadResult<ChildrenAnswer>;
  agentsAnswer: ConversationReadResult<AgentsAnswer>;
  /** A child's pages in the order they are answered; the last stands for every read after it. */
  childMessagesAnswers: ConversationReadResult<ConversationMessagesAnswer>[];
  clearAnswer: { opened: string; openedAt: number; cleared: number } | undefined;
  notebookAnswer: NotebookAnswer | undefined;
  rateAnswer: ConversationRateResult;
  /** Every rating request as it left, so a test can read what traveled. */
  readonly rated: { messageId: string; request: HostedMessageRatingRequest }[];
}

function fakeClient(): FakeClient {
  const client: FakeClient = {
    calls: [],
    changesAnswer: undefined,
    messagesAnswer: ok(messagesAnswer("hello")),
    messagesGate: Effect.void,
    historyAnswers: [ok(EMPTY_TAIL)],
    childrenAnswer: ok({ children: [] }),
    agentsAnswer: ok({ agents: [] }),
    childMessagesAnswers: [ok(childPage("child-page-2", true)), ok(childPage("child-end", false))],
    clearAnswer: { opened: "3c000000-0000-4000-8000-000000000009", openedAt: NOW + 1, cleared: 1 },
    notebookAnswer: {
      files: [{ path: "MEMORY.md", content: "# Memory\n", chars: 9, updatedAt: NOW }],
      omittedNotes: 0,
    },
    rateAnswer: { ok: true, answer: { id: RATING_EVENT, seq: 4 } },
    rated: [],
    rate: (messageId, request) =>
      Effect.sync(() => {
        client.calls.push(`rate:${messageId}`);
        client.rated.push({ messageId, request });
        return client.rateAnswer;
      }),
    poll: (request: ChangesRequest) =>
      Effect.sync(() => {
        client.calls.push(`changes:${request.deviceId}`);
        return client.changesAnswer;
      }),
    messages: (page: ReadPageQuery = {}) =>
      Effect.gen(function* () {
        client.calls.push(`messages:${page.after ?? ""}`);
        const answer = client.messagesAnswer;
        yield* client.messagesGate;
        return answer;
      }),
    history: (page: HistoryPageQuery = {}) =>
      Effect.sync(() => {
        client.calls.push(`history:${page.before ?? ""}`);
        const [answer] = client.historyAnswers;
        if (client.historyAnswers.length > 1) client.historyAnswers.shift();
        return answer ?? { ok: false, failure: CONVERSATION_READ_FAILURE.UNANSWERED };
      }),
    childMessages: (childId: string, page: ReadPageQuery = {}) =>
      Effect.sync(() => {
        client.calls.push(`childMessages:${childId}:${page.after ?? ""}`);
        const [answer] = client.childMessagesAnswers;
        if (client.childMessagesAnswers.length > 1) client.childMessagesAnswers.shift();
        return answer ?? { ok: false, failure: CONVERSATION_READ_FAILURE.UNANSWERED };
      }),
    events: (page: ReadPageQuery = {}) =>
      Effect.sync(() => {
        client.calls.push(`events:${page.after ?? ""}`);
        return ok(EMPTY_EVENTS);
      }),
    children: () =>
      Effect.sync(() => {
        client.calls.push("children");
        return client.childrenAnswer;
      }),
    agents: () =>
      Effect.sync(() => {
        client.calls.push("agents");
        return client.agentsAnswer;
      }),
    turns: (page: ReadPageQuery = {}) =>
      Effect.sync(() => {
        client.calls.push(`turns:${page.after ?? ""}`);
        return ok(EMPTY_TURNS);
      }),
    clear: () =>
      Effect.sync(() => {
        client.calls.push("clear");
        return client.clearAnswer;
      }),
    notebook: () =>
      Effect.sync(() => {
        client.calls.push("notebook");
        return client.notebookAnswer;
      }),
  };
  return client;
}

function harness(options: { deviceId?: string; sendsNetwork?: boolean; active?: boolean } = {}) {
  const emitted: { kind: GatewayEventKind; payload: WireValue }[] = [];
  const reports: string[] = [];
  const client = fakeClient();
  const counted: { name: string; properties: WireValue }[] = [];
  let refreshes = 0;
  const composer = composeConversation({
    kernel: {
      runMode: { sendsNetwork: options.sendsNetwork ?? true },
      report: (message) => reports.push(message),
      emit: (kind, payload) => emitted.push({ kind, payload }),
      now: () => NOW,
    },
    settings: {
      recordProductEvent: (name, properties) => {
        counted.push({ name, properties: carried(properties) });
      },
    },
    account: { capabilitiesActive: () => options.active ?? true },
    devices: { deviceId: () => options.deviceId },
    refreshRoster: Effect.sync(() => {
      refreshes += 1;
    }),
    heads: client,
    client,
  });
  const views = () =>
    emitted
      .filter((event) => event.kind === GATEWAY_EVENT.CONVERSATION_VIEW_CHANGED)
      .map((event) => {
        assert.ok(isRecord(event.payload));
        // SAFETY: the composer carries its own snapshot; the test reads it back as the domain type.
        return event.payload as unknown as ConversationViewSnapshot;
      });
  const childrenViews = () =>
    emitted
      .filter((event) => event.kind === GATEWAY_EVENT.CHILDREN_CHANGED)
      .map((event) => {
        assert.ok(isRecord(event.payload));
        // SAFETY: the composer carries its own snapshot; the test reads it back as the domain type.
        return event.payload as unknown as ChildrenSnapshot;
      });
  const agentsViews = () =>
    emitted
      .filter((event) => event.kind === GATEWAY_EVENT.AGENTS_CHANGED)
      .map((event) => {
        assert.ok(isRecord(event.payload));
        // SAFETY: the composer carries its own snapshot; the test reads it back as the domain type.
        return event.payload as unknown as AgentsSnapshot;
      });
  /** Every transcript told: the snapshot, or an empty record where the clients were told none is open. */
  const transcriptViews = () =>
    emitted
      .filter((event) => event.kind === GATEWAY_EVENT.CHILD_TRANSCRIPT_CHANGED)
      .map((event) => {
        assert.ok(isRecord(event.payload));
        // SAFETY: the composer carries its own snapshot; the test reads it back as the domain type.
        return event.payload as unknown as TranscriptSnapshot | Record<string, never>;
      });
  return {
    composer,
    client,
    emitted,
    reports,
    views,
    childrenViews,
    agentsViews,
    transcriptViews,
    counted,
    refreshes: () => refreshes,
  };
}

/** A read method as a client would call it, answered as the record the host carries. */
function callMethod(
  composer: ReturnType<typeof composeConversation>,
  method: GatewayMethod,
  params: WireRecord = {},
) {
  const handler = composer.methods[method];
  assert.ok(handler);
  return handler(params, {
    client: { clientId: "test", role: GATEWAY_CLIENT_ROLE.OPERATOR },
    request: {
      protocolVersion: GATEWAY_PROTOCOL_VERSION,
      method,
      params,
      idempotencyKey: `${method}-1`,
    },
  });
}

function clear(composer: ReturnType<typeof composeConversation>) {
  return Effect.gen(function* () {
    const handler = composer.methods[GATEWAY_METHOD.CONVERSATION_CLEAR];
    assert.ok(handler);
    const result = yield* handler(
      {},
      {
        client: { clientId: "test", role: GATEWAY_CLIENT_ROLE.OPERATOR },
        request: {
          protocolVersion: GATEWAY_PROTOCOL_VERSION,
          method: GATEWAY_METHOD.CONVERSATION_CLEAR,
          params: {},
          idempotencyKey: "clear-1",
        },
      },
    );
    assert.ok(isRecord(result));
    return result.cleared;
  });
}

it.effect(
  "a refresh asked for by a method runs a pass now and answers once it has, and a closed gate answers without reading",
  () =>
    Effect.gen(function* () {
      const { composer, client, views } = harness();
      const handler = composer.methods[GATEWAY_METHOD.CONVERSATION_REFRESH];
      assert.ok(handler);
      const refresh = () =>
        handler(
          {},
          {
            client: { clientId: "test", role: GATEWAY_CLIENT_ROLE.OPERATOR },
            request: {
              protocolVersion: GATEWAY_PROTOCOL_VERSION,
              method: GATEWAY_METHOD.CONVERSATION_REFRESH,
              params: {},
            },
          },
        );
      assert.deepEqual(yield* refresh(), {});
      assert.deepEqual(client.calls, [
        "history:",
        "messages:",
        "events:",
        "turns:",
        "children",
        "agents",
      ]);
      assert.equal(views().length, 1);

      const closed = harness({ active: false });
      const closedHandler = closed.composer.methods[GATEWAY_METHOD.CONVERSATION_REFRESH];
      assert.ok(closedHandler);
      yield* closedHandler(
        {},
        {
          client: { clientId: "test", role: GATEWAY_CLIENT_ROLE.OPERATOR },
          request: {
            protocolVersion: GATEWAY_PROTOCOL_VERSION,
            method: GATEWAY_METHOD.CONVERSATION_REFRESH,
            params: {},
          },
        },
      );
      assert.deepEqual(closed.client.calls, []);
    }),
);

it.effect(
  "without a device row a poll reads every resource, and tells every client once when the picture moved",
  () =>
    Effect.gen(function* () {
      const { composer, client, views } = harness();
      assert.deepEqual(composer.snapshot(), { groups: [], settled: false });
      yield* composer.loop.refresh;
      // The tail first, whose empty head anchors the forward cursor, then forward from it.
      assert.deepEqual(client.calls, [
        "history:",
        "messages:",
        "events:",
        "turns:",
        "children",
        "agents",
      ]);
      assert.equal(views().length, 1);
      const [view] = views();
      assert.equal(view?.settled, true);
      assert.equal(view?.groups.length, 1);
      assert.equal(view?.groups[0]?.turnId, TURN);
      // The same answers again move nothing, and nothing is told.
      yield* composer.loop.refresh;
      assert.equal(views().length, 1);
      assert.deepEqual(client.calls.slice(6), [
        "messages:messages-head",
        "events:events-head",
        "turns:",
        "children",
        "agents",
      ]);
    }),
);

it.effect("with a device row the change signal decides which resources are read", () =>
  Effect.gen(function* () {
    const { composer, client } = harness({ deviceId: DEVICE });
    client.changesAnswer = { seen: true, messages: "messages-head", events: "events-head" };
    yield* composer.loop.refresh;
    // Nothing held yet, so each head differs from the cursor and is read once; an
    // account with no turn has no turns head, and nothing is read for it; the
    // children list is read once so a signal naming no child still settles it.
    assert.deepEqual(client.calls, [
      `changes:${DEVICE}`,
      "history:",
      "messages:",
      "events:",
      "children",
      "agents",
    ]);
    client.calls.length = 0;
    yield* composer.loop.refresh;
    // Every cursor now equals its head: only the signal travels.
    assert.deepEqual(client.calls, [`changes:${DEVICE}`]);
    client.changesAnswer = {
      seen: true,
      messages: "messages-moved",
      events: "events-head",
      turns: "turns-head",
    };
    client.calls.length = 0;
    yield* composer.loop.refresh;
    assert.deepEqual(client.calls, [`changes:${DEVICE}`, "messages:messages-head", "turns:"]);
  }),
);

it.effect("an unreadable row is surfaced on the snapshot and never drawn as an empty page", () =>
  Effect.gen(function* () {
    const { composer, client, views } = harness();
    yield* composer.loop.refresh;
    client.messagesAnswer = {
      ok: false,
      failure: CONVERSATION_READ_FAILURE.UNREADABLE_ROW,
      row: { conversationId: MAIN, seq: 7 },
    };
    yield* composer.loop.refresh;
    const latest = views().at(-1);
    assert.deepEqual(latest?.unreadable, { conversationId: MAIN, seq: 7 });
    // The thread stands as it was last read.
    assert.equal(latest?.groups.length, 1);
    assert.equal(composer.snapshot().unreadable?.seq, 7);
  }),
);

it.effect("an accepted create_workspace result with a created session pokes a roster refresh", () =>
  Effect.gen(function* () {
    const { composer, client, refreshes } = harness();
    const answer = messagesAnswer("hello");
    const [group] = answer.groups;
    const [ask, reply] = group?.messages ?? [];
    assert.ok(group && ask && reply);
    client.messagesAnswer = ok({
      ...answer,
      groups: [
        {
          ...group,
          messages: [
            ask,
            {
              ...reply,
              message: {
                ...reply.message,
                parts: [
                  {
                    type: "tool-create_workspace",
                    toolCallId: "call_workspace_1",
                    state: "output-available",
                    input: { provider_id: "conductor", name: "Checkout" },
                    output: {
                      status: ACTION_OUTPUT_STATUS.ACCEPTED,
                      target: { providerId: "conductor" },
                      createdSession: {
                        providerId: "conductor",
                        providerSessionId: "workspace-created",
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    yield* composer.loop.refresh;
    assert.equal(refreshes(), 1);
  }),
);

/** The hello answer with one more assistant row after the reply, carrying the given parts, and a page after it. */
function withThirdRow(parts: WireValue[]): ConversationMessagesAnswer {
  const answer = messagesAnswer("hello");
  const [group] = answer.groups;
  assert.ok(group);
  return {
    ...answer,
    groups: [
      {
        ...group,
        messages: [
          ...group.messages,
          {
            message: {
              id: "2b000000-0000-4000-8000-000000000003",
              role: MESSAGE_ROLE.ASSISTANT,
              metadata: { author: MESSAGE_AUTHOR.BRAIN },
              parts,
            },
            seq: 3,
            createdAt: NOW + 1,
            placedAt: NOW + 1,
            tools: [],
          },
        ],
      },
    ],
    hasMore: true,
  };
}

it.effect(
  "a page this build's registry refuses is named on the snapshot like a row the service could not read, and paging stops at it",
  () =>
    Effect.gen(function* () {
      const { composer, client, views, reports } = harness();
      // A registered tool whose input its schema will not admit: the one refusal a retirement does not explain.
      client.messagesAnswer = ok(
        withThirdRow([
          {
            type: "tool-read_transcript",
            toolCallId: "call_1",
            state: "output-error",
            input: { provider_id: 7 },
            errorText: "refused",
          },
        ]),
      );
      yield* composer.loop.refresh;
      assert.deepEqual(composer.snapshot().unreadable, { conversationId: MAIN, seq: 3 });
      assert.deepEqual(views().at(-1)?.unreadable, { conversationId: MAIN, seq: 3 });
      // One read, not a walk: the cursor did not pass the row and no page after it was asked for.
      assert.deepEqual(client.calls, [
        "history:",
        "messages:",
        "events:",
        "turns:",
        "children",
        "agents",
      ]);
      assert.equal(reports.length, 1);
    }),
);

it.effect(
  "a row naming a tool this build does not register is drawn without that part, and paging goes on past it",
  () =>
    Effect.gen(function* () {
      const { composer, client, reports } = harness();
      const said = { type: "text", text: "Retired, but the rest stands.", state: "done" };
      client.messagesAnswer = ok(
        withThirdRow([
          {
            type: "tool-tool_this_build_never_registered",
            toolCallId: "call_1",
            state: "output-available",
            input: {},
            output: {},
          },
          said,
        ]),
      );
      yield* composer.loop.refresh;
      assert.equal(composer.snapshot().unreadable, undefined);
      const third = composer
        .snapshot()
        .groups.flatMap((group) => group.messages)
        .find((message) => message.seq === 3);
      assert.deepEqual(third?.message.parts, [said]);
      // The walk went on: the page said it had more, and the next page was asked for.
      assert.ok(client.calls.filter((call) => call.startsWith("messages:")).length > 1);
      assert.deepEqual(reports, []);
    }),
);

it.effect(
  "Clear carries the service's soft delete and reads again at once; a Clear the service did not take answers false",
  () =>
    Effect.gen(function* () {
      const { composer, client } = harness();
      yield* composer.loop.refresh;
      client.messagesAnswer = ok({
        conversations: [
          {
            id: "3c000000-0000-4000-8000-000000000009",
            kind: CONVERSATION_VIEW_SOURCE.MAIN,
            openedAt: NOW + 1,
          },
        ],
        groups: [],
        next: "after-clear",
        hasMore: false,
      });
      client.calls.length = 0;
      assert.equal(yield* clear(composer), true);
      assert.equal(client.calls[0], "clear");
      assert.ok(client.calls.includes("messages:messages-head"));
      assert.deepEqual(composer.snapshot().groups, []);
      client.clearAnswer = undefined;
      assert.equal(yield* clear(composer), false);
    }),
);

it.effect(
  "a Clear answers only after a poll that began after it has published, even with a poll already under way",
  () =>
    Effect.gen(function* () {
      const { composer, client, views } = harness();
      yield* composer.loop.refresh;
      assert.equal(views().at(-1)?.groups.length, 1);
      // A poll reads the thread as it stood before the Clear and is held there.
      const gate = yield* Deferred.make<void>();
      client.messagesGate = Deferred.await(gate);
      client.messagesAnswer = ok(messagesAnswer("hello", "messages-later"));
      const held = yield* Effect.forkChild(composer.loop.refresh, { startImmediately: true });
      // The Clear lands while that poll is out, and the service now lists a new, empty main.
      const emptied = ok({
        conversations: [
          {
            id: "3c000000-0000-4000-8000-000000000009",
            kind: CONVERSATION_VIEW_SOURCE.MAIN,
            openedAt: NOW + 1,
          },
        ],
        groups: [],
        next: "after-clear",
        hasMore: false,
      });
      const clearing = yield* Effect.forkChild(
        Effect.map(clear(composer), (cleared) => {
          assert.equal(cleared, true);
          // Whatever the held poll published, the answer waited for a pass that read after the Clear.
          assert.deepEqual(composer.snapshot().groups, []);
          assert.deepEqual(views().at(-1)?.groups, []);
        }),
        { startImmediately: true },
      );
      client.messagesAnswer = emptied;
      client.messagesGate = Effect.void;
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(held);
      yield* Fiber.join(clearing);
    }),
);

it.effect(
  "a Clear the service took empties the picture even when the read after it does not land, and a pass that read before it cannot bring the thread back",
  () =>
    Effect.gen(function* () {
      const { composer, client, views } = harness();
      yield* composer.loop.refresh;
      assert.equal(views().at(-1)?.groups.length, 1);
      // A pass read the pre-Clear page and is held there; it lands after the Clear.
      const gate = yield* Deferred.make<void>();
      client.messagesGate = Deferred.await(gate);
      client.messagesAnswer = ok(messagesAnswer("hello", "messages-later"));
      const held = yield* Effect.forkChild(composer.loop.refresh, { startImmediately: true });
      const clearing = yield* Effect.forkChild(clear(composer), { startImmediately: true });
      // Every read after the Clear fails.
      client.messagesAnswer = { ok: false, failure: CONVERSATION_READ_FAILURE.UNANSWERED };
      client.messagesGate = Effect.void;
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(held);
      assert.equal(yield* Fiber.join(clearing), true);
      assert.deepEqual(composer.snapshot().groups, []);
      assert.deepEqual(views().at(-1)?.groups, []);
    }),
);

it.effect(
  "a refusal from a pass that read before the Clear is not written over the cleared thread",
  () =>
    Effect.gen(function* () {
      const { composer, client } = harness();
      yield* composer.loop.refresh;
      const gate = yield* Deferred.make<void>();
      client.messagesGate = Deferred.await(gate);
      // The pass out before the Clear comes back naming a row of the stamped main.
      client.messagesAnswer = {
        ok: false,
        failure: CONVERSATION_READ_FAILURE.UNREADABLE_ROW,
        row: { conversationId: MAIN, seq: 7 },
      };
      const held = yield* Effect.forkChild(composer.loop.refresh, { startImmediately: true });
      const clearing = yield* Effect.forkChild(clear(composer), { startImmediately: true });
      // The reads after the Clear answer nothing, so the only refusal is the stale one.
      client.messagesAnswer = { ok: false, failure: CONVERSATION_READ_FAILURE.UNANSWERED };
      client.messagesGate = Effect.void;
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(held);
      assert.equal(yield* Fiber.join(clearing), true);
      assert.equal(composer.snapshot().unreadable, undefined);
      assert.deepEqual(composer.snapshot().groups, []);
    }),
);

it.effect(
  "a run that sends nothing polls nothing and is settled from the start, and a closed gate refuses Clear",
  () =>
    Effect.gen(function* () {
      const fixture = harness({ sendsNetwork: false });
      yield* fixture.composer.loop.refresh;
      assert.deepEqual(fixture.client.calls, []);
      assert.deepEqual(fixture.composer.snapshot(), { groups: [], settled: true });
      assert.equal(yield* clear(fixture.composer), false);
      const signedOut = harness({ active: false });
      yield* signedOut.composer.loop.refresh;
      assert.deepEqual(signedOut.client.calls, []);
      assert.equal(yield* clear(signedOut.composer), false);
    }),
);

it.effect("a reset drops everything held and tells every client the thread is gone", () =>
  Effect.gen(function* () {
    const { composer, views } = harness();
    yield* composer.loop.refresh;
    assert.equal(views().length, 1);
    composer.reset();
    assert.equal(views().length, 2);
    assert.deepEqual(views().at(-1), { groups: [], settled: false });
  }),
);

/** The method as a client would call it; a test reads the outcome for itself. */
function rateOutcome(composer: ReturnType<typeof composeConversation>, params: WireValue) {
  const handler = composer.methods[GATEWAY_METHOD.CONVERSATION_RATE_MESSAGE];
  assert.ok(handler);
  return Effect.exit(
    handler(
      // SAFETY: the test hands the handler the params a client would; the handler's own schema is the boundary.
      params as Parameters<typeof handler>[0],
      {
        client: { clientId: "test", role: GATEWAY_CLIENT_ROLE.OPERATOR },
        request: {
          protocolVersion: GATEWAY_PROTOCOL_VERSION,
          method: GATEWAY_METHOD.CONVERSATION_RATE_MESSAGE,
          params: {},
          idempotencyKey: "rate-1",
        },
      },
    ),
  );
}

function rate(
  composer: ReturnType<typeof composeConversation>,
  params: WireValue,
): Effect.Effect<WireValue | undefined> {
  return Effect.map(rateOutcome(composer, params), (outcome) => {
    assert.ok(Exit.isSuccess(outcome));
    return outcome.value;
  });
}

it.effect("the rating a read carries on a message reaches the picture", () =>
  Effect.gen(function* () {
    const { composer } = harness();
    yield* composer.loop.refresh;
    const [group] = composer.snapshot().groups;
    assert.deepEqual(
      group?.messages.map((message) => message.rating),
      [undefined, { rating: MESSAGE_RATING.UP }],
    );
  }),
);

it.effect(
  "a rating on one of Luke's messages travels to the service with this device's id, shows at once, and is counted by verdict and kind alone",
  () =>
    Effect.gen(function* () {
      const { composer, client, views, counted } = harness({ deviceId: DEVICE });
      client.changesAnswer = { seen: true, messages: "messages-head", events: "events-head" };
      yield* composer.loop.refresh;
      const published = views().length;
      const answer = yield* rate(composer, { messageId: REPLY, rating: MESSAGE_RATING.DOWN });
      assert.deepEqual(answer, { status: CONVERSATION_RATE_STATUS.RATED });
      assert.deepEqual(client.rated, [
        { messageId: REPLY, request: { rating: MESSAGE_RATING.DOWN, deviceId: DEVICE } },
      ]);
      // The verdict shows from the answer, before any poll reads it back.
      assert.equal(views().length, published + 1);
      const [group] = composer.snapshot().groups;
      assert.deepEqual(group?.messages[1]?.rating, { rating: MESSAGE_RATING.DOWN });
      assert.deepEqual(counted, [
        {
          name: PRODUCT_EVENT.CONVERSATION_RATED,
          properties: {
            rating: MESSAGE_RATING.DOWN,
            message_kind: PRODUCT_RATED_MESSAGE_KIND.REPLY,
          },
        },
      ]);
    }),
);

it.effect(
  "taking a verdict back travels the same way, unrates the message at once, and is counted as its own word",
  () =>
    Effect.gen(function* () {
      const { composer, client, counted } = harness({ deviceId: DEVICE });
      client.changesAnswer = { seen: true, messages: "messages-head", events: "events-head" };
      yield* composer.loop.refresh;
      assert.deepEqual(composer.snapshot().groups[0]?.messages[1]?.rating, {
        rating: MESSAGE_RATING.UP,
      });
      const answer = yield* rate(composer, { messageId: REPLY, rating: RATING_WORD.WITHDRAWN });
      assert.deepEqual(answer, { status: CONVERSATION_RATE_STATUS.RATED });
      assert.deepEqual(client.rated, [
        { messageId: REPLY, request: { rating: RATING_WORD.WITHDRAWN, deviceId: DEVICE } },
      ]);
      // The thumb comes off from the answer, before any poll reads the withdrawal back.
      assert.equal(composer.snapshot().groups[0]?.messages[1]?.rating, undefined);
      assert.deepEqual(counted, [
        {
          name: PRODUCT_EVENT.CONVERSATION_RATED,
          properties: {
            rating: RATING_WORD.WITHDRAWN,
            message_kind: PRODUCT_RATED_MESSAGE_KIND.REPLY,
          },
        },
      ]);
    }),
);

it.effect(
  "a rating is refused before it travels where the device has no row, the gate is closed, or the message is not one of Luke's this device holds",
  () =>
    Effect.gen(function* () {
      const noDevice = harness();
      yield* noDevice.composer.loop.refresh;
      assert.deepEqual(
        yield* rate(noDevice.composer, { messageId: REPLY, rating: MESSAGE_RATING.UP }),
        {
          status: CONVERSATION_RATE_STATUS.UNAVAILABLE,
        },
      );

      const closed = harness({ deviceId: DEVICE, active: false });
      assert.deepEqual(
        yield* rate(closed.composer, { messageId: REPLY, rating: MESSAGE_RATING.UP }),
        {
          status: CONVERSATION_RATE_STATUS.UNAVAILABLE,
        },
      );

      const held = harness({ deviceId: DEVICE });
      yield* held.composer.loop.refresh;
      // The developer's own ask, and a message this device never read.
      assert.deepEqual(yield* rate(held.composer, { messageId: ASK, rating: MESSAGE_RATING.UP }), {
        status: CONVERSATION_RATE_STATUS.NOT_FOUND,
      });
      assert.deepEqual(
        yield* rate(held.composer, {
          messageId: "2b000000-0000-4000-8000-000000000099",
          rating: MESSAGE_RATING.UP,
        }),
        { status: CONVERSATION_RATE_STATUS.NOT_FOUND },
      );
      assert.deepEqual(
        [noDevice, closed, held].flatMap((each) => each.client.rated),
        [],
      );
      assert.deepEqual(
        [noDevice, closed, held].flatMap((each) => each.counted),
        [],
      );
    }),
);

it.effect(
  "the service's refusals reach the control apart, leave the verdict as it was, and count nothing",
  () =>
    Effect.gen(function* () {
      const { composer, client, counted } = harness({ deviceId: DEVICE });
      yield* composer.loop.refresh;
      const before = composer.snapshot();
      client.rateAnswer = { ok: false, refusal: CONVERSATION_RATE_REFUSAL.NOT_RATEABLE };
      assert.deepEqual(yield* rate(composer, { messageId: REPLY, rating: MESSAGE_RATING.DOWN }), {
        status: CONVERSATION_RATE_STATUS.NOT_RATEABLE,
      });
      client.rateAnswer = { ok: false, refusal: CONVERSATION_RATE_REFUSAL.NOT_FOUND };
      assert.deepEqual(yield* rate(composer, { messageId: REPLY, rating: MESSAGE_RATING.DOWN }), {
        status: CONVERSATION_RATE_STATUS.NOT_FOUND,
      });
      client.rateAnswer = { ok: false, refusal: CONVERSATION_RATE_REFUSAL.UNANSWERED };
      assert.deepEqual(yield* rate(composer, { messageId: REPLY, rating: MESSAGE_RATING.DOWN }), {
        status: CONVERSATION_RATE_STATUS.UNAVAILABLE,
      });
      assert.deepEqual(composer.snapshot(), before);
      assert.deepEqual(counted, []);
    }),
);

it.effect(
  "a rating whose params are not one message and one verdict is refused as invalid before anything is read",
  () =>
    Effect.gen(function* () {
      const { composer, client } = harness({ deviceId: DEVICE });
      yield* composer.loop.refresh;
      const outcome = yield* rateOutcome(composer, { messageId: REPLY, rating: "sideways" });
      assert.ok(Exit.isFailure(outcome));
      assert.deepEqual(
        outcome.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error.code),
        [GATEWAY_ERROR.INVALID_PARAMS],
      );
      assert.deepEqual(client.rated, []);
    }),
);

/** The notebook read as a client would call it, answered as the record the host carries. */
function readNotebook(composer: ReturnType<typeof composeConversation>) {
  const handler = composer.methods[GATEWAY_METHOD.NOTEBOOK_READ];
  assert.ok(handler);
  return handler(
    {},
    {
      client: { clientId: "test", role: GATEWAY_CLIENT_ROLE.OPERATOR },
      request: {
        protocolVersion: GATEWAY_PROTOCOL_VERSION,
        method: GATEWAY_METHOD.NOTEBOOK_READ,
        params: {},
      },
    },
  );
}

it.effect(
  "the notebook read carries the service's own record, and answers empty behind a closed gate or an unanswered call",
  () =>
    Effect.gen(function* () {
      const { composer, client } = harness();
      assert.deepEqual(yield* readNotebook(composer), client.notebookAnswer);
      assert.deepEqual(client.calls, ["notebook"]);

      // The service did not answer: an empty record, which the client reads as
      // unreadable just now rather than as a notebook with nothing in it.
      client.notebookAnswer = undefined;
      assert.deepEqual(yield* readNotebook(composer), {});

      // A run that sends nothing, or an account whose capabilities are down,
      // never asks at all.
      const offline = harness({ sendsNetwork: false });
      assert.deepEqual(yield* readNotebook(offline.composer), {});
      const signedOut = harness({ active: false });
      assert.deepEqual(yield* readNotebook(signedOut.composer), {});
      assert.deepEqual(offline.client.calls, []);
      assert.deepEqual(signedOut.client.calls, []);
    }),
);

it.effect(
  "the children list is read once before any head is held, then only when the head moves, and told as its own snapshot when it differs",
  () =>
    Effect.gen(function* () {
      const { composer, client, childrenViews } = harness({ deviceId: DEVICE });
      client.changesAnswer = { seen: true, messages: "messages-head", events: "events-head" };
      assert.deepEqual(composer.childrenSnapshot(), { settled: false, children: [] });
      yield* composer.loop.refresh;
      // A signal naming no child still settles the list, once.
      assert.ok(client.calls.includes("children"));
      assert.deepEqual(childrenViews(), [{ settled: true, children: [] }]);
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [`changes:${DEVICE}`]);

      // A child opens: the head moves, the list is read, and the clients are told.
      client.changesAnswer = { ...client.changesAnswer, children: "children-1" };
      client.childrenAnswer = ok({ children: [CHILD_ROW] });
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [`changes:${DEVICE}`, "children"]);
      assert.deepEqual(childrenViews().at(-1), { settled: true, children: [CHILD_ROW] });
      assert.deepEqual(composer.childrenSnapshot(), { settled: true, children: [CHILD_ROW] });

      // The same head travels alone; a moved head that answers the same list tells nobody.
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [`changes:${DEVICE}`]);
      client.changesAnswer = { ...client.changesAnswer, children: "children-2" };
      yield* composer.loop.refresh;
      assert.ok(client.calls.includes("children"));
      assert.equal(childrenViews().length, 2);

      // A read that did not land leaves the head where it was, so the next poll asks again.
      client.changesAnswer = { ...client.changesAnswer, children: "children-3" };
      client.childrenAnswer = { ok: false, failure: CONVERSATION_READ_FAILURE.UNANSWERED };
      yield* composer.loop.refresh;
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [`changes:${DEVICE}`, "children"]);
    }),
);

it.effect(
  "an opened child's transcript is read to its end at once, read again from its cursor when the children head moves, and closing stops the reads",
  () =>
    Effect.gen(function* () {
      const { composer, client, transcriptViews } = harness({ deviceId: DEVICE });
      client.changesAnswer = {
        seen: true,
        messages: "messages-head",
        events: "events-head",
        children: "children-1",
      };
      client.childrenAnswer = ok({ children: [SETTLED_CHILD_ROW] });
      yield* composer.loop.refresh;
      assert.equal(composer.childTranscriptSnapshot(), undefined);
      assert.deepEqual(transcriptViews(), []);

      client.calls.length = 0;
      assert.deepEqual(
        yield* callMethod(composer, GATEWAY_METHOD.CONVERSATION_OPEN_CHILD_TRANSCRIPT, {
          conversationId: CHILD,
          kind: TRANSCRIPT_KIND.CHILD,
        }),
        { opened: true },
      );
      // Two pages, walked to the end in the pass the open asked for.
      assert.deepEqual(
        client.calls.filter((call) => call.startsWith("childMessages:")),
        [`childMessages:${CHILD}:`, `childMessages:${CHILD}:child-page-2`],
      );
      // The clients were told at once that it is open and empty, then what it holds.
      const [opened, filled] = transcriptViews();
      assert.deepEqual(opened, {
        conversationId: CHILD,
        kind: TRANSCRIPT_KIND.CHILD,
        groups: [],
        settled: false,
      });
      assert.equal(filled?.conversationId, CHILD);
      assert.equal(filled?.settled, true);
      assert.equal(filled?.groups.length, 1);
      assert.equal(filled?.groups[0]?.turnId, TURN);
      assert.deepEqual(composer.childTranscriptSnapshot(), filled);

      // A poll under the same head reads nothing of the child.
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [`changes:${DEVICE}`]);

      // The head moves: the list and the transcript are read again, the transcript from where it stood.
      client.changesAnswer = { ...client.changesAnswer, children: "children-2" };
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [
        `changes:${DEVICE}`,
        "children",
        `childMessages:${CHILD}:child-end`,
      ]);
      // The same rows again moved nothing, and nobody was told.
      assert.equal(transcriptViews().length, 2);

      // A walk cut short — a page landed, the read after it did not — is resumed
      // on the next poll under an unchanged head, from where it stood.
      client.changesAnswer = { ...client.changesAnswer, children: "children-3" };
      client.childMessagesAnswers = [
        ok(childPage("child-page-4", true)),
        { ok: false, failure: CONVERSATION_READ_FAILURE.UNANSWERED },
        ok(childPage("child-end-2", false)),
      ];
      yield* composer.loop.refresh;
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [`changes:${DEVICE}`, `childMessages:${CHILD}:child-page-4`]);
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [`changes:${DEVICE}`]);

      // Closed: the clients are told none is open, and the next head does not read it.
      assert.deepEqual(
        yield* callMethod(composer, GATEWAY_METHOD.CONVERSATION_CLOSE_CHILD_TRANSCRIPT),
        {},
      );
      assert.deepEqual(transcriptViews().at(-1), {});
      assert.equal(composer.childTranscriptSnapshot(), undefined);
      client.changesAnswer = { ...client.changesAnswer, children: "children-4" };
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [`changes:${DEVICE}`, "children"]);
    }),
);

it.effect(
  "an open transcript whose turn is under way is read on every poll, and follows the head alone once the turn settles",
  () =>
    Effect.gen(function* () {
      const { composer, client, transcriptViews } = harness({ deviceId: DEVICE });
      client.changesAnswer = {
        seen: true,
        messages: "messages-head",
        events: "events-head",
        children: "children-1",
        agents: "agents-1",
      };
      client.childrenAnswer = ok({ children: [CHILD_ROW] });
      client.agentsAnswer = ok({ agents: [AGENT_ROW] });
      client.childMessagesAnswers = [ok(childPage("child-end", false))];
      yield* composer.loop.refresh;
      yield* callMethod(composer, GATEWAY_METHOD.CONVERSATION_OPEN_CHILD_TRANSCRIPT, {
        conversationId: CHILD,
        kind: TRANSCRIPT_KIND.CHILD,
      });
      const told = transcriptViews().length;

      // The rows a running turn writes move no head, so a poll under an unchanged
      // signal still reads the transcript from where it stood; the same page
      // again moves nothing, and nobody is told.
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [`changes:${DEVICE}`, `childMessages:${CHILD}:child-end`]);
      assert.equal(transcriptViews().length, told);

      // The turn settles: the head moves with it, the list and the transcript are
      // read once more, and the poll after reads nothing of a settled row.
      client.changesAnswer = { ...client.changesAnswer, children: "children-2" };
      client.childrenAnswer = ok({ children: [SETTLED_CHILD_ROW] });
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [
        `changes:${DEVICE}`,
        "children",
        `childMessages:${CHILD}:child-end`,
      ]);
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [`changes:${DEVICE}`]);

      // An observed session's transcript is followed by its own list's row, on
      // the same terms: a queued turn, accepted and not yet running, counts as
      // under way.
      client.childMessagesAnswers = [ok(childPage("agent-end", false))];
      yield* callMethod(composer, GATEWAY_METHOD.CONVERSATION_OPEN_CHILD_TRANSCRIPT, {
        conversationId: AGENT,
        kind: TRANSCRIPT_KIND.OBSERVED,
      });
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [`changes:${DEVICE}`]);
      client.changesAnswer = { ...client.changesAnswer, agents: "agents-2" };
      const { startedAt: _started, settledAt: _settled, ...queued } = AGENT_ROW;
      client.agentsAnswer = ok({ agents: [{ ...queued, status: CHILD_STATUS.ACCEPTED }] });
      yield* composer.loop.refresh;
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [`changes:${DEVICE}`, `childMessages:${AGENT}:agent-end`]);
    }),
);

it.effect(
  "opening another child replaces the one open, a page out for the replaced child is dropped, and a closed gate holds nothing",
  () =>
    Effect.gen(function* () {
      const { composer, client, transcriptViews } = harness({ deviceId: DEVICE });
      client.changesAnswer = { seen: true, messages: "messages-head", events: "events-head" };
      yield* composer.loop.refresh;
      yield* callMethod(composer, GATEWAY_METHOD.CONVERSATION_OPEN_CHILD_TRANSCRIPT, {
        conversationId: CHILD,
        kind: TRANSCRIPT_KIND.CHILD,
      });
      assert.equal(composer.childTranscriptSnapshot()?.conversationId, CHILD);
      // The same child again is already open: nothing is re-read.
      client.calls.length = 0;
      yield* callMethod(composer, GATEWAY_METHOD.CONVERSATION_OPEN_CHILD_TRANSCRIPT, {
        conversationId: CHILD,
        kind: TRANSCRIPT_KIND.CHILD,
      });
      assert.deepEqual(client.calls, [`changes:${DEVICE}`]);

      client.childMessagesAnswers = [ok(childPage("other-end", false))];
      yield* callMethod(composer, GATEWAY_METHOD.CONVERSATION_OPEN_CHILD_TRANSCRIPT, {
        conversationId: OTHER_CHILD,
        kind: TRANSCRIPT_KIND.CHILD,
      });
      assert.equal(composer.childTranscriptSnapshot()?.conversationId, OTHER_CHILD);
      assert.deepEqual(transcriptViews().at(-1)?.conversationId, OTHER_CHILD);
      assert.ok(client.calls.includes(`childMessages:${OTHER_CHILD}:`));

      // A pass out for the first child lands after the second opened: its page is nobody's.
      const gate = yield* Deferred.make<void>();
      client.messagesGate = Deferred.await(gate);
      client.changesAnswer = { ...client.changesAnswer, messages: "messages-moved" };
      const held = yield* Effect.forkChild(composer.loop.refresh, { startImmediately: true });
      yield* callMethod(composer, GATEWAY_METHOD.CONVERSATION_CLOSE_CHILD_TRANSCRIPT);
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(held);
      assert.equal(composer.childTranscriptSnapshot(), undefined);
      assert.deepEqual(transcriptViews().at(-1), {});

      const closed = harness({ active: false });
      assert.deepEqual(
        yield* callMethod(closed.composer, GATEWAY_METHOD.CONVERSATION_OPEN_CHILD_TRANSCRIPT, {
          conversationId: CHILD,
          kind: TRANSCRIPT_KIND.CHILD,
        }),
        { opened: false },
      );
      assert.deepEqual(closed.client.calls, []);
      assert.equal(closed.composer.childTranscriptSnapshot(), undefined);
      const offline = harness({ sendsNetwork: false });
      assert.deepEqual(offline.composer.childrenSnapshot(), { settled: true, children: [] });
    }),
);

it.effect(
  "a Clear closes the open transcript at once, and a list that no longer names the open child closes it too",
  () =>
    Effect.gen(function* () {
      const { composer, client, transcriptViews } = harness({ deviceId: DEVICE });
      client.changesAnswer = {
        seen: true,
        messages: "messages-head",
        events: "events-head",
        children: "children-1",
      };
      client.childrenAnswer = ok({ children: [CHILD_ROW] });
      yield* composer.loop.refresh;
      yield* callMethod(composer, GATEWAY_METHOD.CONVERSATION_OPEN_CHILD_TRANSCRIPT, {
        conversationId: CHILD,
        kind: TRANSCRIPT_KIND.CHILD,
      });
      assert.equal(composer.childTranscriptSnapshot()?.conversationId, CHILD);
      // The Clear stamps the child; the transcript is dropped on the answer, before any read.
      client.messagesAnswer = { ok: false, failure: CONVERSATION_READ_FAILURE.UNANSWERED };
      assert.equal(yield* clear(composer), true);
      assert.equal(composer.childTranscriptSnapshot(), undefined);
      assert.deepEqual(transcriptViews().at(-1), {});

      // Opened again, then stamped on another Mac: the list read that no longer
      // names it closes it, and the next poll reads nothing of it.
      client.messagesAnswer = ok(messagesAnswer("hello"));
      client.childMessagesAnswers = [ok(childPage("child-end", false))];
      yield* callMethod(composer, GATEWAY_METHOD.CONVERSATION_OPEN_CHILD_TRANSCRIPT, {
        conversationId: CHILD,
        kind: TRANSCRIPT_KIND.CHILD,
      });
      assert.equal(composer.childTranscriptSnapshot()?.conversationId, CHILD);
      client.changesAnswer = { ...client.changesAnswer, children: "children-2" };
      client.childrenAnswer = ok({ children: [] });
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [`changes:${DEVICE}`, "children"]);
      assert.equal(composer.childTranscriptSnapshot(), undefined);
      assert.deepEqual(transcriptViews().at(-1), {});
    }),
);

it.effect(
  "the agents list is read once before any head is held, then only when the agents head moves, and told as its own snapshot when it differs",
  () =>
    Effect.gen(function* () {
      const { composer, client, agentsViews } = harness({ deviceId: DEVICE });
      client.changesAnswer = { seen: true, messages: "messages-head", events: "events-head" };
      assert.deepEqual(composer.agentsSnapshot(), { settled: false, agents: [] });
      yield* composer.loop.refresh;
      // A signal naming no agent still settles the list, once.
      assert.ok(client.calls.includes("agents"));
      assert.deepEqual(agentsViews(), [{ settled: true, agents: [] }]);
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [`changes:${DEVICE}`]);

      // The agents head moves alone: the agents list is read, and not the children's.
      client.changesAnswer = { ...client.changesAnswer, agents: "agents-1" };
      client.agentsAnswer = ok({ agents: [AGENT_ROW] });
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [`changes:${DEVICE}`, "agents"]);
      assert.deepEqual(agentsViews().at(-1), { settled: true, agents: [AGENT_ROW] });
      assert.deepEqual(composer.agentsSnapshot(), { settled: true, agents: [AGENT_ROW] });

      // A moved head that answers the same list tells nobody; a read that did
      // not land leaves the head where it was, so the next poll asks again.
      client.changesAnswer = { ...client.changesAnswer, agents: "agents-2" };
      yield* composer.loop.refresh;
      assert.equal(agentsViews().length, 2);
      client.changesAnswer = { ...client.changesAnswer, agents: "agents-3" };
      client.agentsAnswer = { ok: false, failure: CONVERSATION_READ_FAILURE.UNANSWERED };
      yield* composer.loop.refresh;
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [`changes:${DEVICE}`, "agents"]);
    }),
);

it.effect(
  "an observed transcript is paged from the same read, follows the agents head and not the children's, and closes when the agents list no longer names it",
  () =>
    Effect.gen(function* () {
      const { composer, client, transcriptViews } = harness({ deviceId: DEVICE });
      client.changesAnswer = {
        seen: true,
        messages: "messages-head",
        events: "events-head",
        children: "children-1",
        agents: "agents-1",
      };
      client.agentsAnswer = ok({ agents: [AGENT_ROW] });
      client.childMessagesAnswers = [ok(childPage("agent-end", false))];
      yield* composer.loop.refresh;

      client.calls.length = 0;
      assert.deepEqual(
        yield* callMethod(composer, GATEWAY_METHOD.CONVERSATION_OPEN_CHILD_TRANSCRIPT, {
          conversationId: AGENT,
          kind: TRANSCRIPT_KIND.OBSERVED,
        }),
        { opened: true },
      );
      assert.deepEqual(
        client.calls.filter((call) => call.startsWith("childMessages:")),
        [`childMessages:${AGENT}:`],
      );
      assert.deepEqual(transcriptViews()[0], {
        conversationId: AGENT,
        kind: TRANSCRIPT_KIND.OBSERVED,
        groups: [],
        settled: false,
      });
      assert.equal(composer.childTranscriptSnapshot()?.kind, TRANSCRIPT_KIND.OBSERVED);
      assert.equal(composer.childTranscriptSnapshot()?.groups.length, 1);

      // The children head moving reads the children list and nothing of this transcript.
      client.changesAnswer = { ...client.changesAnswer, children: "children-2" };
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [`changes:${DEVICE}`, "children"]);

      // The agents head moving reads the list and the transcript again, from where it stood.
      client.changesAnswer = { ...client.changesAnswer, agents: "agents-2" };
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [
        `changes:${DEVICE}`,
        "agents",
        `childMessages:${AGENT}:agent-end`,
      ]);

      // The children list letting go of every child closes nothing of it; the
      // agents list no longer naming it does.
      client.changesAnswer = { ...client.changesAnswer, children: "children-3" };
      client.childrenAnswer = ok({ children: [] });
      yield* composer.loop.refresh;
      assert.equal(composer.childTranscriptSnapshot()?.conversationId, AGENT);
      client.changesAnswer = { ...client.changesAnswer, agents: "agents-3" };
      client.agentsAnswer = ok({ agents: [] });
      yield* composer.loop.refresh;
      assert.equal(composer.childTranscriptSnapshot(), undefined);
      assert.deepEqual(transcriptViews().at(-1), {});
    }),
);

it.effect(
  "a Clear leaves an observed transcript open, and the same conversation named under another kind is another open",
  () =>
    Effect.gen(function* () {
      const { composer, client, transcriptViews } = harness({ deviceId: DEVICE });
      client.changesAnswer = {
        seen: true,
        messages: "messages-head",
        events: "events-head",
        children: "children-1",
        agents: "agents-1",
      };
      client.agentsAnswer = ok({ agents: [AGENT_ROW] });
      client.childMessagesAnswers = [ok(childPage("agent-end", false))];
      yield* composer.loop.refresh;
      yield* callMethod(composer, GATEWAY_METHOD.CONVERSATION_OPEN_CHILD_TRANSCRIPT, {
        conversationId: AGENT,
        kind: TRANSCRIPT_KIND.OBSERVED,
      });
      const told = transcriptViews().length;
      // A Clear stamps no observed conversation, so the transcript stands where a child's would have gone.
      assert.equal(yield* clear(composer), true);
      assert.equal(composer.childTranscriptSnapshot()?.conversationId, AGENT);
      assert.equal(composer.childTranscriptSnapshot()?.kind, TRANSCRIPT_KIND.OBSERVED);
      assert.equal(transcriptViews().length, told);

      // The same id opened as a child is another open: the picture is replaced,
      // the clients are told the new kind, and the children head is what re-reads it now.
      client.calls.length = 0;
      yield* callMethod(composer, GATEWAY_METHOD.CONVERSATION_OPEN_CHILD_TRANSCRIPT, {
        conversationId: AGENT,
        kind: TRANSCRIPT_KIND.CHILD,
      });
      assert.equal(composer.childTranscriptSnapshot()?.kind, TRANSCRIPT_KIND.CHILD);
      assert.deepEqual(transcriptViews().at(-1)?.kind, TRANSCRIPT_KIND.CHILD);
      assert.ok(client.calls.includes(`childMessages:${AGENT}:`));
      client.changesAnswer = { ...client.changesAnswer, agents: "agents-2" };
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [`changes:${DEVICE}`, "agents"]);
      // The children list names it under the id it was opened as, so the children head moving reads it again.
      client.changesAnswer = { ...client.changesAnswer, children: "children-2" };
      client.childrenAnswer = ok({ children: [{ ...CHILD_ROW, id: AGENT }] });
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [
        `changes:${DEVICE}`,
        "children",
        `childMessages:${AGENT}:agent-end`,
      ]);
    }),
);

it.effect(
  "a reset drops the children, the agents, and the open transcript and tells every client",
  () =>
    Effect.gen(function* () {
      const { composer, client, childrenViews, agentsViews, transcriptViews } = harness({
        deviceId: DEVICE,
      });
      client.changesAnswer = {
        seen: true,
        messages: "messages-head",
        events: "events-head",
        children: "children-1",
        agents: "agents-1",
      };
      client.childrenAnswer = ok({ children: [CHILD_ROW] });
      client.agentsAnswer = ok({ agents: [AGENT_ROW] });
      yield* composer.loop.refresh;
      yield* callMethod(composer, GATEWAY_METHOD.CONVERSATION_OPEN_CHILD_TRANSCRIPT, {
        conversationId: CHILD,
        kind: TRANSCRIPT_KIND.CHILD,
      });
      composer.reset();
      assert.deepEqual(childrenViews().at(-1), { settled: false, children: [] });
      assert.deepEqual(agentsViews().at(-1), { settled: false, agents: [] });
      assert.deepEqual(transcriptViews().at(-1), {});
      assert.deepEqual(composer.childrenSnapshot(), { settled: false, children: [] });
      assert.deepEqual(composer.agentsSnapshot(), { settled: false, agents: [] });
      assert.equal(composer.childTranscriptSnapshot(), undefined);
    }),
);

/** The tail of a Conversation with the hello exchange as its newest turn, and the position to read back from. */
function tailAnswer(
  older: string,
  hasOlder: boolean,
  next = "messages-head",
): ConversationHistoryAnswer {
  const page = messagesAnswer("hello", next);
  return {
    conversations: page.conversations,
    groups: page.groups,
    older,
    hasOlder,
    next,
  };
}

/** One page read back: an earlier turn's exchange under a turn of its own, and where the history then stands. */
function olderAnswer(older: string, hasOlder: boolean): ConversationHistoryAnswer {
  const page = tailAnswer(older, hasOlder);
  const earlier = "1a000000-0000-4000-8000-000000000000";
  return {
    ...page,
    groups: page.groups.map((group) => ({
      ...group,
      turnId: earlier,
      turn: {
        id: earlier,
        origin: TURN_ORIGIN.TYPED,
        status: TURN_STATUS.SETTLED,
        queuedAt: NOW - 30_000,
      },
      messages: group.messages.map((message, index) => ({
        ...message,
        message: { ...message.message, id: `2b000000-0000-4000-8000-00000000000${index}` },
        seq: index + 1,
        createdAt: NOW - 30_000,
        placedAt: NOW - 30_000,
      })),
    })),
  };
}

it.effect(
  "the first read is the tail, whose head anchors the forward cursor, so the next poll reads forward from that head and never from the beginning",
  () =>
    Effect.gen(function* () {
      const { composer, client, views } = harness({ deviceId: DEVICE });
      client.historyAnswers = [ok(tailAnswer("older-1", true))];
      client.messagesAnswer = ok({ ...messagesAnswer("hello"), groups: [] });
      client.changesAnswer = { seen: true, messages: "messages-head", events: "events-head" };
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, [
        `changes:${DEVICE}`,
        "history:",
        "messages:messages-head",
        "events:",
        "children",
        "agents",
      ]);
      const [view] = views();
      assert.equal(view?.groups.length, 1);
      assert.equal(view?.hasOlder, true);
      client.calls.length = 0;
      yield* composer.loop.refresh;
      // The cursor stands at the head the tail carried: only the signal travels.
      assert.deepEqual(client.calls, [`changes:${DEVICE}`]);
    }),
);

it.effect(
  "a tail read that did not land leaves the cursor unheld, so the next poll asks for the tail again and reads nothing forward meanwhile",
  () =>
    Effect.gen(function* () {
      const { composer, client, views } = harness();
      client.historyAnswers = [
        { ok: false, failure: CONVERSATION_READ_FAILURE.UNANSWERED },
        ok(tailAnswer("older-1", false)),
      ];
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls, ["history:", "events:", "turns:", "children", "agents"]);
      assert.equal(views().length, 0);
      client.calls.length = 0;
      yield* composer.loop.refresh;
      assert.deepEqual(client.calls.slice(0, 2), ["history:", "messages:messages-head"]);
      assert.equal(views().at(-1)?.groups.length, 1);
      assert.equal(views().at(-1)?.hasOlder, undefined);
    }),
);

it.effect(
  "loading older reads one page back from where the history stands inside a pass and answers whether it landed; nothing older answers at once without a read",
  () =>
    Effect.gen(function* () {
      const { composer, client, views } = harness();
      client.historyAnswers = [ok(tailAnswer("older-1", true)), ok(olderAnswer("older-2", false))];
      yield* composer.loop.refresh;
      assert.equal(views().at(-1)?.hasOlder, true);
      client.calls.length = 0;

      const loaded = yield* callMethod(composer, GATEWAY_METHOD.CONVERSATION_LOAD_OLDER);
      assert.deepEqual(loaded, { loaded: true });
      assert.ok(client.calls.includes("history:older-1"));
      const view = views().at(-1);
      assert.equal(view?.groups.length, 2);
      assert.equal(view?.groups[0]?.turnId, "1a000000-0000-4000-8000-000000000000");
      assert.equal(view?.groups[1]?.turnId, TURN);
      assert.equal(view?.hasOlder, undefined);

      // The beginning was reached: the ask is answered without a pass.
      client.calls.length = 0;
      assert.deepEqual(yield* callMethod(composer, GATEWAY_METHOD.CONVERSATION_LOAD_OLDER), {
        loaded: false,
      });
      assert.deepEqual(client.calls, []);

      // A closed gate answers the same way, whatever the picture says.
      const closed = harness({ active: false });
      assert.deepEqual(yield* callMethod(closed.composer, GATEWAY_METHOD.CONVERSATION_LOAD_OLDER), {
        loaded: false,
      });
      assert.deepEqual(closed.client.calls, []);
    }),
);

it.effect(
  "a page read back that did not land answers that nothing landed, and the picture still says older turns stand for the next ask",
  () =>
    Effect.gen(function* () {
      const { composer, client, views } = harness();
      client.historyAnswers = [
        ok(tailAnswer("older-1", true)),
        { ok: false, failure: CONVERSATION_READ_FAILURE.UNANSWERED },
      ];
      yield* composer.loop.refresh;
      assert.deepEqual(yield* callMethod(composer, GATEWAY_METHOD.CONVERSATION_LOAD_OLDER), {
        loaded: false,
      });
      assert.ok(client.calls.includes("history:older-1"));
      assert.equal(views().at(-1)?.hasOlder, true);
    }),
);

it.effect(
  "a history page that lands after a Clear is dropped, so the Clear's empty thread does not say older turns stand",
  () =>
    Effect.gen(function* () {
      const { composer, client, views } = harness();
      client.historyAnswers = [ok(tailAnswer("older-1", true))];
      yield* composer.loop.refresh;
      assert.equal(views().at(-1)?.hasOlder, true);
      // The next history page is held at the gate while the Clear lands.
      const gate = yield* Deferred.make<void>();
      const reached = yield* Deferred.make<void>();
      client.history = () =>
        Effect.gen(function* () {
          client.calls.push("history:held");
          yield* Deferred.succeed(reached, undefined);
          yield* Deferred.await(gate);
          return ok(olderAnswer("older-2", true));
        });
      const loading = yield* Effect.forkChild(
        callMethod(composer, GATEWAY_METHOD.CONVERSATION_LOAD_OLDER),
      );
      yield* Deferred.await(reached);
      assert.ok(client.calls.includes("history:held"));
      const clearAnswer = client.clearAnswer;
      assert.ok(clearAnswer);
      client.messagesAnswer = ok({
        ...messagesAnswer("hello", "messages-cleared"),
        conversations: [
          {
            id: clearAnswer.opened,
            kind: CONVERSATION_VIEW_SOURCE.MAIN,
            openedAt: clearAnswer.openedAt,
          },
        ],
        groups: [],
      });
      const cleared = yield* Effect.forkChild(clear(composer), { startImmediately: true });
      yield* Deferred.succeed(gate, undefined);
      assert.equal(yield* Fiber.join(cleared), true);
      assert.deepEqual(yield* Fiber.join(loading), { loaded: false });
      const view = views().at(-1);
      assert.deepEqual(view?.groups, []);
      assert.equal(view?.hasOlder, undefined);
    }),
);
