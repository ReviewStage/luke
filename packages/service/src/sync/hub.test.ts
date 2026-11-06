import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { SyncListener, type SyncListenerShape } from "@repo/database/sync/listener";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import { defineSyncTable } from "@repo/database/sync/sync-table";
import { getTestDB, installSyncTables } from "@repo/database/testing";
import { noDatabase } from "@repo/database/testing/no-database";
import { sql } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import {
  Clock,
  ConfigProvider,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Latch,
  Layer,
  Option,
  type Queue,
  Ref,
  Scope,
  Stream,
} from "effect";
import { SqlClient } from "effect/sql";
import { ConnectionError, SqlError } from "effect/sql/SqlError";
import { TestClock } from "effect/testing";
import { heldUntil } from "../http/held-read.js";
import { announcingClock, driven } from "../testing/clock-driven.js";
import { syncFromEnvironment, syncHub } from "./hub.js";
import { NO_TOPICS, Sync, type SyncWatch } from "./watch.js";

const NEVER_REACHED = Duration.hours(1);

const STEP = Duration.seconds(1);

const HEARTBEAT = Duration.seconds(15);

const UNDER_A_HEARTBEAT = Duration.seconds(10);

const FALLBACK = Duration.minutes(1);

const PROBE = pgTable("sync_hub_probe", {
  id: uuid("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  taskId: text("task_id"),
});

const probeSync = defineSyncTable(PROBE, {
  topics: [
    { kind: TOPIC.WORKSPACE, column: PROBE.workspaceId },
    { kind: TOPIC.TASK, column: PROBE.taskId },
  ],
  ignore: [],
});

const probeDB = Layer.provideMerge(
  Layer.effectDiscard(
    Effect.gen(function* () {
      const client = yield* SqlClient.SqlClient;
      yield* client.unsafe(
        "create table sync_hub_probe (id uuid primary key, workspace_id text not null, task_id text)",
      );
      yield* installSyncTables([probeSync]);
    }),
  ),
  getTestDB(),
);

function probeRow() {
  const row = { id: randomUUID(), workspaceId: randomUUID(), taskId: randomUUID() };
  const task: SyncTopic = [TOPIC.TASK, row.taskId];
  const workspace: SyncTopic = [TOPIC.WORKSPACE, row.workspaceId];
  return { row, task, workspace };
}

const written = (row: typeof PROBE.$inferInsert) =>
  Effect.flatMap(Database, (db) =>
    db.insert(PROBE).values(row).returning({ txid: sql<string>`pg_current_xact_id()::text` }),
  ).pipe(Effect.map(([inserted]) => inserted?.txid));

const CLOSED = new SqlError({
  reason: new ConnectionError({
    cause: new Error("closed"),
    message: "closed",
    operation: "listen",
  }),
});

interface Probe {
  readonly opened: Effect.Effect<number>;
  readonly drop: Effect.Effect<void>;
  readonly deafen: Effect.Effect<void>;
  readonly stall: Effect.Effect<void>;
  readonly release: Effect.Effect<void>;
  readonly asleep: Queue.Dequeue<void>;
}

const probedListener = Effect.gen(function* () {
  const underlying = yield* SyncListener;
  const opened = yield* Ref.make(0);
  const acknowledging = Latch.makeUnsafe(true);
  let standing: { readonly ended: Deferred.Deferred<never, SqlError>; deaf: boolean } | undefined;
  const listener: SyncListenerShape = {
    listen: Effect.gen(function* () {
      yield* acknowledging.await;
      const listening = yield* underlying.listen;
      const connection = { ended: Deferred.makeUnsafe<never, SqlError>(), deaf: false };
      standing = connection;
      yield* Ref.update(opened, (count) => count + 1);
      return {
        payloads: Stream.merge(
          Stream.filter(listening.payloads, () => !connection.deaf),
          Stream.fromEffect(Deferred.await(connection.ended)),
        ),
        notify: listening.notify,
      };
    }),
  };
  return {
    listener,
    opened: Ref.get(opened),
    drop: Effect.suspend(() =>
      standing === undefined ? Effect.void : Effect.asVoid(Deferred.fail(standing.ended, CLOSED)),
    ),
    deafen: Effect.sync(() => {
      if (standing !== undefined) standing.deaf = true;
    }),
    stall: Effect.asVoid(acknowledging.close),
    release: Effect.asVoid(acknowledging.open),
  };
});

const onHub = <A, E, R>(test: (probe: Probe) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const { clock, asleep } = yield* announcingClock;
    const { listener, ...probe } = yield* probedListener;
    return yield* test({ ...probe, asleep }).pipe(
      Effect.provide(
        syncHub.pipe(
          Layer.provide(Layer.succeed(SyncListener, listener)),
          Layer.provide(noDatabase),
        ),
      ),
      Effect.provideService(Clock.Clock, clock),
    );
  });

const nextOf = (watch: SyncWatch) => Effect.forkChild(watch.next, { startImmediately: true });

const opening = (topics: readonly SyncTopic[], fallback: Duration.Duration, scope: Scope.Scope) =>
  Effect.forkChild(
    Effect.flatMap(Sync, (sync) => sync.watch(topics, fallback)).pipe(
      Effect.provideService(Scope.Scope, scope),
    ),
    { startImmediately: true },
  );

const waiting = <A, E>(fiber: Fiber.Fiber<A, E>) => fiber.pollUnsafe() === undefined;

it.layer(probeDB)("Vespin Sync's hub", (it) => {
  it.effect("a committed write wakes exactly the watches on its topics, with its txid", () =>
    onHub(({ asleep }) =>
      Effect.gen(function* () {
        const sync = yield* Sync;
        const { row, task, workspace } = probeRow();
        const onTask = yield* nextOf(yield* sync.watch([task], NEVER_REACHED));
        const onWorkspace = yield* nextOf(yield* sync.watch([workspace], NEVER_REACHED));
        const elsewhere = yield* nextOf(
          yield* sync.watch([[TOPIC.TASK, randomUUID()]], NEVER_REACHED),
        );

        const txid = yield* written(row);

        assert.deepEqual(yield* driven({ fiber: onTask, asleep }, STEP), [txid]);
        assert.deepEqual(yield* driven({ fiber: onWorkspace, asleep }, STEP), [txid]);
        assert.ok(waiting(elsewhere), "a watch on no topic of the write still waits");
      }),
    ),
  );

  it.effect(
    "a write that commits while the first read runs wakes the look after it, which carries its txid and when it was heard",
    () =>
      onHub(({ asleep }) =>
        Effect.gen(function* () {
          const sync = yield* Sync;
          const { row, task } = probeRow();
          const witness = yield* nextOf(yield* sync.watch([task], NEVER_REACHED));
          const reads = yield* Ref.make(0);
          let txid: string | undefined;
          const read = Effect.gen(function* () {
            if ((yield* Ref.getAndUpdate(reads, (count) => count + 1)) > 0) return true;
            txid = yield* written(row);
            yield* driven({ fiber: witness, asleep }, STEP);
            return false;
          });

          const writtenAt = yield* Clock.currentTimeMillis;
          const held = yield* Effect.forkChild(
            heldUntil(read, (moved) => moved, [task], NEVER_REACHED, Duration.hours(2)),
            { startImmediately: true },
          );

          assert.deepEqual(
            yield* driven({ fiber: held, asleep }, STEP),
            Option.some({ read: true, txids: [txid], heardAt: Option.some(writtenAt) }),
          );
        }),
      ),
  );

  it.effect("the listener is opened once, however many watch at once", () =>
    onHub(({ opened }) =>
      Effect.gen(function* () {
        const sync = yield* Sync;
        yield* Effect.forEach(
          Array.from({ length: 5 }, () => probeRow().task),
          (topic) => sync.watch([topic], NEVER_REACHED),
          { concurrency: "unbounded" },
        );

        assert.equal(yield* opened, 1);
      }),
    ),
  );

  it.effect("a watch on an idle listener that still hears itself keeps it", () =>
    onHub(({ opened }) =>
      Effect.gen(function* () {
        const sync = yield* Sync;
        const { task } = probeRow();
        yield* Effect.scoped(sync.watch([task], NEVER_REACHED));

        yield* sync.watch([task], NEVER_REACHED);

        assert.equal(yield* opened, 1);
      }),
    ),
  );

  it.effect("a watch on an idle listener that died replaces it before answering", () =>
    onHub(({ opened, deafen, asleep }) =>
      Effect.gen(function* () {
        const sync = yield* Sync;
        const { row, task } = probeRow();
        yield* Effect.scoped(sync.watch([task], NEVER_REACHED));
        yield* deafen;

        const watch = yield* driven(
          { fiber: yield* opening([task], NEVER_REACHED, yield* Effect.scope), asleep },
          UNDER_A_HEARTBEAT,
        );

        assert.equal(yield* opened, 2, "the watch answered on a new connection");
        const next = yield* nextOf(watch);
        const txid = yield* written(row);
        assert.deepEqual(yield* driven({ fiber: next, asleep }, STEP), [txid]);
      }),
    ),
  );

  it.effect(
    "a watch on a listener not yet acknowledged answers after its fallback, and is woken once it is",
    () =>
      onHub(({ stall, release, asleep }) =>
        Effect.gen(function* () {
          const { task } = probeRow();
          yield* stall;

          const watch = yield* driven(
            { fiber: yield* opening([task], FALLBACK, yield* Effect.scope), asleep },
            FALLBACK,
          );
          const next = yield* nextOf(watch);
          yield* release;

          assert.deepEqual(yield* driven({ fiber: next, asleep }, STEP), []);
        }),
      ),
  );

  it.effect.each([
    { lost: "a closed connection", end: (probe: Probe) => probe.drop },
    { lost: "a missed heartbeat", end: (probe: Probe) => probe.deafen },
  ])("$lost wakes every watch, and the listener reconnects", ({ end }) =>
    onHub((probe) =>
      Effect.gen(function* () {
        const sync = yield* Sync;
        const { row, task, workspace } = probeRow();
        const onTask = yield* sync.watch([task], NEVER_REACHED);
        const onWorkspace = yield* nextOf(yield* sync.watch([workspace], NEVER_REACHED));
        const taskNext = yield* nextOf(onTask);

        yield* end(probe);

        assert.deepEqual(yield* driven({ fiber: taskNext, asleep: probe.asleep }, HEARTBEAT), []);
        assert.deepEqual(
          yield* driven({ fiber: onWorkspace, asleep: probe.asleep }, HEARTBEAT),
          [],
        );
        let heard: readonly string[] = [];
        const txid = yield* written(row);
        while (!heard.includes(txid ?? "")) {
          heard = yield* driven({ fiber: yield* nextOf(onTask), asleep: probe.asleep }, STEP);
        }
        assert.equal(yield* probe.opened, 2);
      }),
    ),
  );

  it.effect("a watch on no topics wakes on its fallback alone", () =>
    onHub(({ asleep }) =>
      Effect.gen(function* () {
        const sync = yield* Sync;
        const { row, task } = probeRow();
        const unwatched = yield* nextOf(yield* sync.watch(NO_TOPICS, FALLBACK));
        const witness = yield* nextOf(yield* sync.watch([task], NEVER_REACHED));

        yield* written(row);
        yield* driven({ fiber: witness, asleep }, STEP);

        assert.ok(waiting(unwatched), "a write woke a watch on no topics");
        yield* TestClock.adjust(FALLBACK);
        assert.deepEqual(yield* Fiber.join(unwatched), []);
      }),
    ),
  );

  it.effect("with no unpooled URL, a watch on topics wakes on its fallback", () =>
    Effect.gen(function* () {
      const { clock, asleep } = yield* announcingClock;

      const elapsed = yield* Effect.gen(function* () {
        const sync = yield* Sync;
        const next = yield* nextOf(yield* sync.watch([probeRow().task], FALLBACK));
        const from = yield* Clock.currentTimeMillis;
        yield* driven({ fiber: next, asleep }, FALLBACK);
        return (yield* Clock.currentTimeMillis) - from;
      }).pipe(
        Effect.provide(syncFromEnvironment),
        Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})),
        Effect.provideService(Clock.Clock, clock),
      );

      assert.ok(elapsed >= Duration.toMillis(FALLBACK), "the watch woke before its fallback");
    }),
  );
});
