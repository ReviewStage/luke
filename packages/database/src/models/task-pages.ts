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
} from "@repo/features/page-wire";
import { and, desc, eq, isNull, or, type SQL } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, queryBuilder } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { taskPageVersion } from "../schemas/task-page.js";
import { task } from "../schemas/task.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";
import { agentReachableBy, reachableTask, taskReachableBy } from "./workspace-store.js";

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
  pageId: taskPageVersion.pageId,
  title: taskPageVersion.title,
  version: taskPageVersion.version,
  at: taskPageVersion.at,
  shownBy: taskPageVersion.shownBy,
};

function ownedBy(owner: PageOwner): SQL | undefined {
  return owner.kind === PAGE_OWNER.TASK
    ? eq(taskPageVersion.taskId, owner.taskId)
    : and(isNull(taskPageVersion.taskId), eq(taskPageVersion.agentId, owner.agentId));
}

function ownerReachableBy(userId: string): SQL | undefined {
  return or(and(isNull(taskPageVersion.taskId), agentReachableBy(userId)), taskReachableBy(userId));
}

function ownerOf(row: { readonly taskId: string | null; readonly agentId: string | null }) {
  if (row.taskId !== null) return { kind: PAGE_OWNER.TASK, taskId: row.taskId } as const;
  if (row.agentId === null) return undefined;
  return { kind: PAGE_OWNER.AGENT, agentId: row.agentId } as const;
}

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
            .select({ id: agentTable.id })
            .from(agentTable)
            .where(and(eq(agentTable.id, owner.agentId), agentReachableBy(userId)))
            .for("update"),
    ),
});

const findNewestVersion = SqlSchema.findOneOption({
  Request: Schema.Struct({ owner: OwnerKeySchema.fields.owner, pageId: Schema.String }),
  Result: Schema.Struct({ version: Schema.Number }),
  execute: ({ owner, pageId }) =>
    Database.use((db) =>
      db
        .select({ version: taskPageVersion.version })
        .from(taskPageVersion)
        .where(and(ownedBy(owner), eq(taskPageVersion.pageId, pageId)))
        .orderBy(desc(taskPageVersion.version))
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
    Database.use((db) => db.insert(taskPageVersion).values(row).returning(PAGE_LINE_COLUMNS)),
});

const findPageLines = SqlSchema.findAll({
  Request: OwnerKeySchema,
  Result: PageLineRowSchema,
  execute: ({ userId, owner }) => {
    const newest = queryBuilder
      .selectDistinctOn([taskPageVersion.pageId], PAGE_LINE_COLUMNS)
      .from(taskPageVersion)
      .leftJoin(task, eq(task.id, taskPageVersion.taskId))
      .leftJoin(agentTable, eq(agentTable.id, taskPageVersion.agentId))
      .where(and(ownedBy(owner), ownerReachableBy(userId)))
      .orderBy(taskPageVersion.pageId, desc(taskPageVersion.version))
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
        .select({ ...PAGE_LINE_COLUMNS, html: taskPageVersion.html })
        .from(taskPageVersion)
        .leftJoin(task, eq(task.id, taskPageVersion.taskId))
        .leftJoin(agentTable, eq(agentTable.id, taskPageVersion.agentId))
        .where(
          and(
            ownedBy(owner),
            ownerReachableBy(userId),
            eq(taskPageVersion.pageId, pageId),
            eq(taskPageVersion.version, version),
          ),
        )
        .limit(1),
    ),
});

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
          html: taskPageVersion.html,
          taskId: taskPageVersion.taskId,
          agentId: taskPageVersion.agentId,
        })
        .from(taskPageVersion)
        .leftJoin(task, eq(task.id, taskPageVersion.taskId))
        .leftJoin(agentTable, eq(agentTable.id, taskPageVersion.agentId))
        .where(
          and(
            eq(taskPageVersion.pageId, pageId),
            ownerReachableBy(userId),
            version === null ? undefined : eq(taskPageVersion.version, version),
          ),
        )
        .orderBy(desc(taskPageVersion.version))
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

function ownerColumns(owner: PageOwner, shownBy: PageShower) {
  const agentId = shownBy.kind === PAGE_SHOWER.AGENT ? shownBy.agentId : null;
  return owner.kind === PAGE_OWNER.TASK
    ? { taskId: owner.taskId, agentId }
    : { taskId: null, agentId: owner.agentId };
}

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

export function listPages(userId: string, owner: PageOwner): TaskStoreEffect<readonly PageLine[]> {
  return Effect.map(findPageLines({ userId, owner }), (rows) => rows.map(lineOf));
}

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

export interface FoundPage {
  readonly owner: PageOwner;
  readonly page: PageVersion;
  readonly newestVersion: number;
}

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
