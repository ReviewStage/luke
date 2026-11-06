import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Clock, Deferred, Duration, Effect, Fiber, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { Database, type DatabaseServices } from "../../core/query.js";
import { sqlClientOverUrl } from "../../core/sql-client.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, STORE_TEST_DATABASE_ENVIRONMENT, startTask } from "../../testing/index.js";
import { createAgent } from "../agent-store.js";
import { queueRunnerLine, runnerLinesPast } from "../runner-line-store.js";

const LAUNCH = 1;

const LOOKS = 2000;

const anotherConnection = Effect.gen(function* () {
  const client = yield* SqlClient.SqlClient;
  const [row] = yield* client<{ readonly name: string }>`select current_database() as name`;
  const url = new URL(process.env[STORE_TEST_DATABASE_ENVIRONMENT.URL] ?? "");
  url.pathname = `/${row?.name ?? ""}`;
  const layer = Layer.fresh(sqlClientOverUrl(url.toString()));
  return <A, E>(effect: Effect.Effect<A, E, DatabaseServices>) => Effect.provide(effect, layer);
});

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  const task = yield* startTask(userId, { name: "Invitations" });
  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    descriptionSnapshot: "# Invitations\n",
    prompt: null,
    repository: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  });
  return { userId, agentId: Option.getOrThrow(started).agent.id };
});

const waitingOnLocks = Effect.gen(function* () {
  const client = yield* SqlClient.SqlClient;
  const [row] = yield* client<{
    readonly waiting: number;
  }>`select count(*)::int as waiting from pg_locks where not granted and pid in (select pid from pg_stat_activity where datname = current_database())`;
  return row?.waiting ?? 0;
});

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
        assert.ok((yield* waitingOnLocks) > 0);
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
