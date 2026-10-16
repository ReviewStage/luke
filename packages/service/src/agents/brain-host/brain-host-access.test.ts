import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "@luke/database/core/query";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { openTaskConversation } from "@luke/database/models/task-store";
import { conversations } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import {
  insertConversation,
  joinWorkspace,
  leaveWorkspace,
  openHostedStoreTestDatabase,
  startTask,
} from "@luke/database/testing";
import { eq } from "drizzle-orm";
import { Option, Redacted, Result } from "effect";
import { type AuthFn, ForbiddenError } from "eve/channels/auth";
import type { SessionAuthContext } from "eve/context";
import { afterAll, test } from "vitest";
import { actedForAccount, DEPLOYMENT_PRESENCE, deploymentActor, sessionAuthFor } from "./auth.js";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_AUTHENTICATOR,
  BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
  BRAIN_HOST_HEADER,
  BRAIN_HOST_PRINCIPAL_TYPE,
  BRAIN_HOST_REFUSAL,
  BRAIN_HOST_TURN,
} from "./bounds.js";
import { DEPLOYMENT_TURNS } from "./channel.js";
import {
  admitConversation,
  claimRuntimeSession,
  conversationReachableBy,
  runtimeSessionReachableBy,
  SESSION_STANDING,
} from "./conversation.js";
import { ownedAuth, type SessionOwnership } from "./door.js";

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
  return insertConversation(database.run, { userId });
}

test("account A is admitted for its own conversation and the target names its row", async () => {
  const userA = await database.createUser();
  const id = await ownedConversation(userA);
  const a = principal(userA, { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: id });
  const admitted = await database.run(admitConversation({ current: a, initiator: a }, CLAIMING));
  assert.ok(Result.isSuccess(admitted));
  if (!Result.isSuccess(admitted)) return;
  assert.deepEqual(admitted.success.target, { userId: userA, conversationId: id });
  assert.equal(admitted.success.runtimeSessionId, undefined);
});

test("account B is refused on account A's session, whichever seat it takes", async () => {
  const userA = await database.createUser();
  const userB = await database.createUser();
  const id = await ownedConversation(userA);
  const a = principal(userA, { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: id });
  const b = principal(userB, { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: id });

  const followUp = await database.run(admitConversation({ current: b, initiator: a }, CLAIMING));
  assert.deepEqual(followUp, Result.fail(BRAIN_HOST_REFUSAL.NOT_INITIATOR));

  const opened = await database.run(admitConversation({ current: b, initiator: b }, CLAIMING));
  assert.deepEqual(opened, Result.fail(BRAIN_HOST_REFUSAL.NOT_OWNER));

  const nobody = await database.run(
    admitConversation({ current: null, initiator: null }, CLAIMING),
  );
  assert.deepEqual(nobody, Result.fail(BRAIN_HOST_REFUSAL.NO_PRINCIPAL));

  const unnamed = await database.run(
    admitConversation(
      {
        current: principal(userA),
        initiator: principal(userA),
      },
      CLAIMING,
    ),
  );
  assert.deepEqual(unnamed, Result.fail(BRAIN_HOST_REFUSAL.NO_CONVERSATION));

  const unknown = principal(userA, { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: CONVERSATION_ID });
  const missing = await database.run(
    admitConversation({ current: unknown, initiator: unknown }, CLAIMING),
  );
  assert.deepEqual(missing, Result.fail(BRAIN_HOST_REFUSAL.NO_CONVERSATION));
});

test("a cleared conversation admits nobody, its owner included, and no session claims its record", async () => {
  const userA = await database.createUser();
  const conversationId = await insertConversation(database.run, {
    userId: userA,
    deletedAt: new Date(),
  });
  const a = principal(userA, { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: conversationId });
  assert.deepEqual(
    await database.run(admitConversation({ current: a, initiator: a }, CLAIMING)),
    Result.fail(BRAIN_HOST_REFUSAL.NO_CONVERSATION),
  );
  const session = "wrun_01M0000000000000000000000C";
  assert.equal(
    await database.run(claimRuntimeSession({ userId: userA, conversationId }, session, new Date())),
    false,
  );
  assert.equal(await database.run(runtimeSessionReachableBy(userA, session)), false);
});

/** The door: eve's route auth says who is signed in; the host says whose session and conversation the route names. */

function ownershipOf(
  owners: Readonly<Record<string, string>>,
  conversations: Readonly<Record<string, string>>,
): SessionOwnership {
  return {
    reachesSession: async (userId, sessionId) => owners[sessionId] === userId,
    reachesConversation: async (userId, conversationId) => conversations[conversationId] === userId,
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
    opening("user-a", {
      [BRAIN_HOST_HEADER.CONVERSATION]: CONVERSATION_ID,
      [BRAIN_HOST_HEADER.TURN]: BRAIN_HOST_TURN.TYPED,
    }),
  );
  assert.equal(owner?.principalId, "user-a");
});

test("who reaches the runtime session and the conversation reads from the rows", async () => {
  const userA = await database.createUser();
  const userB = await database.createUser();
  const id = await ownedConversation(userA);
  assert.equal(
    await database.run(
      claimRuntimeSession({ userId: userA, conversationId: id }, SESSION_A, new Date()),
    ),
    true,
  );
  assert.equal(await database.run(runtimeSessionReachableBy(userA, SESSION_A)), true);
  assert.equal(await database.run(runtimeSessionReachableBy(userB, SESSION_A)), false);
  assert.equal(await database.run(runtimeSessionReachableBy(userA, SESSION_NEW)), false);
  assert.equal(await database.run(conversationReachableBy(userA, id)), true);
  assert.equal(await database.run(conversationReachableBy(userB, id)), false);
});

/** The deployment acting for an account: admitted for its turns on a message and refused, under its own secret, for everything else. */

const CRON_SECRET = "cron-secret-1";
const DEPLOYMENT = {
  secret: Redacted.make(CRON_SECRET),
  admits: DEPLOYMENT_TURNS,
  presents: DEPLOYMENT_PRESENCE.DEPLOYMENT,
};

/** A request under the deployment's secret naming the account, on the message route, for the kind of turn given. */
function scheduled(
  account: string | undefined,
  turn: string | undefined,
  path = "/eve/v1/session",
  method = "POST",
): Request {
  return request(
    path,
    CRON_SECRET,
    {
      ...(account !== undefined ? { [BRAIN_HOST_HEADER.ACCOUNT]: account } : undefined),
      ...(turn !== undefined ? { [BRAIN_HOST_HEADER.TURN]: turn } : undefined),
      [BRAIN_HOST_HEADER.CONVERSATION]: CONVERSATION_ID,
    },
    method,
  );
}

/** The refusal word the door answered a request with; a request the door admitted fails the test. */
async function refusal(run: () => ReturnType<AuthFn<Request>>): Promise<string> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof ForbiddenError);
    // SAFETY: eve's own refusal body, whose `error` field is the message the door threw.
    const body = (await error.response.json()) as { error: string };
    return body.error;
  }
  assert.fail("the door admitted what it should have refused");
}

test("the account a principal acts for is its own for a person and the named one for the deployment, and a request's account header reaches no person's attributes", () => {
  assert.equal(actedForAccount(principal("user-a")), "user-a");
  assert.equal(actedForAccount(null), undefined);
  const deployment: SessionAuthContext = {
    principalId: BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
    principalType: BRAIN_HOST_PRINCIPAL_TYPE.DEPLOYMENT,
    authenticator: BRAIN_HOST_AUTHENTICATOR.DEPLOYMENT,
    attributes: {},
  };
  assert.equal(actedForAccount(deployment), undefined);
  const laidOver = sessionAuthFor(
    principal("user-a"),
    request("/eve/v1/session", "user-a", { [BRAIN_HOST_HEADER.ACCOUNT]: "user-b" }),
  );
  assert.ok(laidOver);
  assert.equal(laidOver.attributes[BRAIN_HOST_ATTRIBUTE.ACCOUNT], undefined);
  assert.equal(actedForAccount(laidOver), "user-a");
});

test("at the door the deployment is admitted for the named account's own conversation and session, and refused for another account's", async () => {
  const auth = ownedAuth(
    [deploymentActor(DEPLOYMENT), bearerOf("user-a")],
    ownershipOf({ [SESSION_A]: "user-a" }, { [CONVERSATION_ID]: "user-a" }),
  );
  const opened = await auth(scheduled("user-a", BRAIN_HOST_TURN.SPOKEN));
  assert.equal(opened?.principalId, BRAIN_HOST_DEPLOYMENT_PRINCIPAL);
  assert.equal(actedForAccount(opened ?? null), "user-a");
  const followed = await auth(
    scheduled("user-a", BRAIN_HOST_TURN.SPOKEN, `/eve/v1/session/${SESSION_A}`),
  );
  assert.equal(actedForAccount(followed ?? null), "user-a");
  assert.equal(
    await refusal(() => auth(scheduled("user-b", BRAIN_HOST_TURN.SPOKEN))),
    BRAIN_HOST_REFUSAL.NOT_OWNER,
  );
  // A chat message to the plan's Luke wakes it with a typed turn the deployment opens for the account (`chat-wake.ts`).
  const woken = await auth(scheduled("user-a", BRAIN_HOST_TURN.TYPED));
  assert.equal(actedForAccount(woken ?? null), "user-a");
  assert.equal(
    await refusal(() => auth(scheduled("user-b", BRAIN_HOST_TURN.TYPED))),
    BRAIN_HOST_REFUSAL.NOT_OWNER,
  );
  assert.equal(
    await refusal(() =>
      auth(scheduled("user-b", BRAIN_HOST_TURN.SPOKEN, `/eve/v1/session/${SESSION_A}`)),
    ),
    BRAIN_HOST_REFUSAL.NOT_OWNER,
  );
  // The Stop the deployment carries for the account: admitted on the account's own recorded
  // session, refused on another account's and on one no record attributes to anybody.
  const cancelled = await auth(
    scheduled("user-a", undefined, `/eve/v1/session/${SESSION_A}/cancel`),
  );
  assert.equal(actedForAccount(cancelled ?? null), "user-a");
  assert.equal(
    await refusal(() =>
      auth(scheduled("user-b", undefined, `/eve/v1/session/${SESSION_A}/cancel`)),
    ),
    BRAIN_HOST_REFUSAL.NOT_OWNER,
  );
  assert.equal(
    await refusal(() =>
      auth(scheduled("user-a", undefined, `/eve/v1/session/${SESSION_NEW}/cancel`)),
    ),
    BRAIN_HOST_REFUSAL.NOT_OWNER,
  );
  // The voice hearing a spoken ask's turn: a read of the account's own recorded session's stream
  // is admitted, another account's and one no record attributes are refused, and only a read.
  const streamed = await auth(
    scheduled("user-a", undefined, `/eve/v1/session/${SESSION_A}/stream`, "GET"),
  );
  assert.equal(actedForAccount(streamed ?? null), "user-a");
  assert.equal(
    await refusal(() =>
      auth(scheduled("user-b", undefined, `/eve/v1/session/${SESSION_A}/stream`, "GET")),
    ),
    BRAIN_HOST_REFUSAL.NOT_OWNER,
  );
  assert.equal(
    await refusal(() =>
      auth(scheduled("user-a", undefined, `/eve/v1/session/${SESSION_NEW}/stream`, "GET")),
    ),
    BRAIN_HOST_REFUSAL.NOT_OWNER,
  );
  assert.equal(
    await refusal(() =>
      auth(scheduled("user-a", undefined, `/eve/v1/session/${SESSION_A}/stream`, "POST")),
    ),
    BRAIN_HOST_REFUSAL.NOT_DEPLOYMENT_ACT,
  );
});

test("a session the deployment opened for an account admits that account's own bearer as the same initiator, and another account not at all", async () => {
  const userA = await database.createUser();
  const userB = await database.createUser();
  const id = await ownedConversation(userA);
  const deployment: SessionAuthContext = {
    principalId: BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
    principalType: BRAIN_HOST_PRINCIPAL_TYPE.DEPLOYMENT,
    authenticator: BRAIN_HOST_AUTHENTICATOR.DEPLOYMENT,
    attributes: { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: id, [BRAIN_HOST_ATTRIBUTE.ACCOUNT]: userA },
  };
  const opened = await database.run(
    admitConversation({ current: deployment, initiator: deployment }, CLAIMING),
  );
  assert.ok(Result.isSuccess(opened));
  if (!Result.isSuccess(opened)) return;
  assert.deepEqual(opened.success.target, { userId: userA, conversationId: id });
  const byOwner = await database.run(
    admitConversation({ current: principal(userA), initiator: deployment }, CLAIMING),
  );
  assert.ok(Result.isSuccess(byOwner));
  const byOther = await database.run(
    admitConversation({ current: principal(userB), initiator: deployment }, CLAIMING),
  );
  assert.deepEqual(byOther, Result.fail(BRAIN_HOST_REFUSAL.NOT_INITIATOR));
  const forOther = await database.run(
    admitConversation(
      {
        current: {
          ...deployment,
          attributes: { ...deployment.attributes, [BRAIN_HOST_ATTRIBUTE.ACCOUNT]: userB },
        },
        initiator: deployment,
      },
      CLAIMING,
    ),
  );
  assert.deepEqual(forOther, Result.fail(BRAIN_HOST_REFUSAL.NOT_INITIATOR));
});

test("a member of a plan's workspace reaches the plan's conversation, its coding agent's, and a subagent's beside either, and is admitted to them; a stranger reaches none", async () => {
  const userA = await database.createUser();
  const teammate = await database.createUser();
  const stranger = await database.createUser();
  const started = await database.run(startTask(userA, { name: "Teammate invitations" }));
  await database.run(joinWorkspace(started.workspaceId, teammate));
  const task = Option.getOrThrow(await database.run(openTaskConversation(userA, started.id)));
  const agent = Option.getOrThrow(
    await database.run(
      createCodingAgent(userA, {
        taskId: started.id,
        idempotencyKey: randomUUID(),
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        repository: "reviewstage/luke",
        planSnapshot: null,
        prompt: "Draft the invite email.",
      }),
    ),
  ).agent;
  const taskChild = await insertConversation(database.run, {
    userId: userA,
    kind: CONVERSATION_KIND.CHILD,
    parentConversationId: task.conversationId,
  });
  const agentChild = await insertConversation(database.run, {
    userId: userA,
    kind: CONVERSATION_KIND.CHILD,
    parentConversationId: agent.conversationId,
  });
  const elsewhere = await ownedConversation(userA);

  for (const conversationId of [task.conversationId, agent.conversationId, taskChild, agentChild]) {
    assert.equal(await database.run(conversationReachableBy(teammate, conversationId)), true);
    assert.equal(await database.run(conversationReachableBy(stranger, conversationId)), false);
  }
  assert.equal(await database.run(conversationReachableBy(teammate, elsewhere)), false);
  assert.equal(await database.run(conversationReachableBy(userA, elsewhere)), true);

  const opener = principal(userA, { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: task.conversationId });
  const spoken = await database.run(
    admitConversation({ current: principal(teammate), initiator: opener }, CLAIMING),
  );
  assert.ok(Result.isSuccess(spoken));
  assert.equal(spoken.success.caller, teammate);
  assert.deepEqual(spoken.success.target, { userId: userA, conversationId: task.conversationId });
  assert.deepEqual(
    await database.run(
      admitConversation({ current: principal(stranger), initiator: opener }, CLAIMING),
    ),
    Result.fail(BRAIN_HOST_REFUSAL.NOT_INITIATOR),
  );

  // The opener who leaves the workspace leaves its plan's conversations with it.
  await database.run(leaveWorkspace(started.workspaceId, userA));
  for (const conversationId of [task.conversationId, agent.conversationId, taskChild]) {
    assert.equal(await database.run(conversationReachableBy(userA, conversationId)), false);
  }
  assert.equal(await database.run(conversationReachableBy(userA, elsewhere)), true);
  // A cleared plan conversation takes the workers' children delegated from it out of reach.
  await database.run(
    Database.use((db) =>
      db
        .update(conversations)
        .set({ deletedAt: new Date(0) })
        .where(eq(conversations.id, task.conversationId)),
    ),
  );
  assert.equal(await database.run(conversationReachableBy(teammate, taskChild)), false);
  assert.equal(await database.run(conversationReachableBy(teammate, agentChild)), true);
});
