import assert from "node:assert/strict";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  GATEWAY_PROTOCOL_VERSION,
  type GatewayEventKind,
} from "@sidecar/gateway";
import {
  type BrainTurnsAnswer,
  type ChangesAnswer,
  type ChangesRequest,
  CONVERSATION_READ_FAILURE,
  type ConversationEventsAnswer,
  type ConversationMessagesAnswer,
  type ConversationReadResult,
  type ReadPageQuery,
} from "@sidecar/hosted";
import { CONVERSATION_VIEW_SOURCE, type ConversationViewSnapshot } from "@sidecar/session";
import {
  isRecord,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
  type WireValue,
} from "@sidecar/wire";
import { test } from "vitest";
import {
  type ConversationHeadsClient,
  type ConversationReadsClient,
  composeConversation,
} from "./compose-conversation.js";

const MAIN = "3c000000-0000-4000-8000-000000000001";
const TURN = "1a000000-0000-4000-8000-000000000001";
const DEVICE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const NOW = 1_757_505_600_000;

const EMPTY_EVENTS: ConversationEventsAnswer = { events: [], next: "events-head", hasMore: false };
const EMPTY_TURNS: BrainTurnsAnswer = { turns: [], hasMore: false };

function messagesAnswer(text: string, next = "messages-head"): ConversationMessagesAnswer {
  return {
    conversations: [{ id: MAIN, kind: CONVERSATION_VIEW_SOURCE.MAIN }],
    groups: [
      {
        turnId: TURN,
        conversationId: MAIN,
        source: { kind: CONVERSATION_VIEW_SOURCE.MAIN },
        turn: { id: TURN, origin: TURN_ORIGIN.TYPED, status: TURN_STATUS.SETTLED, queuedAt: NOW },
        messages: [
          {
            message: {
              id: "2b000000-0000-4000-8000-000000000001",
              role: MESSAGE_ROLE.USER,
              metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
              parts: [{ type: "text", text }],
            },
            seq: 1,
            createdAt: NOW,
            tools: [],
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
  clearAnswer: { opened: string; cleared: number } | undefined;
}

function fakeClient(): FakeClient {
  const client: FakeClient = {
    calls: [],
    changesAnswer: undefined,
    messagesAnswer: ok(messagesAnswer("hello")),
    messagesGate: Promise.resolve(),
    clearAnswer: { opened: "3c000000-0000-4000-8000-000000000009", cleared: 1 },
    poll: async (request: ChangesRequest) => {
      client.calls.push(`changes:${request.deviceId}`);
      return client.changesAnswer;
    },
    messages: async (page: ReadPageQuery = {}) => {
      client.calls.push(`messages:${page.after ?? ""}`);
      const answer = client.messagesAnswer;
      await client.messagesGate;
      return answer;
    },
    events: async (page: ReadPageQuery = {}) => {
      client.calls.push(`events:${page.after ?? ""}`);
      return ok(EMPTY_EVENTS);
    },
    turns: async (page: ReadPageQuery = {}) => {
      client.calls.push(`turns:${page.after ?? ""}`);
      return ok(EMPTY_TURNS);
    },
    clear: async () => {
      client.calls.push("clear");
      return client.clearAnswer;
    },
  };
  return client;
}

function harness(options: { deviceId?: string; sendsNetwork?: boolean; active?: boolean } = {}) {
  const emitted: { kind: GatewayEventKind; payload: WireValue }[] = [];
  const reports: string[] = [];
  const client = fakeClient();
  const composer = composeConversation({
    kernel: {
      runMode: { sendsNetwork: options.sendsNetwork ?? true },
      report: (message) => reports.push(message),
      emit: (kind, payload) => emitted.push({ kind, payload }),
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
  return { composer, client, emitted, reports, views };
}

async function clear(composer: ReturnType<typeof composeConversation>) {
  const handler = composer.methods[GATEWAY_METHOD.CONVERSATION_CLEAR];
  assert.ok(handler);
  const outcome = await handler(
    {},
    {
      client: { clientId: "test", role: GATEWAY_CLIENT_ROLE.OPERATOR },
      request: {
        protocolVersion: GATEWAY_PROTOCOL_VERSION,
        id: "clear-1",
        method: GATEWAY_METHOD.CONVERSATION_CLEAR,
        params: {},
        idempotencyKey: "clear-1",
      },
    },
  );
  assert.ok(outcome.ok);
  assert.ok(isRecord(outcome.result));
  return outcome.result.cleared;
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

test("Clear carries the service's soft delete and reads again at once; a Clear the service did not take answers false", async () => {
  const { composer, client } = harness();
  await composer.loop.refresh();
  client.messagesAnswer = ok({
    conversations: [
      { id: "3c000000-0000-4000-8000-000000000009", kind: CONVERSATION_VIEW_SOURCE.MAIN },
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
      { id: "3c000000-0000-4000-8000-000000000009", kind: CONVERSATION_VIEW_SOURCE.MAIN },
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
