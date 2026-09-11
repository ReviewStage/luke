import assert from "node:assert/strict";
import { type AuthFn, ForbiddenError } from "eve/channels/auth";
import type { SessionAuthContext } from "eve/context";
import { afterAll, test } from "vitest";
import { CONVERSATION_KIND, conversations } from "../server/db/storage-schema";
import {
  conversationIdOf,
  requestAttributes,
  sessionAuthFor,
  turnKindOf,
} from "../server/hosted/brain-host/auth";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_HEADER,
  BRAIN_HOST_REFUSAL,
  BRAIN_HOST_TURN,
} from "../server/hosted/brain-host/bounds";
import {
  admitConversation,
  claimRuntimeSession,
  conversationOwnedBy,
  runtimeSessionOwner,
  SESSION_STANDING,
} from "../server/hosted/brain-host/conversation";
import {
  messageAuth,
  opensSession,
  ownedAuth,
  type SessionOwnership,
  sessionIdOf,
} from "../server/hosted/brain-host/door";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * The host's own check of who a session is for: the conversation a request
 * named rides as the initiator's attribute, and every tool and write asks
 * whether the current caller owns it and opened the session. Synthetic
 * accounts and conversations throughout.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const CONVERSATION_ID = "5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f";
const SESSION_A = "wrun_01SESSIONOFACCOUNTA0000000";
const SESSION_NEW = "wrun_01SESSIONNOTYETRECORDED00";
/** A session claiming the conversation as it starts: ownership alone decides. */
const CLAIMING = { id: SESSION_A, standing: SESSION_STANDING.CLAIMING } as const;

function principal(
  id: string,
  attributes: Readonly<Record<string, string>> = {},
): SessionAuthContext {
  return { principalId: id, principalType: "user", authenticator: "test", attributes };
}

async function ownedConversation(userId: string): Promise<string> {
  const [row] = await database.db
    .insert(conversations)
    .values({ userId, kind: CONVERSATION_KIND.MAIN })
    .returning({ id: conversations.id });
  assert.ok(row);
  return row.id;
}

test("the request's conversation and turn kind become attributes only when well formed", () => {
  const good = requestAttributes(
    new Headers({
      [BRAIN_HOST_HEADER.CONVERSATION]: CONVERSATION_ID,
      [BRAIN_HOST_HEADER.TURN]: BRAIN_HOST_TURN.OBSERVATION,
    }),
  );
  assert.deepEqual(good, {
    [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: CONVERSATION_ID,
    [BRAIN_HOST_ATTRIBUTE.TURN]: BRAIN_HOST_TURN.OBSERVATION,
  });
  const bad = requestAttributes(
    new Headers({
      [BRAIN_HOST_HEADER.CONVERSATION]: "not-a-uuid",
      [BRAIN_HOST_HEADER.TURN]: "cron",
    }),
  );
  assert.deepEqual(bad, {});
  assert.deepEqual(requestAttributes(new Headers()), {});
});

test("a message's auth is the caller with the request's attributes laid over, and nothing for no caller", () => {
  const request = new Request("https://luke.test/eve/v1/session", {
    headers: {
      [BRAIN_HOST_HEADER.CONVERSATION]: CONVERSATION_ID,
      [BRAIN_HOST_HEADER.TURN]: BRAIN_HOST_TURN.TYPED,
    },
  });
  const auth = sessionAuthFor(principal("user-a", { tenant: "t" }), request);
  assert.ok(auth);
  assert.equal(auth.principalId, "user-a");
  assert.equal(auth.attributes.tenant, "t");
  assert.equal(conversationIdOf(auth), CONVERSATION_ID);
  assert.equal(turnKindOf(auth), BRAIN_HOST_TURN.TYPED);
  assert.equal(sessionAuthFor(null, request), null);
  assert.equal(turnKindOf(principal("user-a")), undefined);
});

test("account A is admitted for its own conversation and the target names its row", async () => {
  const userA = await database.createUser();
  const id = await ownedConversation(userA);
  const a = principal(userA, { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: id });
  const admitted = await database.run(admitConversation({ current: a, initiator: a }, CLAIMING));
  assert.equal(admitted.ok, true);
  if (!admitted.ok) return;
  assert.deepEqual(admitted.target, { userId: userA, conversationId: id });
  assert.equal(admitted.kind, CONVERSATION_KIND.MAIN);
  assert.equal(admitted.runtimeSessionId, undefined);
});

test("account B is refused on account A's session, whichever seat it takes", async () => {
  const userA = await database.createUser();
  const userB = await database.createUser();
  const id = await ownedConversation(userA);
  const a = principal(userA, { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: id });
  const b = principal(userB, { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: id });

  const followUp = await database.run(admitConversation({ current: b, initiator: a }, CLAIMING));
  assert.deepEqual(followUp, { ok: false, refusal: BRAIN_HOST_REFUSAL.NOT_INITIATOR });

  const opened = await database.run(admitConversation({ current: b, initiator: b }, CLAIMING));
  assert.deepEqual(opened, { ok: false, refusal: BRAIN_HOST_REFUSAL.NOT_OWNER });

  const nobody = await database.run(
    admitConversation({ current: null, initiator: null }, CLAIMING),
  );
  assert.deepEqual(nobody, { ok: false, refusal: BRAIN_HOST_REFUSAL.NO_PRINCIPAL });

  const unnamed = await database.run(
    admitConversation(
      {
        current: principal(userA),
        initiator: principal(userA),
      },
      CLAIMING,
    ),
  );
  assert.deepEqual(unnamed, { ok: false, refusal: BRAIN_HOST_REFUSAL.NO_CONVERSATION });

  const unknown = principal(userA, { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: CONVERSATION_ID });
  const missing = await database.run(
    admitConversation({ current: unknown, initiator: unknown }, CLAIMING),
  );
  assert.deepEqual(missing, { ok: false, refusal: BRAIN_HOST_REFUSAL.NO_CONVERSATION });
});

test("a cleared conversation admits nobody, its owner included, and no session claims its record", async () => {
  const userA = await database.createUser();
  const [row] = await database.db
    .insert(conversations)
    .values({ userId: userA, kind: CONVERSATION_KIND.MAIN, deletedAt: new Date() })
    .returning({ id: conversations.id });
  assert.ok(row);
  const a = principal(userA, { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: row.id });
  assert.deepEqual(await database.run(admitConversation({ current: a, initiator: a }, CLAIMING)), {
    ok: false,
    refusal: BRAIN_HOST_REFUSAL.NO_CONVERSATION,
  });
  const session = "wrun_01M0000000000000000000000C";
  assert.equal(
    await database.run(
      claimRuntimeSession({ userId: userA, conversationId: row.id }, session, new Date()),
    ),
    false,
  );
  assert.equal(await database.run(runtimeSessionOwner(session)), undefined);
});

/** The door: eve's route auth says who is signed in; the host says whose session and conversation the route names. */

function ownershipOf(
  owners: Readonly<Record<string, string>>,
  conversations: Readonly<Record<string, string>>,
): SessionOwnership {
  return {
    sessionOwner: async (sessionId) => owners[sessionId],
    ownsConversation: async (userId, conversationId) => conversations[conversationId] === userId,
  };
}

function bearerOf(id: string): AuthFn<Request> {
  return (request) => {
    const bearer = request.headers.get("authorization")?.replace("Bearer ", "");
    return bearer === id ? principal(id) : null;
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

function opening(bearer: string, headers: Readonly<Record<string, string>> = {}): Request {
  return request("/eve/v1/session", bearer, headers, "POST");
}

test("the door names the session a route is for, and nothing for the routes that name none", () => {
  assert.equal(sessionIdOf(request(`/eve/v1/session/${SESSION_A}/stream`, "a")), SESSION_A);
  assert.equal(sessionIdOf(request(`/eve/v1/session/${SESSION_A}`, "a")), SESSION_A);
  assert.equal(sessionIdOf(request("/eve/v1/session", "a")), undefined);
  assert.equal(sessionIdOf(request("/eve/v1/health", "a")), undefined);
});

test("account B is refused at the door for A's recorded session, on the stream and on a follow-up alike; A is admitted; a session nobody's record attributes is refused to everyone", async () => {
  const auth = ownedAuth(
    [bearerOf("user-a"), bearerOf("user-b")],
    ownershipOf({ [SESSION_A]: "user-a" }, { [CONVERSATION_ID]: "user-a" }),
  );
  await assert.rejects(
    async () => auth(request(`/eve/v1/session/${SESSION_A}/stream`, "user-b")),
    ForbiddenError,
  );
  await assert.rejects(
    async () => auth(request(`/eve/v1/session/${SESSION_A}`, "user-b")),
    ForbiddenError,
  );
  const owner = await auth(request(`/eve/v1/session/${SESSION_A}/stream`, "user-a"));
  assert.equal(owner?.principalId, "user-a");
  await assert.rejects(
    async () => auth(request(`/eve/v1/session/${SESSION_NEW}/stream`, "user-b")),
    ForbiddenError,
  );
  await assert.rejects(
    async () => auth(request(`/eve/v1/session/${SESSION_NEW}/stream`, "user-a")),
    ForbiddenError,
  );
  assert.equal(await auth(request(`/eve/v1/session/${SESSION_A}/stream`, "nobody")), null);
});

test("a session opened for another account's conversation is refused at the door", async () => {
  const auth = ownedAuth(
    [bearerOf("user-a"), bearerOf("user-b")],
    ownershipOf({}, { [CONVERSATION_ID]: "user-a" }),
  );
  await assert.rejects(
    async () => auth(opening("user-b", { [BRAIN_HOST_HEADER.CONVERSATION]: CONVERSATION_ID })),
    ForbiddenError,
  );
  const owner = await auth(
    opening("user-a", { [BRAIN_HOST_HEADER.CONVERSATION]: CONVERSATION_ID }),
  );
  assert.equal(owner?.principalId, "user-a");
});

test("a session opened for no conversation, or a malformed one, is refused at the door before eve dispatches a run; the routes that open none still admit the caller", async () => {
  const auth = ownedAuth([bearerOf("user-a")], ownershipOf({}, { [CONVERSATION_ID]: "user-a" }));
  assert.equal(opensSession(opening("user-a")), true);
  assert.equal(opensSession(request("/eve/v1/session", "user-a")), false);
  assert.equal(opensSession(request(`/eve/v1/session/${SESSION_A}`, "user-a", {}, "POST")), false);
  await assert.rejects(async () => auth(opening("user-a")), ForbiddenError);
  await assert.rejects(
    async () => auth(opening("user-a", { [BRAIN_HOST_HEADER.CONVERSATION]: "not-a-conversation" })),
    ForbiddenError,
  );
  const inspecting = await auth(request("/eve/v1/info", "user-a"));
  assert.equal(inspecting?.principalId, "user-a");
});

test("a message that names no kind of turn is refused before it dispatches", () => {
  const caller = principal("user-a", { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: CONVERSATION_ID });
  const named = messageAuth({
    eve: {
      caller,
      request: request("/eve/v1/session", "user-a", {
        [BRAIN_HOST_HEADER.TURN]: BRAIN_HOST_TURN.TYPED,
      }),
    },
  });
  assert.equal(turnKindOf(named), BRAIN_HOST_TURN.TYPED);
  assert.throws(
    () => messageAuth({ eve: { caller, request: request("/eve/v1/session", "user-a") } }),
    ForbiddenError,
  );
  assert.equal(
    messageAuth({ eve: { caller: null, request: request("/eve/v1/session", "x") } }),
    null,
  );
});

test("the runtime session's owner and a conversation's ownership read from the rows", async () => {
  const userA = await database.createUser();
  const userB = await database.createUser();
  const id = await ownedConversation(userA);
  assert.equal(
    await database.run(
      claimRuntimeSession({ userId: userA, conversationId: id }, SESSION_A, new Date()),
    ),
    true,
  );
  assert.equal(await database.run(runtimeSessionOwner(SESSION_A)), userA);
  assert.equal(await database.run(runtimeSessionOwner(SESSION_NEW)), undefined);
  assert.equal(await database.run(conversationOwnedBy(userA, id)), true);
  assert.equal(await database.run(conversationOwnedBy(userB, id)), false);
});

test("a conversation runs in one session: the recorded one is admitted, another is refused, and a start claims the record only forward", async () => {
  const userA = await database.createUser();
  const id = await ownedConversation(userA);
  const a = principal(userA, { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: id });
  const auth = { current: a, initiator: a };
  const target = { userId: userA, conversationId: id };
  const older = "wrun_01M0000000000000000000000A";
  const newer = "wrun_01M0000000000000000000000B";

  assert.equal(
    (await database.run(admitConversation(auth, { id: older, standing: SESSION_STANDING.CURRENT })))
      .ok,
    false,
  );
  assert.equal(await database.run(claimRuntimeSession(target, older, new Date())), true);
  assert.equal(
    (await database.run(admitConversation(auth, { id: older, standing: SESSION_STANDING.CURRENT })))
      .ok,
    true,
  );

  assert.equal(await database.run(claimRuntimeSession(target, newer, new Date())), true);
  assert.deepEqual(
    await database.run(admitConversation(auth, { id: older, standing: SESSION_STANDING.CURRENT })),
    { ok: false, refusal: BRAIN_HOST_REFUSAL.NOT_CURRENT_SESSION },
  );
  assert.equal(
    (await database.run(admitConversation(auth, { id: newer, standing: SESSION_STANDING.CURRENT })))
      .ok,
    true,
  );
  assert.equal(await database.run(claimRuntimeSession(target, older, new Date())), false);
  assert.equal(await database.run(runtimeSessionOwner(newer)), userA);
  assert.equal(
    (
      await database.run(
        admitConversation(auth, { id: older, standing: SESSION_STANDING.CLAIMING }),
      )
    ).ok,
    true,
  );
});
