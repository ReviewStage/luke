import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  type BrainRequestStatus,
} from "@luke/features/brain";
import { CODING_AGENT_KIND } from "@luke/features/coding-agent-wire";
import { sessionKey } from "@luke/runtime/vocabulary";
import { TURN_ORIGIN, TURN_STATUS } from "@luke/wire";
import { sql } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { OPERATOR_NOTICE_KIND } from "../../storage-vocabulary.js";
import { getTestDB, joinWorkspace, openWorkspace, plansOf } from "../../testing/index.js";
import { sweepAbandonedTurns, TURN_ABANDON } from "../abandoned-turns.js";
import {
  type CodingAgent,
  createCodingAgent,
  latestTurnsOfReached,
} from "../coding-agent-store.js";
import {
  dueOperatorWakes,
  markOperatorNoticesRead,
  recordOperatorWake,
  unreadOperatorNotices,
  writeOperatorNotice,
} from "../operator-notices.js";
import { STORE_WRITE_EFFECT, type StoreWriter, storeWriter } from "../writer.js";

/**
 * The notices an operator reads of its member's agents, over a real
 * dialect: a turn that settles, fails, or is abandoned is noted for the
 * operator standing over the agent's member and for no one else, a repeat
 * while unread moves the one notice, a notice once marked read gives way to
 * a fresh one, a failure is a wake due until one is recorded within its
 * hour, and a notice that cannot be written never fails the settle it rides
 * on. Synthetic accounts, workspaces, and agents throughout.
 */

const T0 = 1_800_000_000_000;
const HOUR_MS = 60 * 60 * 1000;
/** Larger than every notice the file's tests make. */
const EVERY = 100;

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

const started = (userId: string, organizationId: string, operator: boolean) =>
  Effect.map(
    createCodingAgent(
      userId,
      operator
        ? {
            taskId: null,
            organizationId,
            planSnapshot: null,
            prompt: null,
            kind: CODING_AGENT_KIND.OPERATOR,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: null,
          }
        : {
            taskId: null,
            organizationId,
            planSnapshot: null,
            prompt: "Sweep the flaky tests.",
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: "acme/api",
          },
    ),
    (made) => Option.getOrThrow(made).agent,
  );

/** A coder agent of the member's in the workspace. */
const coderOf = (userId: string, organizationId: string) => started(userId, organizationId, false);

/** The member's operator in the workspace. */
const operatorOf = (userId: string, organizationId: string) =>
  started(userId, organizationId, true);

/** A member of a fresh workspace, and the operator standing over them there. */
const openMember = Effect.gen(function* () {
  const member = yield* openAccount;
  const workspace = yield* openWorkspace(member);
  const operator = yield* operatorOf(member, workspace);
  return { member, workspace, operator };
});

/** One turn of the agent's, begun and ended at `at` as the status given; answers what the end's write came to. */
const turnEnding = (
  writer: StoreWriter,
  agent: CodingAgent,
  status: BrainRequestStatus,
  at: number,
) =>
  Effect.gen(function* () {
    const target = { userId: agent.userId, conversationId: agent.conversationId };
    const turnId = randomUUID();
    const turn = { conversationId: sessionKey(agent.conversationId), turnId };
    yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });
    yield* writer.consume(target, {
      ...turn,
      kind: BRAIN_RUN_EVENT.TURN_STARTED,
      sequence: 1,
      origin: BRAIN_TURN_ORIGIN.TYPED,
      trigger: BRAIN_TURN_TRIGGER.ASK,
      at: at - 1,
    });
    return yield* writer.consume(target, {
      ...turn,
      kind: BRAIN_RUN_EVENT.TURN_ENDED,
      sequence: 2,
      status,
      responseIds: [],
      at,
    });
  });

/** The operator's unread notices as kind, agent, and when, newest first. */
const unreadOf = (operator: CodingAgent) =>
  Effect.map(unreadOperatorNotices(operator.id, EVERY), (notices) =>
    notices.map(({ kind, agentId, at }) => ({ kind, agentId, at: at.getTime() })),
  );

it.layer(getTestDB())("the notices an operator reads of its member's agents", (it) => {
  it.effect("two settles of one agent leave one unread notice, at the later settle", () =>
    Effect.gen(function* () {
      const writer = yield* storeWriter({ tools: {} });
      const { member, workspace, operator } = yield* openMember;
      const agent = yield* coderOf(member, workspace);

      yield* turnEnding(writer, agent, BRAIN_REQUEST_STATUS.SUCCEEDED, T0);
      yield* turnEnding(writer, agent, BRAIN_REQUEST_STATUS.SUCCEEDED, T0 + 1_000);

      assert.deepEqual(yield* unreadOf(operator), [
        { kind: OPERATOR_NOTICE_KIND.TURN_SETTLED, agentId: agent.id, at: T0 + 1_000 },
      ]);
    }),
  );

  it.effect(
    "a failed turn and an abandoned one are noted as failures, and the operator's own turn is noted for no one",
    () =>
      Effect.gen(function* () {
        const writer = yield* storeWriter({ tools: {} });
        const { member, workspace, operator: standing } = yield* openMember;
        const failing = yield* coderOf(member, workspace);
        const lost = yield* coderOf(member, workspace);

        yield* turnEnding(writer, failing, BRAIN_REQUEST_STATUS.FAILED, T0);
        yield* turnEnding(writer, standing, BRAIN_REQUEST_STATUS.FAILED, T0 + 1);
        // A turn eve began and never ended, settled by the sweep past its bound.
        const target = { userId: member, conversationId: lost.conversationId };
        const turnId = randomUUID();
        yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "t" });
        yield* writer.consume(target, {
          conversationId: sessionKey(lost.conversationId),
          turnId,
          kind: BRAIN_RUN_EVENT.TURN_STARTED,
          sequence: 1,
          origin: BRAIN_TURN_ORIGIN.TYPED,
          trigger: BRAIN_TURN_TRIGGER.ASK,
          at: T0,
        });
        const swept = T0 + TURN_ABANDON.CODING_AGENT_AFTER_MS + 1;
        yield* sweepAbandonedTurns({ writer }, { now: swept });

        assert.deepEqual(yield* unreadOf(standing), [
          { kind: OPERATOR_NOTICE_KIND.TURN_FAILED, agentId: lost.id, at: swept },
          { kind: OPERATOR_NOTICE_KIND.TURN_FAILED, agentId: failing.id, at: T0 },
        ]);
      }),
  );

  it.effect(
    "a teammate's agent is noted for the teammate's operator alone, and a member with no operator is noted nothing",
    () =>
      Effect.gen(function* () {
        const writer = yield* storeWriter({ tools: {} });
        const { workspace, operator } = yield* openMember;
        const teammate = yield* openAccount;
        yield* joinWorkspace(workspace, teammate);
        const theirs = yield* coderOf(teammate, workspace);

        yield* turnEnding(writer, theirs, BRAIN_REQUEST_STATUS.SUCCEEDED, T0);
        assert.deepEqual(yield* unreadOf(operator), []);
        // An operator made after the turn finds nothing written while there was none.
        const late = yield* operatorOf(teammate, workspace);
        assert.deepEqual(yield* unreadOf(late), []);
        yield* writeOperatorNotice(
          { agentId: theirs.id },
          OPERATOR_NOTICE_KIND.PR_MERGED,
          new Date(T0 + 1),
        );
        assert.deepEqual(yield* unreadOf(late), [
          { kind: OPERATOR_NOTICE_KIND.PR_MERGED, agentId: theirs.id, at: T0 + 1 },
        ]);
        assert.deepEqual(yield* unreadOf(operator), [], "still nothing for the member's own");
      }),
  );

  it.effect(
    "notices marked read give way to a fresh one, and one moved past the read stays unread",
    () =>
      Effect.gen(function* () {
        const { member, workspace, operator: standing } = yield* openMember;
        const agent = yield* coderOf(member, workspace);
        const other = yield* coderOf(member, workspace);
        yield* writeOperatorNotice(
          { agentId: agent.id },
          OPERATOR_NOTICE_KIND.INBOX_ASK,
          new Date(T0),
        );
        yield* writeOperatorNotice(
          { agentId: other.id },
          OPERATOR_NOTICE_KIND.PR_CLOSED,
          new Date(T0),
        );
        const read = yield* unreadOperatorNotices(standing.id, EVERY);
        // The other agent's notice moves after the read and before the mark.
        yield* writeOperatorNotice(
          { agentId: other.id },
          OPERATOR_NOTICE_KIND.PR_CLOSED,
          new Date(T0 + 2_000),
        );
        yield* markOperatorNoticesRead(standing.id, read, new Date(T0 + 1_000));
        assert.deepEqual(yield* unreadOf(standing), [
          { kind: OPERATOR_NOTICE_KIND.PR_CLOSED, agentId: other.id, at: T0 + 2_000 },
        ]);

        yield* writeOperatorNotice(
          { agentId: agent.id },
          OPERATOR_NOTICE_KIND.INBOX_ASK,
          new Date(T0 + 3_000),
        );
        assert.deepEqual((yield* unreadOf(standing))[0], {
          kind: OPERATOR_NOTICE_KIND.INBOX_ASK,
          agentId: agent.id,
          at: T0 + 3_000,
        });
      }),
  );

  it.effect("a failure is a wake due until a wake within its hour is recorded", () =>
    Effect.gen(function* () {
      const writer = yield* storeWriter({ tools: {} });
      const { member, workspace, operator: standing } = yield* openMember;
      const agent = yield* coderOf(member, workspace);
      const dueFor = Effect.map(dueOperatorWakes(new Date(0), HOUR_MS, EVERY), (due) =>
        due.filter((wake) => wake.agentId === agent.id).map((wake) => wake.at.getTime()),
      );

      yield* turnEnding(writer, agent, BRAIN_REQUEST_STATUS.FAILED, T0);
      assert.deepEqual(yield* dueFor, [T0]);
      yield* recordOperatorWake(standing.id, agent.id, new Date(T0 + 10));
      assert.deepEqual(yield* dueFor, [], "answered");
      yield* turnEnding(writer, agent, BRAIN_REQUEST_STATUS.FAILED, T0 + HOUR_MS / 2);
      assert.deepEqual(yield* dueFor, [], "within the hour of the wake");
      yield* turnEnding(writer, agent, BRAIN_REQUEST_STATUS.FAILED, T0 + HOUR_MS + 10);
      assert.deepEqual(yield* dueFor, [T0 + HOUR_MS + 10]);
      assert.equal(
        (yield* dueOperatorWakes(new Date(0), HOUR_MS, EVERY)).find((w) => w.agentId === agent.id)
          ?.userId,
        member,
      );
    }),
  );
});

it.layer(getTestDB())("a notice that cannot be written", (it) => {
  it.effect("never fails the settle it rides on", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const writer = yield* storeWriter({ tools: {} });
      const { member, workspace } = yield* openMember;
      const agent = yield* coderOf(member, workspace);
      // This database alone loses the table, so every notice write fails.
      yield* db.execute(sql`drop table operator_notice`);

      const ended = yield* turnEnding(writer, agent, BRAIN_REQUEST_STATUS.SUCCEEDED, T0);

      assert.ok(Result.isSuccess(ended) && ended.success === STORE_WRITE_EFFECT.WRITTEN);
      const turns = yield* latestTurnsOfReached([agent.conversationId]);
      assert.equal(turns.get(agent.conversationId)?.status, TURN_STATUS.SETTLED);
    }),
  );
});

it.layer(getTestDB())("the wake sweep's read", (it) => {
  it.effect("the sweep finds the unread failures due a wake through their own index", () =>
    Effect.gen(function* () {
      const [due] = yield* plansOf(dueOperatorWakes(new Date("2026-10-20T12:00:00Z"), 60_000, 10));

      assert.match(due?.plan ?? "", /operator_notice_unread_kind_at/);
    }),
  );
});
