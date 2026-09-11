import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { routeAuth } from "eve/channels/auth";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import type { ToolContext as EveToolContext } from "eve/tools";
import { afterAll, test } from "vitest";
import {
  ACTION_OUTPUT_STATUS,
  ACTION_RESULT_STATUS,
  ACTION_TOOL,
  BRAIN_TURN_TRIGGER,
} from "../server/core";
import { CONVERSATION_KIND, conversations, turns } from "../server/db/storage-schema";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_HEADER,
  BRAIN_HOST_REFUSAL,
  BRAIN_HOST_TURN,
} from "../server/hosted/brain-host/bounds";
import { brainHostChannelInput } from "../server/hosted/brain-host/channel";
import { conversationOwnedBy, runtimeSessionOwner } from "../server/hosted/brain-host/conversation";
import type { SessionOwnership } from "../server/hosted/brain-host/door";
import {
  type BrainHost,
  brainHost,
  type HostedToolBinding,
} from "../server/hosted/brain-host/host";
import { hostTurnId } from "../server/hosted/brain-host/ids";
import type { BrainHostSeams } from "../server/hosted/brain-host/production";
import { memoryRelayState } from "../server/hosted/brain-host/relay";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { stampedEveEvent } from "./support/eve-events";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * Session ownership is the host's alone: eve authenticates a request and
 * pins who opened a session, and enforces nothing about whose conversation
 * a session runs, so every guarantee here stands only as long as the host
 * keeps it. These tests name each one over the real migrations on PGlite,
 * through the same functions the eve project's authored files call, so a
 * refactor that drops one fails a test rather than a customer. Synthetic
 * accounts, conversations, and session ids throughout.
 */

const NOW = 1_800_000_000_000;
const TEST_VAULT_SECRET = "v".repeat(64);

let minted = 0;

/** A pair of eve session ids, each unique to its test as eve's are, sorting as they were minted: eve's ids sort by the instant they were opened. */
function sessions() {
  const mint = () => {
    minted += 1;
    return `wrun_01M${String(minted).padStart(22, "0")}`;
  };
  return { OLDER: mint(), NEWER: mint() };
}

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await storeWriter({
  db: database.db,
  tools: CATALOG_TOOL_SET,
  now: () => new Date(NOW),
});

/** The door's reads exactly as `productionBrainHostSeams` composes them, over the test database instead of the deployment's. */
const ownership: SessionOwnership = {
  sessionOwner: (sessionId) => runtimeSessionOwner(database.db, sessionId),
  ownsConversation: (userId, conversationId) =>
    conversationOwnedBy(database.db, userId, conversationId),
};

/** A seam a refused call must never reach; reaching it is the failure, named. */
function unreached(name: string): () => never {
  return () => {
    throw new Error(`${name} reached past a refused admission`);
  };
}

interface TestHost {
  readonly host: BrainHost;
  /** How many times a call reached the store past admission. */
  storeReads(): number;
}

function hostOverTestDatabase(): TestHost {
  let storeReads = 0;
  const seams: BrainHostSeams = {
    db: () => database.db,
    store: () => {
      storeReads += 1;
      return database.store;
    },
    writer: async () => writer,
    userInfo: async () => undefined,
    ownership,
    openAi: () => undefined,
    scriptedModel: () => false,
    spend: unreached("spend"),
    vaultRows: async () => [],
    vaultSecret: () => TEST_VAULT_SECRET,
    providerKey: unreached("providerKey"),
    executeAction: unreached("executeAction"),
    now: () => NOW,
  };
  return { host: brainHost(seams), storeReads: () => storeReads };
}

function principal(
  id: string,
  attributes: Readonly<Record<string, string>> = {},
): SessionAuthContext {
  return { principalId: id, principalType: "user", authenticator: "test", attributes };
}

/** One account's own seat in one of its conversations, typing: the same principal opened the session and speaks now. */
function ownSeat(userId: string, conversationId: string): SessionAuth {
  const seat = principal(userId, {
    [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: conversationId,
    [BRAIN_HOST_ATTRIBUTE.TURN]: BRAIN_HOST_TURN.TYPED,
  });
  return { current: seat, initiator: seat };
}

async function ownedConversation(userId: string): Promise<ConversationTarget> {
  const [row] = await database.db
    .insert(conversations)
    .values({ userId, kind: CONVERSATION_KIND.MAIN })
    .returning({ id: conversations.id });
  assert.ok(row);
  return { userId, conversationId: row.id };
}

async function recordedSession(conversationId: string): Promise<string | null> {
  const [row] = await database.db
    .select({ runtimeSessionId: conversations.runtimeSessionId })
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  assert.ok(row);
  return row.runtimeSessionId;
}

/** A session's start as the store hook runs it: admitted while claiming, then the claim; answers whether the record is now this session's. */
async function start(host: BrainHost, auth: SessionAuth, sessionId: string): Promise<boolean> {
  const starting = await host.admitStarting(auth, sessionId);
  assert.equal(starting.ok, true);
  if (!starting.ok) return false;
  return host.sessionStarted(starting, sessionId);
}

const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
  stampedEveEvent(event, NOW);

/** The fewest events of one turn that leave a settled turn row: opened, the words, one answering step, closed. */
function shortTurn(turnId: string): readonly MessageStreamEvent[] {
  const sequence = 0;
  return [
    stamped({ type: "turn.started", data: { turnId, sequence } }),
    stamped({ type: "message.received", data: { turnId, sequence, message: "hello" } }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 0, modelId: "m" } }),
    stamped({
      type: "message.completed",
      data: { turnId, sequence, stepIndex: 0, finishReason: "stop", message: "Hi." },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 0, finishReason: "stop" },
    }),
    stamped({ type: "turn.completed", data: { turnId, sequence } }),
  ];
}

/**
 * One event of one session as the store hook carries it: relayed only for a
 * session the host admits as the conversation's current one. Answers whether
 * the event was relayed at all.
 */
async function hookedEvent(
  host: BrainHost,
  auth: SessionAuth,
  sessionId: string,
  event: MessageStreamEvent,
  state = memoryRelayState(),
): Promise<boolean> {
  const admitted = await host.admit(auth, sessionId);
  if (!admitted.ok) return false;
  await host.relay(
    event,
    admitted,
    { id: sessionId, auth, turn: { id: "turn_0", sequence: 0 } },
    state,
  );
  return true;
}

function toolContext(sessionId: string, auth: SessionAuth): EveToolContext {
  const unreachable = (): never => {
    throw new Error("not reached in these tests");
  };
  return {
    session: { id: sessionId, auth, turn: { id: "turn_0", sequence: 0 } },
    abortSignal: new AbortController().signal,
    callId: "call-1",
    toolName: ACTION_TOOL.REMEMBER_FACT,
    getToken: unreachable,
    requireAuth: unreachable,
    getSandbox: unreachable,
    getSkill: unreachable,
  };
}

function binding(target: ConversationTarget, sessionId: string): HostedToolBinding {
  return {
    target,
    turn: {
      kind: BRAIN_HOST_TURN.TYPED,
      trigger: BRAIN_TURN_TRIGGER.ASK,
      turnId: hostTurnId(sessionId, "turn_0"),
    },
  };
}

test("two concurrent starts on one conversation leave exactly one recorded session, the newer, whichever start lands first", async () => {
  const { host } = hostOverTestDatabase();
  for (const first of ["OLDER", "NEWER"] as const) {
    const SESSION = sessions();
    const order =
      first === "OLDER" ? [SESSION.OLDER, SESSION.NEWER] : [SESSION.NEWER, SESSION.OLDER];
    const target = await ownedConversation(await database.createUser());
    const seat = ownSeat(target.userId, target.conversationId);

    const claims = await Promise.all(order.map((sessionId) => start(host, seat, sessionId)));

    assert.equal(claims[order.indexOf(SESSION.NEWER)], true);
    assert.equal(await recordedSession(target.conversationId), SESSION.NEWER);
    assert.equal((await host.admit(seat, SESSION.NEWER)).ok, true);
    assert.deepEqual(await host.admit(seat, SESSION.OLDER), {
      ok: false,
      refusal: BRAIN_HOST_REFUSAL.NOT_CURRENT_SESSION,
    });
    assert.equal(await start(host, seat, SESSION.OLDER), false);
    assert.equal(await recordedSession(target.conversationId), SESSION.NEWER);
  }
});

test("the session that lost the race relays nothing: one turn stands on the conversation's sequence, keyed to the session that won", async () => {
  const SESSION = sessions();
  const { host } = hostOverTestDatabase();
  const target = await ownedConversation(await database.createUser());
  const seat = ownSeat(target.userId, target.conversationId);
  await Promise.all([start(host, seat, SESSION.OLDER), start(host, seat, SESSION.NEWER)]);

  const olderState = memoryRelayState();
  const newerState = memoryRelayState();
  const olderCarried: boolean[] = [];
  const newerCarried: boolean[] = [];
  for (const event of shortTurn("turn_0")) {
    olderCarried.push(await hookedEvent(host, seat, SESSION.OLDER, event, olderState));
    newerCarried.push(await hookedEvent(host, seat, SESSION.NEWER, event, newerState));
  }

  assert.deepEqual(olderCarried, [false, false, false, false, false, false]);
  assert.deepEqual(newerCarried, [true, true, true, true, true, true]);
  const turnRows = await database.db
    .select({ id: turns.id })
    .from(turns)
    .where(eq(turns.conversationId, target.conversationId));
  assert.deepEqual(
    turnRows.map((row) => row.id),
    [hostTurnId(SESSION.NEWER, "turn_0")],
  );
});

/** What the door answered a request: the caller it admitted, or the status and body of the refusal eve writes from the door's error. */
type DoorAnswer =
  | { readonly admitted: string }
  | { readonly status: number; readonly body: unknown };

/** The refusal eve writes for the door's `ForbiddenError`: its 403, carrying the host's one word for it. */
function forbidden(
  refusal: (typeof BRAIN_HOST_REFUSAL)[keyof typeof BRAIN_HOST_REFUSAL],
): DoorAnswer {
  return { status: 403, body: { code: "forbidden", error: refusal, ok: false } };
}

/**
 * The channel as the eve project composes it, walked by eve's own route
 * auth, with a bearer resolver that knows the test's accounts by their
 * tokens. Answers what eve would: the admitted caller, or the response the
 * walk turned the door's refusal into.
 */
function channelAuth(accounts: readonly string[]) {
  const channel = brainHostChannelInput(async ({ headers }) => {
    const sub = headers.get("authorization")?.replace("Bearer ", "");
    return sub !== undefined && accounts.includes(sub) ? { sub } : undefined;
  }, ownership);
  return async (request: Request): Promise<DoorAnswer> => {
    const answer = await routeAuth(request, channel.auth);
    if (!(answer instanceof Response)) return { admitted: answer.principalId };
    const body: unknown = await answer.json();
    return { status: answer.status, body };
  };
}

function request(
  path: string,
  bearer: string,
  headers: Readonly<Record<string, string>> = {},
  method = "GET",
): Request {
  return new Request(`https://luke.test${path}`, {
    method,
    headers: { authorization: `Bearer ${bearer}`, ...headers },
  });
}

test("a session id nobody's record attributes is refused at the door to everyone, its owner-to-be included, until its first event records it; a rotated-away id is unrecorded again", async () => {
  const SESSION = sessions();
  const userA = await database.createUser();
  const userB = await database.createUser();
  const target = await ownedConversation(userA);
  const seat = ownSeat(userA, target.conversationId);
  const { host } = hostOverTestDatabase();
  const auth = channelAuth([userA, userB]);
  const stream = (sessionId: string, bearer: string) =>
    request(`/eve/v1/session/${sessionId}/stream`, bearer);
  const followUp = (sessionId: string, bearer: string) =>
    request(`/eve/v1/session/${sessionId}`, bearer, {}, "POST");

  const notOwner = forbidden(BRAIN_HOST_REFUSAL.NOT_OWNER);
  for (const bearer of [userA, userB]) {
    assert.deepEqual(await auth(stream(SESSION.OLDER, bearer)), notOwner);
    assert.deepEqual(await auth(followUp(SESSION.OLDER, bearer)), notOwner);
  }

  assert.equal(await start(host, seat, SESSION.OLDER), true);
  assert.deepEqual(await auth(stream(SESSION.OLDER, userA)), { admitted: userA });
  assert.deepEqual(await auth(followUp(SESSION.OLDER, userA)), { admitted: userA });
  assert.deepEqual(await auth(stream(SESSION.OLDER, userB)), notOwner);

  assert.equal(await start(host, seat, SESSION.NEWER), true);
  assert.deepEqual(await auth(stream(SESSION.OLDER, userA)), notOwner);
  assert.deepEqual(await auth(stream(SESSION.NEWER, userA)), { admitted: userA });
});

test("another account's conversation and another account's session are refused at the door; a bearer the account service does not know is no caller at all", async () => {
  const SESSION = sessions();
  const userA = await database.createUser();
  const userB = await database.createUser();
  const target = await ownedConversation(userA);
  const { host } = hostOverTestDatabase();
  assert.equal(await start(host, ownSeat(userA, target.conversationId), SESSION.OLDER), true);
  const auth = channelAuth([userA, userB]);
  const opening = (bearer: string) =>
    request(
      "/eve/v1/session",
      bearer,
      { [BRAIN_HOST_HEADER.CONVERSATION]: target.conversationId },
      "POST",
    );

  assert.deepEqual(await auth(opening(userB)), forbidden(BRAIN_HOST_REFUSAL.NOT_OWNER));
  assert.deepEqual(await auth(opening(userA)), { admitted: userA });
  assert.deepEqual(
    await auth(request(`/eve/v1/session/${SESSION.OLDER}/stream`, userB)),
    forbidden(BRAIN_HOST_REFUSAL.NOT_OWNER),
  );
  assert.deepEqual(
    await auth(request("/eve/v1/session", userB, {}, "POST")),
    forbidden(BRAIN_HOST_REFUSAL.NO_CONVERSATION),
  );
  const unknown = await auth(opening("nobody"));
  assert.equal("status" in unknown && unknown.status, 401);
});

test("a conversation cleared while its session runs admits nobody at the door and claims no further session", async () => {
  const SESSION = sessions();
  const userA = await database.createUser();
  const target = await ownedConversation(userA);
  const seat = ownSeat(userA, target.conversationId);
  const { host } = hostOverTestDatabase();
  assert.equal(await start(host, seat, SESSION.OLDER), true);
  const auth = channelAuth([userA]);

  await database.db
    .update(conversations)
    .set({ deletedAt: new Date(NOW) })
    .where(eq(conversations.id, target.conversationId));

  assert.deepEqual(
    await auth(request(`/eve/v1/session/${SESSION.OLDER}/stream`, userA)),
    forbidden(BRAIN_HOST_REFUSAL.NOT_OWNER),
  );
  assert.deepEqual(
    await auth(
      request(
        "/eve/v1/session",
        userA,
        { [BRAIN_HOST_HEADER.CONVERSATION]: target.conversationId },
        "POST",
      ),
    ),
    forbidden(BRAIN_HOST_REFUSAL.NOT_OWNER),
  );
  assert.deepEqual(await host.admit(seat, SESSION.OLDER), {
    ok: false,
    refusal: BRAIN_HOST_REFUSAL.NO_CONVERSATION,
  });
  assert.deepEqual(await host.admitStarting(seat, SESSION.NEWER), {
    ok: false,
    refusal: BRAIN_HOST_REFUSAL.NO_CONVERSATION,
  });
  assert.equal(await recordedSession(target.conversationId), SESSION.OLDER);
});

test("a tool call is admitted again as it runs: the current session's lands, and a rotated-away session's, another account's seat, and a cleared conversation's are each refused before any seam is reached", async () => {
  const SESSION = sessions();
  const userA = await database.createUser();
  const userB = await database.createUser();
  const target = await ownedConversation(userA);
  const seat = ownSeat(userA, target.conversationId);
  const { host, storeReads } = hostOverTestDatabase();
  const call = (sessionId: string, auth: SessionAuth) =>
    host.runTool(
      ACTION_TOOL.REMEMBER_FACT,
      binding(target, sessionId),
      { words: "prefers short replies" },
      toolContext(sessionId, auth),
    );

  assert.equal(await start(host, seat, SESSION.OLDER), true);
  const landed = await call(SESSION.OLDER, seat);
  assert.equal(landed.status, ACTION_OUTPUT_STATUS.ACCEPTED);
  const remembered = await database.store.facts.list(userA);
  assert.equal(remembered.length, 1);
  const readsOnceAdmitted = storeReads();
  assert.ok(readsOnceAdmitted > 0);

  assert.equal(await start(host, seat, SESSION.NEWER), true);
  assert.deepEqual(await call(SESSION.OLDER, seat), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: BRAIN_HOST_REFUSAL.NOT_CURRENT_SESSION,
  });

  const seatB = principal(userB, { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: target.conversationId });
  assert.deepEqual(await call(SESSION.NEWER, { current: seatB, initiator: seat.initiator }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: BRAIN_HOST_REFUSAL.NOT_INITIATOR,
  });
  assert.deepEqual(await call(SESSION.NEWER, { current: seatB, initiator: seatB }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: BRAIN_HOST_REFUSAL.NOT_OWNER,
  });

  await database.db
    .update(conversations)
    .set({ deletedAt: new Date(NOW) })
    .where(eq(conversations.id, target.conversationId));
  assert.deepEqual(await call(SESSION.NEWER, seat), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: BRAIN_HOST_REFUSAL.NO_CONVERSATION,
  });

  assert.equal(storeReads(), readsOnceAdmitted);
  assert.deepEqual(await database.store.facts.list(userA), remembered);
});
