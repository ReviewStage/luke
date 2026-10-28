import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Clock, Deferred, Duration, Effect, Fiber, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { Database, type DatabaseServices } from "../../core/query.js";
import { sqlClientOverUrl } from "../../core/sql-client.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, STORE_TEST_DATABASE_ENVIRONMENT, startTask } from "../../testing/index.js";
import { createCodingAgent } from "../coding-agent-store.js";
import { queueRunnerLine, runnerLinesPast } from "../runner-line-store.js";

/**
 * An agent's runner lines queued at once against a real Postgres, with a
 * second connection beside the test's own: the one thing PGlite, a single
 * connection that runs one transaction at a time, cannot show. A line queued
 * while another's queue for the same agent is uncommitted waits for it, so
 * the agent's lines commit in the order of their places and a runner reading
 * past its cursor never passes over one. This file runs in CI's Postgres job,
 * where `LUKE_STORE_TEST_DATABASE_URL` names the database (`vitest.config.ts`).
 */

/** The launch both lines are written for. */
const LAUNCH = 1;

/** How many times the probe below looks for the second queue to wait or end. */
const LOOKS = 2000;

/** Answers how to run an effect on a connection of its own to the test's database, beside the test's one. */
const anotherConnection = Effect.gen(function* () {
  const client = yield* SqlClient.SqlClient;
  const [row] = yield* client<{ readonly name: string }>`select current_database() as name`;
  const url = new URL(process.env[STORE_TEST_DATABASE_ENVIRONMENT.URL] ?? "");
  url.pathname = `/${row?.name ?? ""}`;
  const layer = Layer.fresh(sqlClientOverUrl(url.toString()));
  return <A, E>(effect: Effect.Effect<A, E, DatabaseServices>) => Effect.provide(effect, layer);
});

/** An account holding one agent. */
const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const task = yield* startTask(userId, { name: "Invitations" });
  const started = yield* createCodingAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    planSnapshot: "# Invitations\n",
    prompt: null,
    repository: null,
  });
  return { userId, agentId: Option.getOrThrow(started).agent.id };
});

/** How many of the test database's sessions wait on a lock. */
const waitingOnLocks = Effect.gen(function* () {
  const client = yield* SqlClient.SqlClient;
  const [row] = yield* client<{
    readonly waiting: number;
  }>`select count(*)::int as waiting from pg_locks where not granted and pid in (select pid from pg_stat_activity where datname = current_database())`;
  return row?.waiting ?? 0;
});

/** Looks until the fiber waits on a lock or has ended, whichever comes first. */
const untilWaitingOrDone = (fiber: Fiber.Fiber<unknown, unknown>) =>
  Effect.gen(function* () {
    for (let look = 0; look < LOOKS; look += 1) {
      if (fiber.pollUnsafe() !== undefined) return;
      if ((yield* waitingOnLocks) > 0) return;
      yield* Effect.yieldNow;
    }
  });

it.layer(getTestDB())("an agent's runner lines queued at once", (it) => {
  it.effect(
    "a line queued while another's queue is uncommitted waits for it, and both read back in the order queued",
    () =>
      Effect.gen(function* () {
        const onAnother = yield* anotherConnection;
        const { userId, agentId } = yield* openAccount;
        const written = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const first = yield* Effect.forkChild(
          onAnother(
            Effect.flatMap(SqlClient.SqlClient, (client) =>
              client.withTransaction(
                Effect.andThen(
                  queueRunnerLine(userId, { agentId, launch: LAUNCH, text: "first" }),
                  Effect.andThen(Deferred.succeed(written, undefined), Deferred.await(release)),
                ),
              ),
            ),
          ),
        );
        yield* Deferred.await(written);

        const second = yield* Effect.forkChild(
          onAnother(queueRunnerLine(userId, { agentId, launch: LAUNCH, text: "second" })),
        );
        yield* untilWaitingOrDone(second);
        assert.equal(second.pollUnsafe(), undefined);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);

        const since = new Date(
          (yield* Clock.currentTimeMillis) - Duration.toMillis(Duration.hours(1)),
        );
        const lines = yield* runnerLinesPast(userId, agentId, {
          launch: LAUNCH,
          after: 0,
          since,
          limit: 10,
        });
        assert.deepEqual(
          lines.map((line) => line.text),
          ["first", "second"],
        );
      }),
  );
});
