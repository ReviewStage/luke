import assert from "node:assert/strict";
import { hostTurnId } from "@luke/database/models/ids";
import { openTaskConversation } from "@luke/database/models/task-store";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import {
  insertConversation,
  joinWorkspace,
  openHostedStoreTestDatabase,
  setConversationDeletedAt,
  startTask,
} from "@luke/database/testing";
import { generateText } from "ai";
import { Effect, Layer, Option, Redacted, Result } from "effect";
import { routeAuth } from "eve/channels/auth";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import type { ToolContext as EveToolContext } from "eve/tools";
import { afterAll, test } from "vitest";
import { ACTION_RESULT_STATUS, BRAIN_TURN_TRIGGER } from "../../core.js";
import { modelCatalogOf } from "../../providers/model-catalog.js";
import { HOSTED_TOOL_SET } from "../../tasks/brain-tool-set.js";
import { QUEUE_QUESTION_TOOL } from "../../tasks/queue-question.js";
import { NO_GITHUB } from "../../testing/github-app-fake.js";
import { DEPLOYMENT_PRESENCE } from "./auth.js";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_HEADER,
  BRAIN_HOST_REFUSAL,
  BRAIN_HOST_TURN,
} from "./bounds.js";
import { brainHostChannelInput, DEPLOYMENT_TURNS } from "./channel.js";
import { conversationReachableBy, runtimeSessionReachableBy } from "./conversation.js";
import type { SessionOwnership } from "./door.js";
import { type BrainHost, brainHost, type HostedToolBinding } from "./host.js";
import type { BrainHostSeams } from "./production.js";

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

const writer = await database.run(
  storeWriter({
    tools: HOSTED_TOOL_SET,
  }),
);

/** The door's reads exactly as `productionBrainHostSeams` composes them, over the test database instead of the deployment's. */
const ownership: SessionOwnership = {
  reachesSession: (userId, sessionId) => database.run(runtimeSessionReachableBy(userId, sessionId)),
  reachesConversation: (userId, conversationId) =>
    database.run(conversationReachableBy(userId, conversationId)),
};

/** A seam a refused call must never reach; reaching it is the failure, named. */
function unreached(name: string): () => never {
  return () => {
    throw new Error(`${name} reached past a refused admission`);
  };
}

interface TestHost {
  readonly host: BrainHost;
}

function hostOverTestDatabase(overrides: Partial<BrainHostSeams> = {}): TestHost {
  const seams: BrainHostSeams = {
    writer: () => Effect.succeed(writer),
    userInfo: () => Effect.succeed(undefined),
    ownership,
    deploymentSecret: () => undefined,
    eveOrigin: () => undefined,
    openAi: () => undefined,
    titleModel: () => undefined,
    scriptedModel: () => false,
    spend: unreached("spend"),
    now: () => NOW,
    ...overrides,
  };
  return { host: brainHost(seams) };
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
  const conversationId = await insertConversation(database.run, { userId });
  return { userId, conversationId };
}

/** A session's start as the store hook runs it: admitted while claiming, then the claim; answers whether the record is now this session's. */
async function start(host: BrainHost, auth: SessionAuth, sessionId: string): Promise<boolean> {
  const starting = await database.run(host.admitStarting(auth, sessionId));
  assert.ok(Result.isSuccess(starting));
  if (!Result.isSuccess(starting)) return false;
  return database.run(host.sessionStarted(starting.success, sessionId));
}

/** The lineage eve hands a subagent's child session: the root it was delegated from, and the root's turn. */
interface ChildOf {
  readonly rootSessionId: string;
}

function toolContext(sessionId: string, auth: SessionAuth, childOf?: ChildOf): EveToolContext {
  const unreachable = (): never => {
    throw new Error("not reached in these tests");
  };
  const turn = { id: "turn_0", sequence: 0 };
  const session: EveToolContext["session"] =
    childOf === undefined
      ? { id: sessionId, auth, turn }
      : {
          id: sessionId,
          auth,
          turn,
          parent: {
            callId: "call-0",
            rootSessionId: childOf.rootSessionId,
            sessionId: childOf.rootSessionId,
            turn,
          },
        };
  return {
    session,
    abortSignal: new AbortController().signal,
    callId: "call-1",
    toolName: QUEUE_QUESTION_TOOL.name,
    messages: [],
    getToken: unreachable,
    requireAuth: unreachable,
    getSandbox: unreachable,
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
  const channel = brainHostChannelInput(
    async ({ headers }) => {
      const sub = headers.get("authorization")?.replace("Bearer ", "");
      return sub !== undefined && accounts.includes(sub) ? sub : undefined;
    },
    ownership,
    { secret: undefined, admits: DEPLOYMENT_TURNS, presents: DEPLOYMENT_PRESENCE.DEPLOYMENT },
  );
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

test("another account's conversation and another account's session are refused at the door; a bearer the account service does not know is no caller at all", async () => {
  const SESSION = sessions();
  const userA = await database.createUser();
  const userB = await database.createUser();
  const target = await ownedConversation(userA);
  const { host } = hostOverTestDatabase();
  assert.equal(await start(host, ownSeat(userA, target.conversationId), SESSION.OLDER), true);
  const auth = channelAuth([userA, userB]);
  const opening = (bearer: string, headers: Readonly<Record<string, string>> = {}) =>
    request(
      "/eve/v1/session",
      bearer,
      {
        [BRAIN_HOST_HEADER.CONVERSATION]: target.conversationId,
        [BRAIN_HOST_HEADER.TURN]: BRAIN_HOST_TURN.TYPED,
        ...headers,
      },
      "POST",
    );

  assert.deepEqual(await auth(opening(userB)), forbidden(BRAIN_HOST_REFUSAL.NOT_OWNER));
  assert.deepEqual(await auth(opening(userA)), { admitted: userA });
  // An open naming the caller's own conversation but no kind of turn is refused before eve dispatches: the session it would start composes its prompt from that kind and has none to run under otherwise.
  assert.deepEqual(
    await auth(
      request(
        "/eve/v1/session",
        userA,
        { [BRAIN_HOST_HEADER.CONVERSATION]: target.conversationId },
        "POST",
      ),
    ),
    forbidden(BRAIN_HOST_REFUSAL.NO_TURN_KIND),
  );
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

test("a tool call is admitted again as it runs: the current session's lands, and a rotated-away session's, another account's seat, and a cleared conversation's are each refused for the admission's reason, not the tool's", async () => {
  const SESSION = sessions();
  const userA = await database.createUser();
  const userB = await database.createUser();
  const started = await database.run(startTask(userA, { name: "Teammate invitations" }));
  const conversationId = Option.getOrThrow(
    await database.run(openTaskConversation(userA, started.id)),
  ).conversationId;
  const target = { userId: userA, conversationId };
  const seat = ownSeat(userA, conversationId);
  const { host } = hostOverTestDatabase();
  const question = {
    question: "Should a withdrawn invite tell the invitee who withdrew it?",
    recommendation: "No: just say the invite is no longer valid.",
  };
  const call = (sessionId: string, auth: SessionAuth) =>
    database.run(
      host
        .runTool(
          QUEUE_QUESTION_TOOL.name,
          binding(target, sessionId),
          question,
          toolContext(sessionId, auth),
        )
        .pipe(Effect.provide(Layer.merge(NO_GITHUB, modelCatalogOf([])))),
    );

  assert.equal(await start(host, seat, SESSION.OLDER), true);
  assert.deepEqual(await call(SESSION.OLDER, seat), { status: ACTION_RESULT_STATUS.ACCEPTED });

  assert.equal(await start(host, seat, SESSION.NEWER), true);
  assert.deepEqual(await call(SESSION.OLDER, seat), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: BRAIN_HOST_REFUSAL.NOT_CURRENT_SESSION,
  });

  const seatB = principal(userB, { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: conversationId });
  assert.deepEqual(await call(SESSION.NEWER, { current: seatB, initiator: seat.initiator }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: BRAIN_HOST_REFUSAL.NOT_INITIATOR,
  });
  assert.deepEqual(await call(SESSION.NEWER, { current: seatB, initiator: seatB }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: BRAIN_HOST_REFUSAL.NOT_OWNER,
  });

  await setConversationDeletedAt(database.run, conversationId, new Date(NOW));
  assert.deepEqual(await call(SESSION.NEWER, seat), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: BRAIN_HOST_REFUSAL.NO_CONVERSATION,
  });
});
test("a member of the plan's workspace is admitted to the conversation a teammate opened, at the door and as its tools run, and the turn's inference is metered to the member; a stranger is refused", async () => {
  const SESSION = sessions();
  const userA = await database.createUser();
  const teammate = await database.createUser();
  const stranger = await database.createUser();
  const started = await database.run(startTask(userA, { name: "Teammate invitations" }));
  await database.run(joinWorkspace(started.workspaceId, teammate));
  const { conversationId } = Option.getOrThrow(
    await database.run(openTaskConversation(userA, started.id)),
  );
  const target = { userId: userA, conversationId };
  const seat = ownSeat(userA, conversationId);
  const spent: string[] = [];
  const titled: string[] = [];
  const { host } = hostOverTestDatabase({
    titleModel: (userId) => {
      titled.push(userId);
      return undefined;
    },
    openAi: () => ({
      apiKey: Redacted.make("sk-test-ownership"),
      choice: { model: "openai/gpt-6.1-sol", effort: "medium" },
    }),
    spend: async (userId) => {
      spent.push(userId);
    },
  });
  assert.equal(await start(host, seat, SESSION.OLDER), true);
  const speaking = (userId: string): SessionAuth => ({
    current: principal(userId, {
      [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: conversationId,
      [BRAIN_HOST_ATTRIBUTE.TURN]: BRAIN_HOST_TURN.TYPED,
    }),
    initiator: seat.initiator,
  });

  const auth = channelAuth([userA, teammate, stranger]);
  const followUp = (bearer: string) =>
    request(
      `/eve/v1/session/${SESSION.OLDER}`,
      bearer,
      { [BRAIN_HOST_HEADER.TURN]: BRAIN_HOST_TURN.TYPED },
      "POST",
    );
  assert.deepEqual(await auth(followUp(teammate)), { admitted: teammate });
  assert.deepEqual(await auth(followUp(stranger)), forbidden(BRAIN_HOST_REFUSAL.NOT_OWNER));

  const admitted = await database.run(host.admit(speaking(teammate), SESSION.OLDER));
  assert.ok(Result.isSuccess(admitted));
  assert.equal(admitted.success.caller, teammate);
  assert.deepEqual(admitted.success.target, target);
  const selection = host.model(admitted.success);
  assert.ok(Result.isSuccess(selection));
  // The inference is refused before it leaves the process: the meter in front of it counts first.
  await assert.rejects(
    generateText({
      model: selection.success.model,
      prompt: "hello",
      abortSignal: AbortSignal.abort(),
      maxRetries: 0,
    }),
  );
  assert.deepEqual(spent, [teammate]);
  // A worker the member's turn started is titled on the member's meter, not the opener's.
  await database.run(
    host.titleChild(
      toolContext("wrun_worker", speaking(teammate), { rootSessionId: SESSION.OLDER }).session,
    ),
  );
  assert.deepEqual(titled, [teammate]);

  const question = {
    question: "Should a withdrawn invite tell the invitee who withdrew it?",
    recommendation: "No: just say the invite is no longer valid.",
  };
  const call = (auth: SessionAuth) =>
    database.run(
      host
        .runTool(
          QUEUE_QUESTION_TOOL.name,
          binding(target, SESSION.OLDER),
          question,
          toolContext(SESSION.OLDER, auth),
        )
        .pipe(Effect.provide(Layer.merge(NO_GITHUB, modelCatalogOf([])))),
    );
  assert.deepEqual(await call(speaking(teammate)), { status: ACTION_RESULT_STATUS.ACCEPTED });
  assert.deepEqual(await call(speaking(stranger)), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: BRAIN_HOST_REFUSAL.NOT_INITIATOR,
  });
  const strangerOwnSeat = principal(stranger, {
    [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: conversationId,
  });
  assert.deepEqual(
    await database.run(
      host.admitDelegated({ current: strangerOwnSeat, initiator: strangerOwnSeat }, SESSION.OLDER),
    ),
    Result.fail(BRAIN_HOST_REFUSAL.NOT_OWNER),
  );
});
