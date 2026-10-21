import { randomUUID } from "node:crypto";
import {
  PAGE_OWNER,
  PAGE_SHOWER,
  type PageLine,
  type PageOwner,
  type PageShower,
  type PageVersion,
  type PageWrite,
  pageShowerSchema,
  pageWriteSchema,
} from "@luke/features/page-wire";
import { and, desc, eq, isNull, or, type SQL } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, queryBuilder } from "../core/query.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { planPageVersion } from "../schemas/plan-page.js";
import { task } from "../schemas/task.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";
import { agentReachableBy, reachableTask, taskReachableBy } from "./workspace-store.js";

/**
 * plan-pages.ts -- the pages shown on a task or on a coding agent with no task: write a page or its next version as who showed it, list an owner's pages, and read one version, by its owner or by the page's id alone.
 *
 * A page stands on its owner (`PageOwner`): a task, whose pages any agent on
 * it and Luke write, or a coding agent on no task, whose pages are its own.
 * A write is a page's next version, taken under the owner row's own lock, so
 * two writes of one page never take one number and an owner deleted
 * meanwhile reads as gone rather than written back into being. Every
 * statement names the account beside the owner and gates on the owner's own
 * rule of who may read it (`taskReachableBy`, `agentReachableBy`), so a member
 * reads and writes the pages a teammate's agent wrote, and an owner the
 * account does not reach reads and writes as no owner, exactly as in
 * `task-store.ts` and `coding-agent-store.ts`. A version a coding agent showed
 * names it in `agent_id` whichever it stands on. A write is read against the
 * wire's own bounds before it touches a row, so nothing is stored that the
 * desktop could not read back. Pages written in the same millisecond list in
 * no particular order between them.
 */

const OwnerKeySchema = Schema.Struct({
  userId: Schema.String,
  owner: Schema.Union([
    Schema.Struct({ kind: Schema.Literal(PAGE_OWNER.TASK), taskId: Schema.String }),
    Schema.Struct({ kind: Schema.Literal(PAGE_OWNER.AGENT), agentId: Schema.String }),
  ]),
});

const PageLineRowSchema = Schema.Struct({
  pageId: Schema.String,
  title: Schema.String,
  version: Schema.Number,
  at: InstantColumnSchema,
  shownBy: Schema.NullOr(pageShowerSchema),
});

const PAGE_LINE_COLUMNS = {
  pageId: planPageVersion.pageId,
  title: planPageVersion.title,
  version: planPageVersion.version,
  at: planPageVersion.at,
  shownBy: planPageVersion.shownBy,
};

/** The versions that stand on the owner: a task's by its column, an agent's as those on no task that name it. */
function ownedBy(owner: PageOwner): SQL | undefined {
  return owner.kind === PAGE_OWNER.TASK
    ? eq(planPageVersion.taskId, owner.taskId)
    : and(isNull(planPageVersion.taskId), eq(planPageVersion.agentId, owner.agentId));
}

/** The condition that the account reaches the owner of a version, for a statement that joins the version's task and its agent: by the task's rule where it stands on one, and by the agent's where it does not. */
function ownerReachableBy(userId: string): SQL | undefined {
  return or(and(isNull(planPageVersion.taskId), agentReachableBy(userId)), taskReachableBy(userId));
}

/** The owner a version names, as the columns read it. */
function ownerOf(row: { readonly taskId: string | null; readonly agentId: string | null }) {
  if (row.taskId !== null) return { kind: PAGE_OWNER.TASK, taskId: row.taskId } as const;
  // The owner check holds one of the two to stand, so a row with neither is the database breaking its own contract.
  if (row.agentId === null) return undefined;
  return { kind: PAGE_OWNER.AGENT, agentId: row.agentId } as const;
}

/** The owner's id under its row's lock until the transaction ends; nothing where the account reaches no such owner. */
const lockOwner = SqlSchema.findOneOption({
  Request: OwnerKeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, owner }) =>
    Database.use((db) =>
      owner.kind === PAGE_OWNER.TASK
        ? db
            .select({ id: task.id })
            .from(task)
            .where(reachableTask(userId, owner.taskId))
            .for("update")
        : db
            .select({ id: codingAgent.id })
            .from(codingAgent)
            .where(and(eq(codingAgent.id, owner.agentId), agentReachableBy(userId)))
            .for("update"),
    ),
});

/** The newest version's number of one page of the owner; nothing where the owner has no such page. */
const findNewestVersion = SqlSchema.findOneOption({
  Request: Schema.Struct({ owner: OwnerKeySchema.fields.owner, pageId: Schema.String }),
  Result: Schema.Struct({ version: Schema.Number }),
  execute: ({ owner, pageId }) =>
    Database.use((db) =>
      db
        .select({ version: planPageVersion.version })
        .from(planPageVersion)
        .where(and(ownedBy(owner), eq(planPageVersion.pageId, pageId)))
        .orderBy(desc(planPageVersion.version))
        .limit(1),
    ),
});

const insertVersion = SqlSchema.findOne({
  Request: Schema.Struct({
    taskId: Schema.NullOr(Schema.String),
    agentId: Schema.NullOr(Schema.String),
    pageId: Schema.String,
    version: Schema.Number,
    title: Schema.String,
    html: Schema.String,
    shownBy: pageShowerSchema,
    at: Schema.Date,
  }),
  Result: PageLineRowSchema,
  execute: (row) =>
    Database.use((db) => db.insert(planPageVersion).values(row).returning(PAGE_LINE_COLUMNS)),
});

/** Each page of the owner by its newest version, the most recently written first. */
const findPageLines = SqlSchema.findAll({
  Request: OwnerKeySchema,
  Result: PageLineRowSchema,
  execute: ({ userId, owner }) => {
    // Note that the newest versions are picked first and ordered after, because `distinct on` must lead the ordering.
    const newest = queryBuilder
      .selectDistinctOn([planPageVersion.pageId], PAGE_LINE_COLUMNS)
      .from(planPageVersion)
      .leftJoin(task, eq(task.id, planPageVersion.taskId))
      .leftJoin(codingAgent, eq(codingAgent.id, planPageVersion.agentId))
      .where(and(ownedBy(owner), ownerReachableBy(userId)))
      .orderBy(planPageVersion.pageId, desc(planPageVersion.version))
      .as("newest");
    return Database.use((db) => db.select().from(newest).orderBy(desc(newest.at), newest.pageId));
  },
});

const findVersion = SqlSchema.findOneOption({
  Request: Schema.Struct({
    ...OwnerKeySchema.fields,
    pageId: Schema.String,
    version: Schema.Number,
  }),
  Result: Schema.Struct({ ...PageLineRowSchema.fields, html: Schema.String }),
  execute: ({ userId, owner, pageId, version }) =>
    Database.use((db) =>
      db
        .select({ ...PAGE_LINE_COLUMNS, html: planPageVersion.html })
        .from(planPageVersion)
        .leftJoin(task, eq(task.id, planPageVersion.taskId))
        .leftJoin(codingAgent, eq(codingAgent.id, planPageVersion.agentId))
        .where(
          and(
            ownedBy(owner),
            ownerReachableBy(userId),
            eq(planPageVersion.pageId, pageId),
            eq(planPageVersion.version, version),
          ),
        )
        .limit(1),
    ),
});

/** A version of a page found by the page's id alone, its newest where none is named, with the owner it stands on, gated on the owner's rule of who may read it. */
const findPageById = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    pageId: Schema.String,
    version: Schema.NullOr(Schema.Number),
  }),
  Result: Schema.Struct({
    ...PageLineRowSchema.fields,
    html: Schema.String,
    taskId: Schema.NullOr(Schema.String),
    agentId: Schema.NullOr(Schema.String),
  }),
  execute: ({ userId, pageId, version }) =>
    Database.use((db) =>
      db
        .select({
          ...PAGE_LINE_COLUMNS,
          html: planPageVersion.html,
          taskId: planPageVersion.taskId,
          agentId: planPageVersion.agentId,
        })
        .from(planPageVersion)
        .leftJoin(task, eq(task.id, planPageVersion.taskId))
        .leftJoin(codingAgent, eq(codingAgent.id, planPageVersion.agentId))
        .where(
          and(
            eq(planPageVersion.pageId, pageId),
            ownerReachableBy(userId),
            version === null ? undefined : eq(planPageVersion.version, version),
          ),
        )
        .orderBy(desc(planPageVersion.version))
        .limit(1),
    ),
});

function lineOf(row: typeof PageLineRowSchema.Type): PageLine {
  return {
    id: row.pageId,
    title: row.title,
    version: row.version,
    at: row.at.getTime(),
    ...(row.shownBy === null ? undefined : { shownBy: row.shownBy }),
  };
}

/** The columns a version is written under: its task where it stands on one, and the agent that showed it, on a task or not. */
function ownerColumns(owner: PageOwner, shownBy: PageShower) {
  const agentId = shownBy.kind === PAGE_SHOWER.AGENT ? shownBy.agentId : null;
  return owner.kind === PAGE_OWNER.TASK
    ? { taskId: owner.taskId, agentId }
    : { taskId: null, agentId: owner.agentId };
}

/**
 * Writes the page's next version, or a new page's first where the write
 * names none, on the owner, as shown by `shownBy`; the page as it now
 * stands. Nothing where the account reaches no such owner, or the owner no
 * such page, and a schema failure, with nothing written, for a write past
 * the wire's bounds.
 */
export function writePage(
  userId: string,
  owner: PageOwner,
  write: PageWrite,
  shownBy: PageShower,
): TaskStoreEffect<Option.Option<PageLine>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const admitted = yield* Schema.decodeUnknownEffect(pageWriteSchema)(write);
        const locked = yield* lockOwner({ userId, owner });
        if (Option.isNone(locked)) return Option.none<PageLine>();
        const newest =
          admitted.pageId === undefined
            ? Option.some({ version: 0 })
            : yield* findNewestVersion({ owner, pageId: admitted.pageId });
        if (Option.isNone(newest)) return Option.none<PageLine>();
        const at = yield* DateTime.nowAsDate;
        // An insert that returned no row is the database breaking its own contract, not an outcome.
        const row = yield* insertVersion({
          ...ownerColumns(owner, shownBy),
          pageId: admitted.pageId ?? randomUUID(),
          version: newest.value.version + 1,
          title: admitted.title,
          html: admitted.html,
          shownBy,
          at,
        }).pipe(Effect.catchTag("NoSuchElementError", Effect.die));
        return Option.some(lineOf(row));
      }),
    ),
  );
}

/** The owner's pages, each by its newest version, the most recently written first; none where the account reaches no such owner. */
export function listPages(userId: string, owner: PageOwner): TaskStoreEffect<readonly PageLine[]> {
  return Effect.map(findPageLines({ userId, owner }), (rows) => rows.map(lineOf));
}

/** One version of one page of the owner, with its HTML; nothing where the account reaches no such owner, page, or version. */
export function readPageVersion(
  userId: string,
  owner: PageOwner,
  pageId: string,
  version: number,
): TaskStoreEffect<Option.Option<PageVersion>> {
  return Effect.map(
    findVersion({ userId, owner, pageId, version }),
    Option.map((row) => ({ ...lineOf(row), html: row.html })),
  );
}

/** A page read by its id alone: the owner it stands on, the version asked for, and the newest version there is. */
export interface FoundPage {
  readonly owner: PageOwner;
  readonly page: PageVersion;
  readonly newestVersion: number;
}

/**
 * One version of the page by the page's id alone, the newest where none is
 * named, with the owner it stands on and its newest version; nothing where
 * the account reaches no owner holding such a page or version.
 */
export function readPageById(
  userId: string,
  pageId: string,
  version: number | undefined,
): TaskStoreEffect<Option.Option<FoundPage>> {
  return Effect.gen(function* () {
    const found = yield* findPageById({ userId, pageId, version: version ?? null });
    if (Option.isNone(found)) return Option.none();
    const { taskId, agentId, html, ...line } = found.value;
    const owner = ownerOf({ taskId, agentId });
    if (owner === undefined) return yield* Effect.die("a page version stands on no owner");
    const newest = yield* findNewestVersion({ owner, pageId });
    return Option.some({
      owner,
      page: { ...lineOf(line), html },
      newestVersion: Option.match(newest, {
        onNone: () => line.version,
        onSome: (row) => row.version,
      }),
    });
  });
}
