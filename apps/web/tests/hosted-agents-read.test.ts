import assert from "node:assert/strict";
import {
  type AgentsAnswer,
  agentsAnswerSchema,
  CHILD_STATUS,
  HOSTED_API_ERROR,
  HOSTED_SERVICE_PATH,
  READ_QUERY,
} from "@sidecar/hosted";
import { TURN_ORIGIN, TURN_STATUS, type UnparsedWireValue } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Result } from "effect";
import { afterAll, test } from "vitest";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { handleConversationAgents } from "../server/hosted/resource-reads";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation, insertTurn, setConversationDeletedAt } from "./support/store-rows";

/**
 * The agents read over the real store and migrations: the account's
 * observed conversations holding a turn as the wire carries them, the latest
 * turn first, each named by its session identity and standing where that
 * turn leaves it; behind the same gate as the other reads, and taking no
 * cursor.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const PROVIDER = "conductor";
const SESSION = {
  SETTLED: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50",
  RUNNING: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e51",
  UNSPOKEN: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e52",
  STAMPED: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e53",
} as const;

const at = (offset: number) => new Date(NOW + offset);

/** The query a read is handed, spelled as a client might spell it. */
interface ReadQuery {
  after?: string;
  limit?: string;
}

function request(query: ReadQuery = {}, method = "GET", authorized = true): Request {
  const url = new URL(`https://luke.test${HOSTED_SERVICE_PATH.CONVERSATION_AGENTS}`);
  if (query.after !== undefined) url.searchParams.set(READ_QUERY.AFTER, query.after);
  if (query.limit !== undefined) url.searchParams.set(READ_QUERY.LIMIT, query.limit);
  return new Request(url, {
    method,
    headers: authorized ? { authorization: "Bearer token-1" } : {},
  });
}

function options(userId: string, req: Request) {
  return {
    request: req,
    resolveUserId: () => Effect.succeed(userId),
    store: database.store,
  };
}

async function answered(response: Response): Promise<AgentsAnswer> {
  assert.equal(response.status, 200);
  // SAFETY: the response body is the route's own JSON; the schema read is the validation.
  const read = readEither(agentsAnswerSchema)((await response.json()) as UnparsedWireValue);
  if (Result.isFailure(read))
    assert.fail(`${read.failure.refusal} at ${read.failure.path.join(".")}`);
  return read.success;
}

async function agentOf(userId: string, providerSessionId: string, createdAt: Date) {
  return insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.OBSERVED,
    providerId: PROVIDER,
    providerSessionId,
    createdAt,
  });
}

test("the gate order is method and bearer, and a cursor or a bound is accepted and ignored since the read takes none", async () => {
  const userId = await database.createUser();

  const wrongMethod = await database.run(
    handleConversationAgents(options(userId, request({}, "POST"))),
  );
  assert.equal(wrongMethod.status, 405);
  assert.equal((await wrongMethod.json()).error, HOSTED_API_ERROR.METHOD_NOT_ALLOWED);

  const anonymous = await database.run(
    handleConversationAgents({
      ...options(userId, request({}, "GET", false)),
      resolveUserId: () => Effect.succeed(undefined),
    }),
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);

  for (const query of [{ after: "%%%" }, { limit: "0" }, { limit: "two" }] satisfies ReadQuery[]) {
    const answer = await answered(
      await database.run(handleConversationAgents(options(userId, request(query)))),
    );
    assert.deepEqual(answer, { agents: [] }, JSON.stringify(query));
  }
});

test("agents are answered latest turn first, each by its session identity and where its latest turn leaves it; a session without a turn, a stamped one, and another account's by nothing", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();

  const settled = await agentOf(userId, SESSION.SETTLED, at(-3_600_000));
  await insertTurn(database.run, {
    userId,
    conversationId: settled,
    origin: TURN_ORIGIN.ROSTER_DIFF,
    status: TURN_STATUS.SETTLED,
    queuedAt: at(1_000),
    startedAt: at(2_000),
    settledAt: at(60_000),
  });
  const running = await agentOf(userId, SESSION.RUNNING, at(-1_800_000));
  await insertTurn(database.run, {
    userId,
    conversationId: running,
    origin: TURN_ORIGIN.ROSTER_DIFF,
    status: TURN_STATUS.RUNNING,
    queuedAt: at(120_000),
    startedAt: at(121_000),
  });
  await agentOf(userId, SESSION.UNSPOKEN, at(-600_000));
  const stamped = await agentOf(userId, SESSION.STAMPED, at(-300_000));
  await insertTurn(database.run, {
    userId,
    conversationId: stamped,
    origin: TURN_ORIGIN.ROSTER_DIFF,
    status: TURN_STATUS.FAILED,
    queuedAt: at(180_000),
    settledAt: at(181_000),
    failure: "model",
  });
  await setConversationDeletedAt(database.run, stamped, at(182_000));
  const elsewhere = await agentOf(other, SESSION.SETTLED, at(-3_600_000));
  await insertTurn(database.run, {
    userId: other,
    conversationId: elsewhere,
    origin: TURN_ORIGIN.ROSTER_DIFF,
    status: TURN_STATUS.QUEUED,
    queuedAt: at(240_000),
  });

  const answer = await answered(
    await database.run(handleConversationAgents(options(userId, request()))),
  );
  assert.deepEqual(answer.agents, [
    {
      id: running,
      providerId: PROVIDER,
      providerSessionId: SESSION.RUNNING,
      status: CHILD_STATUS.RUNNING,
      acceptedAt: NOW - 1_800_000,
      startedAt: NOW + 121_000,
    },
    {
      id: settled,
      providerId: PROVIDER,
      providerSessionId: SESSION.SETTLED,
      status: CHILD_STATUS.SETTLED,
      acceptedAt: NOW - 3_600_000,
      startedAt: NOW + 2_000,
      settledAt: NOW + 60_000,
    },
  ]);
});
