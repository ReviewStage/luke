import { randomUUID } from "node:crypto";
import {
  type PageLine,
  type PageVersion,
  type PageWrite,
  pageWriteSchema,
} from "@sidecar/hosted/page-wire";
import { and, desc, eq } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import { db } from "../core/query.js";
import { plan } from "../schemas/plan.js";
import { planPageVersion } from "../schemas/plan-page.js";
import { InstantColumnSchema } from "./columns.js";
import type { PlanStoreEffect } from "./plan-store.js";
import { planReachableBy, reachablePlan } from "./workspace-store.js";

/**
 * plan-pages.ts -- a plan's pages: write a page or its next version, list the plan's pages, and read one version.
 *
 * A write is a page's next version, taken under the plan row's own lock, so
 * two writes of one page never take one number and a plan deleted meanwhile
 * reads as gone rather than written back into being. Every statement names
 * the account beside the plan and gates on its membership of the plan's
 * workspace, so a plan of a workspace the account is not in reads and
 * writes as no plan, exactly as in `plan-store.ts`. A write is read against
 * the wire's own bounds before it touches a row, so nothing is stored that
 * the desktop could not read back. Pages written in the same millisecond
 * list in no particular order between them.
 */

const PlanKeySchema = Schema.Struct({ userId: Schema.String, planId: Schema.String });

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
const lockPlan = SqlSchema.findOneOption({
  Request: PlanKeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, planId }) =>
    db.select({ id: plan.id }).from(plan).where(reachablePlan(userId, planId)).for("update"),
});

/** The newest version's number of one page of the plan; nothing where the plan has no such page. */
const findNewestVersion = SqlSchema.findOneOption({
  Request: Schema.Struct({ planId: Schema.String, pageId: Schema.String }),
  Result: Schema.Struct({ version: Schema.Number }),
  execute: ({ planId, pageId }) =>
    db
      .select({ version: planPageVersion.version })
      .from(planPageVersion)
      .where(and(eq(planPageVersion.planId, planId), eq(planPageVersion.pageId, pageId)))
      .orderBy(desc(planPageVersion.version))
      .limit(1),
});

const insertVersion = SqlSchema.findOne({
  Request: Schema.Struct({
    planId: Schema.String,
    pageId: Schema.String,
    version: Schema.Number,
    title: Schema.String,
    html: Schema.String,
    at: Schema.Date,
  }),
  Result: PageLineRowSchema,
  execute: (row) => db.insert(planPageVersion).values(row).returning(PAGE_LINE_COLUMNS),
});

/** Each page of the plan by its newest version, the most recently written first. */
const findPageLines = SqlSchema.findAll({
  Request: PlanKeySchema,
  Result: PageLineRowSchema,
  execute: ({ userId, planId }) => {
    // Note that the newest versions are picked first and ordered after, because `distinct on` must lead the ordering.
    const newest = db
      .selectDistinctOn([planPageVersion.pageId], PAGE_LINE_COLUMNS)
      .from(planPageVersion)
      .innerJoin(plan, eq(plan.id, planPageVersion.planId))
      .where(and(eq(planPageVersion.planId, planId), planReachableBy(userId)))
      .orderBy(planPageVersion.pageId, desc(planPageVersion.version))
      .as("newest");
    return db.select().from(newest).orderBy(desc(newest.at), newest.pageId);
  },
});

const findVersion = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    planId: Schema.String,
    pageId: Schema.String,
    version: Schema.Number,
  }),
  Result: Schema.Struct({ ...PageLineRowSchema.fields, html: Schema.String }),
  execute: ({ userId, planId, pageId, version }) =>
    db
      .select({ ...PAGE_LINE_COLUMNS, html: planPageVersion.html })
      .from(planPageVersion)
      .innerJoin(plan, eq(plan.id, planPageVersion.planId))
      .where(
        and(
          eq(planPageVersion.planId, planId),
          planReachableBy(userId),
          eq(planPageVersion.pageId, pageId),
          eq(planPageVersion.version, version),
        ),
      )
      .limit(1),
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
  planId: string,
  write: PageWrite,
): PlanStoreEffect<Option.Option<PageLine>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const admitted = yield* Schema.decodeUnknownEffect(pageWriteSchema)(write);
        const locked = yield* lockPlan({ userId, planId });
        if (Option.isNone(locked)) return Option.none<PageLine>();
        const newest =
          admitted.pageId === undefined
            ? Option.some({ version: 0 })
            : yield* findNewestVersion({ planId, pageId: admitted.pageId });
        if (Option.isNone(newest)) return Option.none<PageLine>();
        const at = yield* DateTime.nowAsDate;
        // An insert that returned no row is the database breaking its own contract, not an outcome.
        const row = yield* insertVersion({
          planId,
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
export function listPages(userId: string, planId: string): PlanStoreEffect<readonly PageLine[]> {
  return Effect.map(findPageLines({ userId, planId }), (rows) => rows.map(lineOf));
}

/** One version of one page of the plan, with its HTML; nothing where the account reaches no such plan, page, or version. */
export function readPageVersion(
  userId: string,
  planId: string,
  pageId: string,
  version: number,
): PlanStoreEffect<Option.Option<PageVersion>> {
  return Effect.map(
    findVersion({ userId, planId, pageId, version }),
    Option.map((row) => ({ ...lineOf(row), html: row.html })),
  );
}
