import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { TOPIC } from "@luke/database/sync/notification";
import { defineSyncTable, type SyncTable } from "@luke/database/sync/sync-table";
import { SYNC_TABLES } from "@luke/database/sync/tables";
import { getTestDB, installSyncTables } from "@luke/database/testing";
import { liveDigestOf } from "@luke/features/live-wire";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { Clock, Duration, Effect, Fiber, Layer, Option, Queue } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { liveQueryParts } from "../live/live-procedures.js";
import { announcingClock, driven } from "../testing/clock-driven.js";
import { recordingSentry, sentOfType } from "../testing/sentry-transport.js";
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
    name: "taskHistory",
    params: ["taskId"],
    reads: [probeSync],
    topics: ({ taskId }) => [[TOPIC.TASK, taskId]],
    statements: ({ taskId }) => Option.some({ rows: { sql, params: [taskId] } }),
    mode: LIVE_MODE.SNAPSHOT,
  });

const PROBE_READ = probeQuery(
  "select p.id, p.note from live_query_probe p where p.task_id = $1 order by p.id",
);

/** One node of an explained plan, as its JSON writes it, the nodes under it among its `Plans`. */
type PlanNode = Readonly<Record<string, unknown>>;

/** A node of the plan, and whether it is a root: the statement's top node, or a subquery's. */
interface PlannedNode {
  readonly node: PlanNode;
  readonly root: boolean;
}

/** A relation a plan scans, by its alias, with the node that scans it. */
interface Scan extends PlannedNode {
  readonly table: string;
  readonly alias: string;
}

/** How a plan names the place of a subquery's top node, whose output is the subquery's own. */
const SUBQUERY_ROOT: ReadonlySet<unknown> = new Set(["SubPlan", "InitPlan"]);

/** Every node under the explained plan, each once, the roots marked. */
function nodesOf(explained: unknown, root = false): readonly PlannedNode[] {
  if (Array.isArray(explained)) return explained.flatMap((each) => nodesOf(each, root));
  if (typeof explained !== "object" || explained === null) return [];
  const fields = explained as PlanNode;
  if ("Plan" in fields) return nodesOf(fields.Plan, true);
  const own = { node: fields, root: root || SUBQUERY_ROOT.has(fields["Parent Relationship"]) };
  return [own, ...nodesOf(fields.Plans)];
}

/** The node's scan of a relation, where it is one. */
function scanOf(planned: PlannedNode): readonly Scan[] {
  const table = planned.node["Relation Name"];
  const alias = planned.node.Alias;
  return typeof table === "string" && typeof alias === "string"
    ? [{ ...planned, table, alias }]
    : [];
}

/** The text the node writes itself, every node under it left out, and its output too where it is `withoutOutput`. */
function ownExpressions(node: PlanNode, withoutOutput: boolean): readonly string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    if (key === "Plans" || (withoutOutput && key === "Output")) return [];
    if (typeof value === "string") return [value];
    return Array.isArray(value) ? value.filter((each) => typeof each === "string") : [];
  });
}

/**
 * Whether an expression names the relation's column, or its whole row.
 * Note that a verbose plan qualifies a column by its alias wherever the
 * statement reads more than one relation, and writes it bare where it reads
 * one, so a bare name in its text is that relation's.
 */
function namesColumn(alias: string, column: string): (expression: string) => boolean {
  const escaped = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const qualifier = `"?${escaped(alias)}"?\\.`;
  const reference = new RegExp(
    `(?<![\\w$."':])(?:${qualifier}\\*|(?:${qualifier})?"?${escaped(column)}"?(?![\\w$"'(]))`,
  );
  return (expression) => reference.test(expression);
}

/**
 * Whether a scan below its root emits every column of its table. Note that
 * Postgres has a scan feeding a join emit its table's whole row, its
 * physical tlist, to save a projection, so that output says nothing of what
 * the statement reads: the node above names what it takes of it.
 */
function emitsWholeRow(scan: Scan, table: SyncTable): boolean {
  const output = scan.node.Output;
  if (scan.root || !Array.isArray(output)) return false;
  const named = output.filter((each) => typeof each === "string");
  return [...table.watched, ...table.ignored].every((column) =>
    named.some(namesColumn(scan.alias, column)),
  );
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
 * column two tables share is told apart by the relation it is read from,
 * and that a column is read wherever any node of the plan names it, bar a
 * scan's whole row emitted for the node above to pick from (`emitsWholeRow`).
 * A read in cursor mode is planned past a cursor too, as a reader that names
 * one is answered.
 */
const faultsOf = (query: LiveQuery) =>
  Effect.gen(function* () {
    const params = Object.fromEntries(query.params.map((param) => [param, randomUUID()]));
    const past = query.cursor === undefined ? [] : [(yield* query.cursor.standing(params)).next];
    const built = [
      query.statements(params),
      ...past.map((cursor) => query.statements(params, cursor)),
    ];
    const declared = new Map(query.reads.map((table) => [table.name, table]));
    const faults = new Set<string>();
    const planned = built.flatMap((statements) => {
      assert.ok(Option.isSome(statements), `${query.name}'s statements could not be built`);
      return Object.values<LiveStatement>(statements.value);
    });
    for (const statement of planned) {
      const nodes = nodesOf(yield* genericPlanOf(statement.sql));
      const scans = nodes.flatMap(scanOf);
      const wholeRows = new Set(
        scans.flatMap((scan) => {
          const synced = declared.get(scan.table);
          return synced !== undefined && emitsWholeRow(scan, synced) ? [scan.node] : [];
        }),
      );
      const expressions = nodes.flatMap(({ node }) => ownExpressions(node, wholeRows.has(node)));
      for (const { table, alias } of scans) {
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
            ...watch,
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
    {
      reading: "a table it joins, whose scan emits every column for the join to pick from",
      query: probeQuery(
        "select p.id, q.note from live_query_probe p join live_query_probe q on q.task_id = p.task_id where p.task_id = $1",
      ),
      faults: [],
    },
  ])("the registry check of a query reading $reading finds $faults", ({ query, faults }) =>
    Effect.gen(function* () {
      assert.deepEqual(yield* faultsOf(query), faults);
    }),
  );

  it.effect(
    "a live read's statements reach Sentry under the read's own span, not as traces of their own",
    () =>
      Effect.gen(function* () {
        const sentry = recordingSentry();
        yield* liveQueryParts(PROBE_READ, { taskId: randomUUID() }, {}).pipe(
          Effect.provide(sentry.layer),
        );
        const spans = sentOfType(sentry.sent, "span").flatMap(
          (item): readonly { name: string; span_id: string; parent_span_id?: string }[] =>
            JSON.parse(item.text).items,
        );
        const read = spans.find((span) => span.name === "web/live/taskHistory");
        const statement = spans.find((span) => span.name.includes("from live_query_probe p"));
        assert.ok(read !== undefined && statement !== undefined);
        assert.equal(statement.parent_span_id, read.span_id);
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
