import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { TOPIC } from "@luke/database/sync/notification";
import { defineSyncTable } from "@luke/database/sync/sync-table";
import { SYNC_TABLES } from "@luke/database/sync/tables";
import { getTestDB, installSyncTables } from "@luke/database/testing";
import { liveDigestOf } from "@luke/features/live-wire";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { Clock, Duration, Effect, Fiber, Layer, Option, Queue } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { liveQueryParts } from "../live/live-procedures.js";
import { announcingClock, driven } from "../testing/clock-driven.js";
import { syncHub } from "./hub.js";
import { LIVE_QUERIES } from "./live-queries.js";
import { defineLiveQuery, LIVE_MODE, type LiveQuery } from "./live-query.js";
import { Sync } from "./watch.js";

/**
 * Live reads Luke Sync wakes, on tables only these tests create: the
 * registry check holds a definition's statements, as Postgres plans them,
 * to the synced tables it declares and to no column they ignore; and a
 * held read on the hub answers within a coalesce window of a write to its
 * rows, carrying the write's txid, or unchanged at the hold's end. The
 * hub's waits run on a clock that announces each one, as the hub's own
 * tests do, so a write the database is still delivering is never outrun.
 */

/** The hub's coalesce window: how long a woken watch gathers before it answers. */
const COALESCE = Duration.millis(100);

/** How long a live read is held before it answers unchanged. */
const HOLD = Duration.seconds(25);

const PROBE = pgTable("live_query_probe", {
  id: uuid("id").primaryKey(),
  taskId: text("task_id").notNull(),
  note: text("note"),
  hot: text("hot"),
});

const probeSync = defineSyncTable(PROBE, {
  topics: [{ kind: TOPIC.TASK, column: PROBE.taskId }],
  ignore: [PROBE.hot],
});

/** The probe and a table beside it that no declaration captures, created as a migration would, with the probe's capture. */
const probeDB = Layer.provideMerge(
  Layer.effectDiscard(
    Effect.gen(function* () {
      const client = yield* SqlClient.SqlClient;
      yield* client.unsafe(
        "create table live_query_probe (id uuid primary key, task_id text not null, note text, hot text)",
      );
      yield* client.unsafe("create table live_query_elsewhere (id uuid primary key, task_id text)");
      yield* installSyncTables([probeSync]);
    }),
  ),
  getTestDB(),
);

/** A toy read of one task's probe rows, standing in for a view's own; `sql` reads them, its one placeholder the task. */
const probeQuery = (sql: string) =>
  defineLiveQuery({
    name: "taskBoard",
    params: ["taskId"],
    reads: [probeSync],
    topics: ({ taskId }) => [[TOPIC.TASK, taskId]],
    statements: ({ taskId }) => Option.some({ rows: { sql, params: [taskId] } }),
    mode: LIVE_MODE.SNAPSHOT,
  });

const PROBE_READ = probeQuery(
  "select p.id, p.note from live_query_probe p where p.task_id = $1 order by p.id",
);

/** A relation a plan scans, by its alias, and the expressions its own scan writes. */
interface ScanReads {
  readonly table: string;
  readonly alias: string;
  readonly expressions: readonly string[];
}

/** The text the node writes itself, every node under it left out. */
function ownExpressions(fields: Readonly<Record<string, unknown>>): readonly string[] {
  return Object.entries(fields).flatMap(([key, value]) => {
    if (key === "Plans") return [];
    if (typeof value === "string") return [value];
    return Array.isArray(value) ? value.filter((each) => typeof each === "string") : [];
  });
}

/** Every scan of a relation under the plan node, the node's own included. */
function scansOf(node: unknown): readonly ScanReads[] {
  if (Array.isArray(node)) return node.flatMap(scansOf);
  if (typeof node !== "object" || node === null) return [];
  const fields = node as Readonly<Record<string, unknown>>;
  const table = fields["Relation Name"];
  const alias = fields.Alias;
  const own =
    typeof table === "string" && typeof alias === "string"
      ? [{ table, alias, expressions: ownExpressions(fields) }]
      : [];
  return [...own, ...Object.values(fields).flatMap(scansOf)];
}

/**
 * Whether a scan's own expression names its column, or its whole row. Note
 * that a verbose plan qualifies a column by its alias wherever the
 * statement reads more than one relation, and writes it bare where it reads
 * one, so a bare name in a scan's own text is that relation's.
 */
function namesColumn(alias: string, column: string): (expression: string) => boolean {
  const escaped = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const qualifier = `"?${escaped(alias)}"?\\.`;
  const reference = new RegExp(
    `(?<![\\w$."':])(?:${qualifier}\\*|(?:${qualifier})?"?${escaped(column)}"?(?![\\w$"'(]))`,
  );
  return (expression) => reference.test(expression);
}

/** The name a statement is prepared under while it is explained. */
const PLANNED = "live_query_planned";

/**
 * The statement's generic plan, as JSON: prepared under a name and
 * explained executing it, each value a null a generic plan never reads, as
 * `planOf` (`@luke/database/testing`) explains one. Note that an explain's
 * own `generic_plan` would do, but the driver binds every placeholder it is
 * handed, and an explain prepared with placeholders reads them as its own.
 */
const genericPlanOf = (statement: string) =>
  Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* client.unsafe("set local plan_cache_mode = force_generic_plan");
        yield* client.unsafe(`prepare ${PLANNED} as ${statement}`);
        const [prepared] = yield* client.unsafe<{ readonly parameters: number }>(
          "select cardinality(parameter_types) as parameters from pg_prepared_statements where name = $1",
          [PLANNED],
        );
        const nulls = Array.from({ length: prepared?.parameters ?? 0 }, () => "null").join(", ");
        const rows = yield* client.unsafe<{ readonly "QUERY PLAN": unknown }>(
          `explain (verbose, format json) execute ${PLANNED}${nulls.length === 0 ? "" : `(${nulls})`}`,
        );
        return rows.map((row) => {
          const plan = row["QUERY PLAN"];
          return typeof plan === "string" ? (JSON.parse(plan) as unknown) : plan;
        });
      }).pipe(Effect.ensuring(Effect.ignore(client.unsafe(`deallocate ${PLANNED}`)))),
    ),
  );

/**
 * The registry check: every way the query's statements, as Postgres plans
 * them generically, read past what it declares, a table its `reads` leaves
 * out or a column one of them ignores, each once; none where it reads only
 * what it declares. Note that the plan is read rather than the SQL, so a
 * column two tables share is told apart by the relation it is read from.
 */
const faultsOf = (query: LiveQuery) =>
  Effect.gen(function* () {
    const params = Object.fromEntries(query.params.map((param) => [param, randomUUID()]));
    const statements = query.statements(params);
    assert.ok(Option.isSome(statements), `${query.name}'s statements could not be built`);
    const declared = new Map(query.reads.map((table) => [table.name, table]));
    const faults = new Set<string>();
    for (const statement of Object.values<LiveStatement>(statements.value)) {
      const scans = scansOf(yield* genericPlanOf(statement.sql));
      for (const { table, alias, expressions } of scans) {
        const synced = declared.get(table);
        if (synced === undefined) faults.add(`reads ${table}, which it does not declare`);
        for (const column of synced?.ignored ?? []) {
          if (expressions.some(namesColumn(alias, column))) {
            faults.add(`reads ${table}.${column}, which ${table} ignores`);
          }
        }
      }
    }
    return [...faults];
  });

/** Commits a probe row on the task, answering its transaction's id. */
const written = (taskId: string) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) =>
    sql<{ readonly txid: string }>`
      insert into live_query_probe (id, task_id, note) values (${randomUUID()}, ${taskId}, 'drawn')
      returning pg_current_xact_id()::text as txid
    `.pipe(Effect.map(([inserted]) => inserted?.txid)),
  );

/**
 * Runs the test on the hub, on a clock that announces each wait, with each
 * `next` a watch begins announced on `looking`, so the test writes only
 * once a held read's first look found nothing moved.
 */
const onHub = <A, E, R>(
  test: (probe: {
    readonly asleep: Queue.Dequeue<void>;
    readonly looking: Queue.Dequeue<void>;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const { clock, asleep } = yield* announcingClock;
    const looking = yield* Queue.unbounded<void>();
    const announcing = Layer.effect(
      Sync,
      Effect.map(Sync, (hub) => ({
        watch: (topics, fallback) =>
          Effect.map(hub.watch(topics, fallback), (watch) => ({
            next: Effect.andThen(Queue.offer(looking, undefined), watch.next),
          })),
      })),
    ).pipe(Layer.provide(syncHub));
    return yield* test({ asleep, looking }).pipe(
      Effect.provide(announcing),
      Effect.provideService(Clock.Clock, clock),
    );
  });

it.layer(probeDB)("live reads Luke Sync wakes", (it) => {
  it.effect(
    "every live read defined reads only synced tables it declares, each captured, and no column they ignore",
    () =>
      Effect.gen(function* () {
        for (const query of LIVE_QUERIES.values()) {
          for (const table of query.reads) {
            assert.ok(
              SYNC_TABLES.includes(table),
              `${query.name} reads ${table.name}, which no migration captures`,
            );
          }
          assert.deepEqual(yield* faultsOf(query), [], query.name);
        }
      }),
  );

  it.effect.each([
    { reading: "only what it declares", query: PROBE_READ, faults: [] },
    {
      reading: "a table it does not declare",
      query: probeQuery(
        "select p.id, e.id as other from live_query_probe p join live_query_elsewhere e on e.task_id = p.task_id where p.task_id = $1",
      ),
      faults: ["reads live_query_elsewhere, which it does not declare"],
    },
    {
      reading: "a column its table ignores",
      query: probeQuery("select p.id, p.hot from live_query_probe p where p.task_id = $1"),
      faults: ["reads live_query_probe.hot, which live_query_probe ignores"],
    },
  ])("the registry check of a query reading $reading finds $faults", ({ query, faults }) =>
    Effect.gen(function* () {
      assert.deepEqual(yield* faultsOf(query), faults);
    }),
  );

  it.effect(
    "a held read answers within a coalesce window of a write to it, carrying its txid",
    () =>
      onHub(({ asleep, looking }) =>
        Effect.gen(function* () {
          const taskId = randomUUID();
          const first = yield* liveQueryParts(PROBE_READ, { taskId }, {});
          const after = liveDigestOf(first.queries);
          assert.ok(after !== undefined);
          const held = yield* Effect.forkChild(liveQueryParts(PROBE_READ, { taskId }, { after }), {
            startImmediately: true,
          });
          yield* Queue.take(looking);
          // Note that the waits announced while the read was held count for nothing now.
          yield* Queue.clear(asleep);

          const from = yield* Clock.currentTimeMillis;
          const txid = yield* written(taskId);
          const answer = yield* driven({ fiber: held, asleep }, COALESCE);

          assert.ok((yield* Clock.currentTimeMillis) - from <= Duration.toMillis(COALESCE));
          assert.deepEqual(answer.queries.rows.txids, [txid]);
          assert.equal(answer.queries.rows.rows?.length, 1);
          assert.notEqual(liveDigestOf(answer.queries), after);
        }),
      ),
  );

  it.effect("a held read nothing moved answers unchanged at the hold's end", () =>
    onHub(({ looking }) =>
      Effect.gen(function* () {
        const taskId = randomUUID();
        const first = yield* liveQueryParts(PROBE_READ, { taskId }, {});
        const after = liveDigestOf(first.queries);
        assert.ok(after !== undefined);
        const held = yield* Effect.forkChild(liveQueryParts(PROBE_READ, { taskId }, { after }), {
          startImmediately: true,
        });
        yield* Queue.take(looking);
        yield* written(randomUUID());

        yield* TestClock.adjust(HOLD);
        const answer = yield* Fiber.join(held);

        assert.equal(liveDigestOf(answer.queries), after);
        assert.equal(answer.queries.rows.rows, undefined, "unchanged carries no rows");
        assert.equal(answer.queries.rows.txids, undefined, "and no txids");
      }),
    ),
  );
});
