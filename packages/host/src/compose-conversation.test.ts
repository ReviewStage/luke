import assert from "node:assert/strict";
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
} from "@sidecar/gateway";
import {
  type BrainTurnsAnswer,
  type ChangesAnswer,
  type ChangesRequest,
  CONVERSATION_RATE_REFUSAL,
  CONVERSATION_READ_FAILURE,
  type ConversationEventsAnswer,
  type ConversationMessagesAnswer,
  type ConversationRateResult,
  type ConversationReadResult,
  type HostedMessageRatingRequest,
  type ReadPageQuery,
} from "@sidecar/hosted";
import { CONVERSATION_VIEW_SOURCE, type ConversationViewSnapshot } from "@sidecar/session";
import {
  isRecord,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_RATING,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
  type WireValue,
} from "@sidecar/wire";
import { Cause, Chunk, Effect, Exit } from "effect";
import { test } from "vitest";
import {
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
const NOW = 1_757_505_600_000;

const EMPTY_EVENTS: ConversationEventsAnswer = { events: [], next: "events-head", hasMore: false };
const EMPTY_TURNS: BrainTurnsAnswer = { turns: [], hasMore: false };

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

interface FakeClient extends ConversationReadsClient, ConversationHeadsClient {
  readonly calls: string[];
  changesAnswer: ChangesAnswer | undefined;
  messagesAnswer: ConversationReadResult<ConversationMessagesAnswer>;
  /** A gate a messages read waits at before answering, so a test can hold a poll open. */
  messagesGate: Promise<void>;
  clearAnswer: { opened: string; openedAt: number; cleared: number } | undefined;
  rateAnswer: ConversationRateResult;
  /** Every rating request as it left, so a test can read what traveled. */
  readonly rated: { messageId: string; request: HostedMessageRatingRequest }[];
}

function fakeClient(): FakeClient {
  const client: FakeClient = {
    calls: [],
    changesAnswer: undefined,
    messagesAnswer: ok(messagesAnswer("hello")),
    messagesGate: Promise.resolve(),
    clearAnswer: { opened: "3c000000-0000-4000-8000-000000000009", openedAt: NOW + 1, cleared: 1 },
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
      Effect.promise(async () => {
        client.calls.push(`messages:${page.after ?? ""}`);
        const answer = client.messagesAnswer;
        await client.messagesGate;
        return answer;
      }),
    events: (page: ReadPageQuery = {}) =>
      Effect.sync(() => {
        client.calls.push(`events:${page.after ?? ""}`);
        return ok(EMPTY_EVENTS);
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
  };
  return client;
}

function harness(options: { deviceId?: string; sendsNetwork?: boolean; active?: boolean } = {}) {
  const emitted: { kind: GatewayEventKind; payload: WireValue }[] = [];
  const reports: string[] = [];
  const client = fakeClient();
  const counted: { name: string; properties: WireValue }[] = [];
  const composer = composeConversation({
    kernel: {
      runMode: { sendsNetwork: options.sendsNetwork ?? true },
      report: (message) => reports.push(message),
      emit: (kind, payload) => emitted.push({ kind, payload }),
    },
    settings: {
      recordProductEvent: (name, properties) => {
        counted.push({ name, properties: carried(properties) });
      },
    },
    account: { capabilitiesActive: () => options.active ?? true },
    devices: { deviceId: () => options.deviceId },
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
  return { composer, client, emitted, reports, views, counted };
}

async function clear(composer: ReturnType<typeof composeConversation>) {
  const handler = composer.methods[GATEWAY_METHOD.CONVERSATION_CLEAR];
  assert.ok(handler);
  const result = await Effect.runPromise(
    handler(
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
    ),
  );
  assert.ok(isRecord(result));
  return result.cleared;
}

test("without a device row a poll reads every resource, and tells every client once when the picture moved", async () => {
  const { composer, client, views } = harness();
  assert.deepEqual(composer.snapshot(), { groups: [], settled: false });
  await composer.loop.refresh();
  assert.deepEqual(client.calls, ["messages:", "events:", "turns:"]);
  assert.equal(views().length, 1);
  const [view] = views();
  assert.equal(view?.settled, true);
  assert.equal(view?.groups.length, 1);
  assert.equal(view?.groups[0]?.turnId, TURN);
  // The same answers again move nothing, and nothing is told.
  await composer.loop.refresh();
  assert.equal(views().length, 1);
  assert.deepEqual(client.calls.slice(3), [
    "messages:messages-head",
    "events:events-head",
    "turns:",
  ]);
});

test("with a device row the change signal decides which resources are read", async () => {
  const { composer, client } = harness({ deviceId: DEVICE });
  client.changesAnswer = { seen: true, messages: "messages-head", events: "events-head" };
  await composer.loop.refresh();
  // Nothing held yet, so each head differs from the cursor and is read once; an
  // account with no turn has no turns head, and nothing is read for it.
  assert.deepEqual(client.calls, [`changes:${DEVICE}`, "messages:", "events:"]);
  client.calls.length = 0;
  await composer.loop.refresh();
  // Every cursor now equals its head: only the signal travels.
  assert.deepEqual(client.calls, [`changes:${DEVICE}`]);
  client.changesAnswer = {
    seen: true,
    messages: "messages-moved",
    events: "events-head",
    turns: "turns-head",
  };
  client.calls.length = 0;
  await composer.loop.refresh();
  assert.deepEqual(client.calls, [`changes:${DEVICE}`, "messages:messages-head", "turns:"]);
});

test("an unreadable row is surfaced on the snapshot and never drawn as an empty page", async () => {
  const { composer, client, views } = harness();
  await composer.loop.refresh();
  client.messagesAnswer = {
    ok: false,
    failure: CONVERSATION_READ_FAILURE.UNREADABLE_ROW,
    row: { conversationId: MAIN, seq: 7 },
  };
  await composer.loop.refresh();
  const latest = views().at(-1);
  assert.deepEqual(latest?.unreadable, { conversationId: MAIN, seq: 7 });
  // The thread stands as it was last read.
  assert.equal(latest?.groups.length, 1);
  assert.equal(composer.snapshot().unreadable?.seq, 7);
});

test("a page this build's registry refuses is named on the snapshot like a row the service could not read, and paging stops at it", async () => {
  const { composer, client, views, reports } = harness();
  const answer = messagesAnswer("hello");
  const [group] = answer.groups;
  assert.ok(group);
  const refused: ConversationMessagesAnswer = {
    ...answer,
    groups: [
      {
        ...group,
        messages: [
          ...group.messages,
          {
            message: {
              id: "2b000000-0000-4000-8000-000000000002",
              role: MESSAGE_ROLE.ASSISTANT,
              metadata: { author: MESSAGE_AUTHOR.BRAIN },
              parts: [
                {
                  type: "tool-tool_this_build_never_registered",
                  toolCallId: "call_1",
                  state: "output-available",
                  input: {},
                  output: {},
                },
              ],
            },
            seq: 3,
            createdAt: NOW + 1,
            tools: [],
          },
        ],
      },
    ],
    hasMore: true,
  };
  client.messagesAnswer = ok(refused);
  await composer.loop.refresh();
  assert.deepEqual(composer.snapshot().unreadable, { conversationId: MAIN, seq: 3 });
  assert.deepEqual(views().at(-1)?.unreadable, { conversationId: MAIN, seq: 3 });
  // One read, not a walk: the cursor did not pass the row and no page after it was asked for.
  assert.deepEqual(client.calls, ["messages:", "events:", "turns:"]);
  assert.equal(reports.length, 1);
});

test("Clear carries the service's soft delete and reads again at once; a Clear the service did not take answers false", async () => {
  const { composer, client } = harness();
  await composer.loop.refresh();
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
  assert.equal(await clear(composer), true);
  assert.equal(client.calls[0], "clear");
  assert.ok(client.calls.includes("messages:messages-head"));
  assert.deepEqual(composer.snapshot().groups, []);
  client.clearAnswer = undefined;
  assert.equal(await clear(composer), false);
});

test("a Clear answers only after a poll that began after it has published, even with a poll already under way", async () => {
  const { composer, client, views } = harness();
  await composer.loop.refresh();
  assert.equal(views().at(-1)?.groups.length, 1);
  // A poll reads the thread as it stood before the Clear and is held there.
  let release: () => void = () => undefined;
  client.messagesGate = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  client.messagesAnswer = ok(messagesAnswer("hello", "messages-later"));
  const held = composer.loop.refresh();
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
  const clearing = clear(composer).then((cleared) => {
    assert.equal(cleared, true);
    // Whatever the held poll published, the answer waited for a pass that read after the Clear.
    assert.deepEqual(composer.snapshot().groups, []);
    assert.deepEqual(views().at(-1)?.groups, []);
  });
  client.messagesAnswer = emptied;
  client.messagesGate = Promise.resolve();
  release();
  await held;
  await clearing;
});

test("a Clear the service took empties the picture even when the read after it does not land, and a pass that read before it cannot bring the thread back", async () => {
  const { composer, client, views } = harness();
  await composer.loop.refresh();
  assert.equal(views().at(-1)?.groups.length, 1);
  // A pass read the pre-Clear page and is held there; it lands after the Clear.
  let release: () => void = () => undefined;
  client.messagesGate = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  client.messagesAnswer = ok(messagesAnswer("hello", "messages-later"));
  const held = composer.loop.refresh();
  const clearing = clear(composer);
  // Every read after the Clear fails.
  client.messagesAnswer = { ok: false, failure: CONVERSATION_READ_FAILURE.UNANSWERED };
  client.messagesGate = Promise.resolve();
  release();
  await held;
  assert.equal(await clearing, true);
  assert.deepEqual(composer.snapshot().groups, []);
  assert.deepEqual(views().at(-1)?.groups, []);
});

test("a refusal from a pass that read before the Clear is not written over the cleared thread", async () => {
  const { composer, client } = harness();
  await composer.loop.refresh();
  let release: () => void = () => undefined;
  client.messagesGate = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  // The pass out before the Clear comes back naming a row of the stamped main.
  client.messagesAnswer = {
    ok: false,
    failure: CONVERSATION_READ_FAILURE.UNREADABLE_ROW,
    row: { conversationId: MAIN, seq: 7 },
  };
  const held = composer.loop.refresh();
  const clearing = clear(composer);
  // The reads after the Clear answer nothing, so the only refusal is the stale one.
  client.messagesAnswer = { ok: false, failure: CONVERSATION_READ_FAILURE.UNANSWERED };
  client.messagesGate = Promise.resolve();
  release();
  await held;
  assert.equal(await clearing, true);
  assert.equal(composer.snapshot().unreadable, undefined);
  assert.deepEqual(composer.snapshot().groups, []);
});

test("a run that sends nothing polls nothing and is settled from the start, and a closed gate refuses Clear", async () => {
  const fixture = harness({ sendsNetwork: false });
  await fixture.composer.loop.refresh();
  assert.deepEqual(fixture.client.calls, []);
  assert.deepEqual(fixture.composer.snapshot(), { groups: [], settled: true });
  assert.equal(await clear(fixture.composer), false);
  const signedOut = harness({ active: false });
  await signedOut.composer.loop.refresh();
  assert.deepEqual(signedOut.client.calls, []);
  assert.equal(await clear(signedOut.composer), false);
});

test("a reset drops everything held and tells every client the thread is gone", async () => {
  const { composer, views } = harness();
  await composer.loop.refresh();
  assert.equal(views().length, 1);
  composer.reset();
  assert.equal(views().length, 2);
  assert.deepEqual(views().at(-1), { groups: [], settled: false });
});

/** The method as a client would call it; a test reads the outcome for itself. */
async function rateOutcome(composer: ReturnType<typeof composeConversation>, params: WireValue) {
  const handler = composer.methods[GATEWAY_METHOD.CONVERSATION_RATE_MESSAGE];
  assert.ok(handler);
  return Effect.runPromiseExit(
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

async function rate(
  composer: ReturnType<typeof composeConversation>,
  params: WireValue,
): Promise<WireValue | undefined> {
  const outcome = await rateOutcome(composer, params);
  assert.ok(Exit.isSuccess(outcome));
  return outcome.value;
}

test("the rating a read carries on a message reaches the picture", async () => {
  const { composer } = harness();
  await composer.loop.refresh();
  const [group] = composer.snapshot().groups;
  assert.deepEqual(
    group?.messages.map((message) => message.rating),
    [undefined, { rating: MESSAGE_RATING.UP }],
  );
});

test("a rating on one of Luke's messages travels to the service with this device's id, shows at once, and is counted by verdict and kind alone", async () => {
  const { composer, client, views, counted } = harness({ deviceId: DEVICE });
  client.changesAnswer = { seen: true, messages: "messages-head", events: "events-head" };
  await composer.loop.refresh();
  const published = views().length;
  const answer = await rate(composer, { messageId: REPLY, rating: MESSAGE_RATING.DOWN });
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
});

test("a rating is refused before it travels where the device has no row, the gate is closed, or the message is not one of Luke's this device holds", async () => {
  const noDevice = harness();
  await noDevice.composer.loop.refresh();
  assert.deepEqual(await rate(noDevice.composer, { messageId: REPLY, rating: MESSAGE_RATING.UP }), {
    status: CONVERSATION_RATE_STATUS.UNAVAILABLE,
  });

  const closed = harness({ deviceId: DEVICE, active: false });
  assert.deepEqual(await rate(closed.composer, { messageId: REPLY, rating: MESSAGE_RATING.UP }), {
    status: CONVERSATION_RATE_STATUS.UNAVAILABLE,
  });

  const held = harness({ deviceId: DEVICE });
  await held.composer.loop.refresh();
  // The developer's own ask, and a message this device never read.
  assert.deepEqual(await rate(held.composer, { messageId: ASK, rating: MESSAGE_RATING.UP }), {
    status: CONVERSATION_RATE_STATUS.NOT_FOUND,
  });
  assert.deepEqual(
    await rate(held.composer, {
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
});

test("the service's refusals reach the control apart, leave the verdict as it was, and count nothing", async () => {
  const { composer, client, counted } = harness({ deviceId: DEVICE });
  await composer.loop.refresh();
  const before = composer.snapshot();
  client.rateAnswer = { ok: false, refusal: CONVERSATION_RATE_REFUSAL.NOT_RATEABLE };
  assert.deepEqual(await rate(composer, { messageId: REPLY, rating: MESSAGE_RATING.DOWN }), {
    status: CONVERSATION_RATE_STATUS.NOT_RATEABLE,
  });
  client.rateAnswer = { ok: false, refusal: CONVERSATION_RATE_REFUSAL.NOT_FOUND };
  assert.deepEqual(await rate(composer, { messageId: REPLY, rating: MESSAGE_RATING.DOWN }), {
    status: CONVERSATION_RATE_STATUS.NOT_FOUND,
  });
  client.rateAnswer = { ok: false, refusal: CONVERSATION_RATE_REFUSAL.UNANSWERED };
  assert.deepEqual(await rate(composer, { messageId: REPLY, rating: MESSAGE_RATING.DOWN }), {
    status: CONVERSATION_RATE_STATUS.UNAVAILABLE,
  });
  assert.deepEqual(composer.snapshot(), before);
  assert.deepEqual(counted, []);
});

test("a rating whose params are not one message and one verdict is refused as invalid before anything is read", async () => {
  const { composer, client } = harness({ deviceId: DEVICE });
  await composer.loop.refresh();
  const outcome = await rateOutcome(composer, { messageId: REPLY, rating: "sideways" });
  assert.ok(Exit.isFailure(outcome));
  assert.deepEqual(
    Cause.failures(outcome.cause).pipe(
      Chunk.map((refusal) => refusal.code),
      Chunk.toReadonlyArray,
    ),
    [GATEWAY_ERROR.INVALID_PARAMS],
  );
  assert.deepEqual(client.rated, []);
});
