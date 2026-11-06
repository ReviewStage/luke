import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { INBOX_STATUS } from "@repo/features/inbox-wire";
import { TASK_STATUS } from "@repo/features/task-wire";
import { eq } from "drizzle-orm";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { Database, type DatabaseServices } from "../../core/query.js";
import { sqlClientOverUrl } from "../../core/sql-client.js";
import { user } from "../../schemas/auth.js";
import { inboxItem } from "../../schemas/inbox.js";
import {
  getTestDB,
  openInboxItem,
  openTaskAgent,
  openWorkspace,
  STORE_TEST_DATABASE_ENVIRONMENT,
} from "../../testing/index.js";
import { archiveAgent } from "../agent-store.js";
import { createTask, updateTask } from "../task-store.js";

const anotherConnection = Effect.gen(function* () {
  const client = yield* SqlClient.SqlClient;
  const [row] = yield* client<{ readonly name: string }>`select current_database() as name`;
  const url = new URL(process.env[STORE_TEST_DATABASE_ENVIRONMENT.URL] ?? "");
  url.pathname = `/${row?.name ?? ""}`;
  const layer = Layer.fresh(sqlClientOverUrl(url.toString()));
  return <A, E>(effect: Effect.Effect<A, E, DatabaseServices>) => Effect.provide(effect, layer);
});

const openQuestion = Effect.gen(function* () {
  const db = yield* Database;
  const dean = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: dean, name: "Test User", email: `${dean}@app.test` });
  const workspace = yield* openWorkspace(dean);
  const { id: taskId } = yield* createTask(dean, { organizationId: workspace });
  const agentId = yield* openTaskAgent(dean, workspace, taskId);
  const itemId = yield* openInboxItem(dean, workspace, taskId, agentId, true);
  return { dean, taskId, agentId, itemId };
});

const waitingOnLocks = Effect.gen(function* () {
  const client = yield* SqlClient.SqlClient;
  const [row] = yield* client<{
    readonly waiting: number;
  }>`select count(*)::int as waiting from pg_locks where not granted and pid in (select pid from pg_stat_activity where datname = current_database())`;
  return row?.waiting ?? 0;
});

const LOOKS = 2000;

const untilWaitingOrDone = (fiber: Fiber.Fiber<unknown, unknown>) =>
  Effect.gen(function* () {
    for (let look = 0; look < LOOKS; look += 1) {
      if (fiber.pollUnsafe() !== undefined) return;
      if ((yield* waitingOnLocks) > 0) return;
      yield* Effect.yieldNow;
    }
  });

const standingOf = (itemId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [row] = yield* db
      .select({ status: inboxItem.status, closedReason: inboxItem.closedReason })
      .from(inboxItem)
      .where(eq(inboxItem.id, itemId));
    return row ?? assert.fail("the item is gone");
  });

const heldOnAnother = (
  onAnother: Awaited<Effect.Success<typeof anotherConnection>>,
  act: Effect.Effect<unknown, unknown, DatabaseServices>,
) =>
  Effect.gen(function* () {
    const written = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const fiber = yield* Effect.forkChild(
      onAnother(
        Effect.flatMap(SqlClient.SqlClient, (client) =>
          client.withTransaction(
            Effect.andThen(
              act,
              Effect.andThen(Deferred.succeed(written, undefined), Deferred.await(release)),
            ),
          ),
        ),
      ),
    );
    yield* Deferred.await(written);
    return { fiber, release };
  });

it.layer(getTestDB())("an inbox item's undo racing the other act that settles it", (it) => {
  it.effect(
    "a task moved off done while its agent's archive is uncommitted waits for it and hands the item to the archive",
    () =>
      Effect.gen(function* () {
        const onAnother = yield* anotherConnection;
        const { dean, taskId, agentId, itemId } = yield* openQuestion;
        yield* updateTask(dean, taskId, { status: TASK_STATUS.DONE });
        yield* TestClock.adjust("1 minute");

        const archive = yield* heldOnAnother(onAnother, archiveAgent(dean, agentId, true));
        const reopening = yield* Effect.forkChild(
          onAnother(updateTask(dean, taskId, { status: TASK_STATUS.IN_PROGRESS })),
        );
        yield* untilWaitingOrDone(reopening);
        yield* Deferred.succeed(archive.release, undefined);
        yield* Fiber.join(archive.fiber);
        yield* Fiber.join(reopening);

        assert.deepEqual(yield* standingOf(itemId), {
          status: INBOX_STATUS.CLOSED,
          closedReason: "Its agent was archived.",
        });
      }),
  );

  it.effect(
    "an agent brought back while its task's done is uncommitted waits for it and hands the item to the task",
    () =>
      Effect.gen(function* () {
        const onAnother = yield* anotherConnection;
        const { dean, taskId, agentId, itemId } = yield* openQuestion;
        yield* archiveAgent(dean, agentId, true);
        yield* TestClock.adjust("1 minute");

        const done = yield* heldOnAnother(
          onAnother,
          updateTask(dean, taskId, { status: TASK_STATUS.DONE }),
        );
        const unarchiving = yield* Effect.forkChild(onAnother(archiveAgent(dean, agentId, false)));
        yield* untilWaitingOrDone(unarchiving);
        yield* Deferred.succeed(done.release, undefined);
        yield* Fiber.join(done.fiber);
        yield* Fiber.join(unarchiving);

        assert.deepEqual(yield* standingOf(itemId), {
          status: INBOX_STATUS.CLOSED,
          closedReason: "Its task is done.",
        });
      }),
  );
});
