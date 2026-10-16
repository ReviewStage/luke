import { randomUUID } from "node:crypto";
import {
  type PageLine,
  type PageVersion,
  type PageWrite,
  pageWriteSchema,
} from "@luke/features/page-wire";
import { and, desc, eq } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, queryBuilder } from "../core/query.js";
import { task } from "../schemas/plan.js";
import { planPageVersion } from "../schemas/plan-page.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";
import { reachableTask, taskReachableBy } from "./workspace-store.js";

/**
 * plan-pages.ts -- a plan's pages: write a page or its next version, list the plan's pages, and read one version.
 *
 * A write is a page's next version, taken under the plan row's own lock, so
 * two writes of one page never take one number and a plan deleted meanwhile
 * reads as gone rather than written back into being. Every statement names
 * the account beside the plan and gates on its membership of the plan's
 * workspace, so a member reads and writes the pages a teammate wrote, and a
 * plan of a workspace the account is not in reads and writes as no plan,
 * exactly as in `task-store.ts`. A write is read against
 * the wire's own bounds before it touches a row, so nothing is stored that
 * the desktop could not read back. Pages written in the same millisecond
 * list in no particular order between them.
 */

const TaskKeySchema = Schema.Struct({ userId: Schema.String, taskId: Schema.String });

const PageLineRowSchema = Schema.Struct({
  pageId: Schema.String,
  title: Schema.String,
  version: Schema.Number,
  at: InstantColumnSchema,
});

const PAGE_LINE_COLUMNS = {
  pageId: planPageVersion.pageId,
  title: planPageVersion.title,
  version: planPageVersion.version,
  at: planPageVersion.at,
};

/** The plan's id under its row's lock until the transaction ends; nothing where the account reaches no such plan. */
const lockTask = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db.select({ id: task.id }).from(task).where(reachableTask(userId, taskId)).for("update"),
    ),
});

/** The newest version's number of one page of the plan; nothing where the plan has no such page. */
const findNewestVersion = SqlSchema.findOneOption({
  Request: Schema.Struct({ taskId: Schema.String, pageId: Schema.String }),
  Result: Schema.Struct({ version: Schema.Number }),
  execute: ({ taskId, pageId }) =>
    Database.use((db) =>
      db
        .select({ version: planPageVersion.version })
        .from(planPageVersion)
        .where(and(eq(planPageVersion.taskId, taskId), eq(planPageVersion.pageId, pageId)))
        .orderBy(desc(planPageVersion.version))
        .limit(1),
    ),
});

const insertVersion = SqlSchema.findOne({
  Request: Schema.Struct({
    taskId: Schema.String,
    pageId: Schema.String,
    version: Schema.Number,
    title: Schema.String,
    html: Schema.String,
    at: Schema.Date,
  }),
  Result: PageLineRowSchema,
  execute: (row) =>
    Database.use((db) => db.insert(planPageVersion).values(row).returning(PAGE_LINE_COLUMNS)),
});

/** Each page of the plan by its newest version, the most recently written first. */
const findPageLines = SqlSchema.findAll({
  Request: TaskKeySchema,
  Result: PageLineRowSchema,
  execute: ({ userId, taskId }) => {
    // Note that the newest versions are picked first and ordered after, because `distinct on` must lead the ordering.
    const newest = queryBuilder
      .selectDistinctOn([planPageVersion.pageId], PAGE_LINE_COLUMNS)
      .from(planPageVersion)
      .innerJoin(task, eq(task.id, planPageVersion.taskId))
      .where(and(eq(planPageVersion.taskId, taskId), taskReachableBy(userId)))
      .orderBy(planPageVersion.pageId, desc(planPageVersion.version))
      .as("newest");
    return Database.use((db) => db.select().from(newest).orderBy(desc(newest.at), newest.pageId));
  },
});

const findVersion = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.String,
    pageId: Schema.String,
    version: Schema.Number,
  }),
  Result: Schema.Struct({ ...PageLineRowSchema.fields, html: Schema.String }),
  execute: ({ userId, taskId, pageId, version }) =>
    Database.use((db) =>
      db
        .select({ ...PAGE_LINE_COLUMNS, html: planPageVersion.html })
        .from(planPageVersion)
        .innerJoin(task, eq(task.id, planPageVersion.taskId))
        .where(
          and(
            eq(planPageVersion.taskId, taskId),
            taskReachableBy(userId),
            eq(planPageVersion.pageId, pageId),
            eq(planPageVersion.version, version),
          ),
        )
        .limit(1),
    ),
});

function lineOf(row: typeof PageLineRowSchema.Type): PageLine {
  return { id: row.pageId, title: row.title, version: row.version, at: row.at.getTime() };
}

/**
 * Writes the page's next version, or a new page's first where the write
 * names none; the page as it now stands. Nothing where the account reaches no
 * such plan, or the plan no such page, and a schema failure, with nothing
 * written, for a write past the wire's bounds.
 */
export function writePage(
  userId: string,
  taskId: string,
  write: PageWrite,
): TaskStoreEffect<Option.Option<PageLine>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const admitted = yield* Schema.decodeUnknownEffect(pageWriteSchema)(write);
        const locked = yield* lockTask({ userId, taskId });
        if (Option.isNone(locked)) return Option.none<PageLine>();
        const newest =
          admitted.pageId === undefined
            ? Option.some({ version: 0 })
            : yield* findNewestVersion({ taskId, pageId: admitted.pageId });
        if (Option.isNone(newest)) return Option.none<PageLine>();
        const at = yield* DateTime.nowAsDate;
        // An insert that returned no row is the database breaking its own contract, not an outcome.
        const row = yield* insertVersion({
          taskId,
          pageId: admitted.pageId ?? randomUUID(),
          version: newest.value.version + 1,
          title: admitted.title,
          html: admitted.html,
          at,
        }).pipe(Effect.catchTag("NoSuchElementError", Effect.die));
        return Option.some(lineOf(row));
      }),
    ),
  );
}

/** The plan's pages, each by its newest version, the most recently written first; none where the account reaches no such plan. */
export function listPages(userId: string, taskId: string): TaskStoreEffect<readonly PageLine[]> {
  return Effect.map(findPageLines({ userId, taskId }), (rows) => rows.map(lineOf));
}

/** One version of one page of the plan, with its HTML; nothing where the account reaches no such plan, page, or version. */
export function readPageVersion(
  userId: string,
  taskId: string,
  pageId: string,
  version: number,
): TaskStoreEffect<Option.Option<PageVersion>> {
  return Effect.map(
    findVersion({ userId, taskId, pageId, version }),
    Option.map((row) => ({ ...lineOf(row), html: row.html })),
  );
}
