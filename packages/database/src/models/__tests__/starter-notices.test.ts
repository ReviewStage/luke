import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CODING_AGENT_ARCHIVER, CODING_AGENT_KIND } from "@luke/features/coding-agent-wire";
import {
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
  type TurnStatus,
} from "@luke/wire";
import { sentLineId } from "@luke/wire/host-ids";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { codingAgent, type StoredArchive } from "../../schemas/coding-agent.js";
import { messages, turns } from "../../schemas/storage.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import { type CodingAgent, createCodingAgent } from "../coding-agent-store.js";
import { dueStarterNotices, STARTER_NOTICE_ENDING } from "../starter-notices.js";

/**
 * The endings an agent's starter is due to hear of, over a real dialect: a
 * failed turn, one the developer stopped, and an archive by anyone but the
 * starter, each until a line stands under its key, and nothing for a
 * completed turn or a starter that cannot answer or already knows. The read
 * is the deployment's, so each test reads back only its own agent's endings.
 * Synthetic accounts and agents.
 */

const T0 = new Date("2026-10-28T12:00:00Z").getTime();

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** A member's agent in a fresh workspace, of the kind given, and an agent it started. */
const openStarted = (kind: typeof CODING_AGENT_KIND.CODER | typeof CODING_AGENT_KIND.OPERATOR) =>
  Effect.gen(function* () {
    const member = yield* openAccount;
    const organizationId = yield* openWorkspace(member);
    const choice = { model: "anthropic/claude-opus-5.5", effort: "high", repository: null };
    const starter = Option.getOrThrow(
      yield* createCodingAgent(member, {
        taskId: null,
        organizationId,
        planSnapshot: null,
        ...(kind === CODING_AGENT_KIND.OPERATOR
          ? { prompt: null, kind }
          : { prompt: "Orchestrate the rollout." }),
        idempotencyKey: randomUUID(),
        ...choice,
      }),
    ).agent;
    const agent = Option.getOrThrow(
      yield* createCodingAgent(member, {
        taskId: null,
        organizationId,
        planSnapshot: null,
        prompt: "Record the starter.",
        idempotencyKey: randomUUID(),
        startedByAgentId: starter.id,
        ...choice,
      }),
    ).agent;
    return { member, starter, agent };
  });

/** A turn of the agent's, settled in the status given at `at`; its id. */
const settledTurn = (
  agent: CodingAgent,
  status: TurnStatus,
  at: number,
  patch: {
    readonly failure?: string;
    readonly cancelRequestKey?: string;
    readonly cancelRequestedBy?: string;
  } = {},
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [row] = yield* db
      .insert(turns)
      .values({
        userId: agent.userId,
        conversationId: agent.conversationId,
        origin: TURN_ORIGIN.TYPED,
        status,
        queuedAt: new Date(at - 1_000),
        settledAt: new Date(at),
        ...patch,
      })
      .returning({ id: turns.id });
    return row?.id ?? assert.fail("the turn was not written");
  });

/** The agent archived at `at` by the archiver given. */
const archivedAt = (agent: CodingAgent, at: number, archivedBy: StoredArchive) =>
  Effect.flatMap(Database, (db) =>
    db
      .update(codingAgent)
      .set({ archivedAt: new Date(at), archivedBy })
      .where(eq(codingAgent.id, agent.id)),
  );

/** The endings due within a minute of `T0`, of the agent's alone, as their ending and key. */
const dueOf = (agent: CodingAgent) =>
  Effect.map(dueStarterNotices(new Date(T0), new Date(T0 + 60_000), 100), (due) =>
    due.filter((each) => each.agentId === agent.id).map((each) => [each.ending, each.key]),
  );

/** A line in the starter's conversation under the key given at the seq given, standing as a sent one stands or withdrawn as one eve refused stands. */
const lineUnder = (starter: CodingAgent, key: string, seq: number, withdrawn = false) =>
  Effect.flatMap(Database, (db) =>
    db.insert(messages).values({
      userId: starter.userId,
      conversationId: starter.conversationId,
      seq,
      clientId: sentLineId(key),
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "told" }],
      metadata: { channel: MESSAGE_CHANNEL.LUKE },
      placedAt: new Date(T0),
      ...(withdrawn ? { withdrawnAt: new Date(T0) } : undefined),
    }),
  );

/** The setups in which no ending is due, each over a fresh starter and the agent it started. */
const UNTOLD = [
  {
    name: "a Stop the starter made itself",
    kind: CODING_AGENT_KIND.CODER,
    end: ({ starter, agent }: { starter: CodingAgent; agent: CodingAgent }) =>
      settledTurn(agent, TURN_STATUS.CANCELLED, T0 + 1_000, { cancelRequestedBy: starter.id }),
  },
  {
    name: "a Stop under a call's key from before a Stop named its agent",
    kind: CODING_AGENT_KIND.CODER,
    end: ({ agent }: { agent: CodingAgent }) =>
      settledTurn(agent, TURN_STATUS.CANCELLED, T0 + 1_000, { cancelRequestKey: "call_stop" }),
  },
  {
    name: "an archive by the starter itself",
    kind: CODING_AGENT_KIND.CODER,
    end: ({
      member,
      starter,
      agent,
    }: {
      member: string;
      starter: CodingAgent;
      agent: CodingAgent;
    }) =>
      archivedAt(agent, T0 + 1_000, {
        by: CODING_AGENT_ARCHIVER.AGENT,
        userId: member,
        agentId: starter.id,
      }),
  },
  {
    name: "a failure under a starter since archived",
    kind: CODING_AGENT_KIND.CODER,
    end: ({
      member,
      starter,
      agent,
    }: {
      member: string;
      starter: CodingAgent;
      agent: CodingAgent;
    }) =>
      Effect.andThen(
        settledTurn(agent, TURN_STATUS.FAILED, T0 + 1_000),
        archivedAt(starter, T0 + 2_000, { by: CODING_AGENT_ARCHIVER.MEMBER, userId: member }),
      ),
  },
  {
    name: "a failure under a starter whose own newest turn failed",
    kind: CODING_AGENT_KIND.CODER,
    end: ({ starter, agent }: { starter: CodingAgent; agent: CodingAgent }) =>
      Effect.andThen(
        settledTurn(starter, TURN_STATUS.FAILED, T0 + 500),
        settledTurn(agent, TURN_STATUS.FAILED, T0 + 1_000),
      ),
  },
  {
    name: "a failure under a member's operator",
    kind: CODING_AGENT_KIND.OPERATOR,
    end: ({ agent }: { agent: CodingAgent }) => settledTurn(agent, TURN_STATUS.FAILED, T0 + 1_000),
  },
] as const;

it.layer(getTestDB())("the endings an agent's starter is due to hear of", (it) => {
  it.effect(
    "a failed turn, one another agent stopped, and an archive by a member are each due the starter until a line stands under its key, a withdrawn one not standing, and a completed turn is due nothing",
    () =>
      Effect.gen(function* () {
        const { member, starter, agent } = yield* openStarted(CODING_AGENT_KIND.CODER);
        const failed = yield* settledTurn(agent, TURN_STATUS.FAILED, T0 + 1_000, {
          failure: "abandoned",
        });
        yield* settledTurn(agent, TURN_STATUS.SETTLED, T0 + 2_000);
        const stopped = yield* settledTurn(agent, TURN_STATUS.CANCELLED, T0 + 3_000, {
          cancelRequestedBy: randomUUID(),
        });
        yield* archivedAt(agent, T0 + 4_000, { by: CODING_AGENT_ARCHIVER.MEMBER, userId: member });

        assert.deepEqual(yield* dueOf(agent), [
          [STARTER_NOTICE_ENDING.FAILED, failed],
          [STARTER_NOTICE_ENDING.STOPPED, stopped],
          [STARTER_NOTICE_ENDING.ARCHIVED, agent.id],
        ]);

        yield* lineUnder(starter, failed, 1);
        yield* lineUnder(starter, stopped, 2, true);
        assert.deepEqual(yield* dueOf(agent), [
          [STARTER_NOTICE_ENDING.STOPPED, stopped],
          [STARTER_NOTICE_ENDING.ARCHIVED, agent.id],
        ]);
      }),
  );

  it.effect.each(UNTOLD)("no ending is due for $name", ({ kind, end }) =>
    Effect.gen(function* () {
      const started = yield* openStarted(kind);
      yield* end(started);
      assert.deepEqual(yield* dueOf(started.agent), []);
    }),
  );
});
