import {
  type AgentSectionEntry,
  TASK_SECTION_BOUNDS,
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSectionEntry,
  type TaskSections,
  type TaskSectionsWritten,
  type TaskSectionWrite,
  taskSectionIconSchema,
} from "@repo/features/task-section-wire";
import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, queryBuilder } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { user } from "../schemas/auth.js";
import { task } from "../schemas/task.js";
import { agentSectionEntry, taskSection, taskSectionEntry } from "../schemas/task-section.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";
import {
  AGENT_WORKSPACE,
  agentVisibleTo,
  isWorkspaceMember,
  taskReachableBy,
  workspaceReachableBy,
} from "./workspace-store.js";

const SectionRowSchema = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  title: Schema.String,
  icon: Schema.NullOr(taskSectionIconSchema),
  position: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
});

type SectionRow = typeof SectionRowSchema.Type;

const EntryRowSchema = Schema.Struct({
  taskId: Schema.String,
  sectionId: Schema.String,
  position: Schema.NullOr(Schema.String),
  addedAt: InstantColumnSchema,
});

type EntryRow = typeof EntryRowSchema.Type;

const AgentEntryRowSchema = Schema.Struct({
  agentId: Schema.String,
  sectionId: Schema.String,
  position: Schema.NullOr(Schema.String),
  addedAt: InstantColumnSchema,
});

type AgentEntryRow = typeof AgentEntryRowSchema.Type;

const AGENT_ENTRY_COLUMNS = {
  agentId: agentSectionEntry.agentId,
  sectionId: agentSectionEntry.sectionId,
  position: agentSectionEntry.position,
  addedAt: agentSectionEntry.addedAt,
};

function agentEntryStands(userId: string) {
  return and(
    eq(agentSectionEntry.userId, userId),
    eq(AGENT_WORKSPACE, taskSection.organizationId),
    isNull(agentTable.taskId),
    agentVisibleTo(userId),
  );
}

function ownAgentEntry(userId: string, agentId: string) {
  return and(eq(agentSectionEntry.userId, userId), eq(agentSectionEntry.agentId, agentId));
}

const SECTION_COLUMNS = {
  id: taskSection.id,
  organizationId: taskSection.organizationId,
  title: taskSection.title,
  icon: taskSection.icon,
  position: taskSection.position,
  createdAt: taskSection.createdAt,
};

const SectionKeySchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

const TXID = { txid: sql<string>`pg_current_xact_id()::text` };

const WrittenSchema = Schema.Struct({ txid: Schema.String });

type Written = typeof WrittenSchema.Type;

const findSections = SqlSchema.findAll({
  Request: Schema.String,
  Result: SectionRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select(SECTION_COLUMNS)
        .from(taskSection)
        .where(
          and(
            eq(taskSection.userId, userId),
            workspaceReachableBy(userId, taskSection.organizationId),
          ),
        )
        .orderBy(asc(taskSection.createdAt), asc(taskSection.id)),
    ),
});

const findEntries = SqlSchema.findAll({
  Request: Schema.String,
  Result: EntryRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({
          taskId: taskSectionEntry.taskId,
          sectionId: taskSectionEntry.sectionId,
          position: taskSectionEntry.position,
          addedAt: taskSectionEntry.addedAt,
        })
        .from(taskSectionEntry)
        .innerJoin(taskSection, eq(taskSection.id, taskSectionEntry.sectionId))
        .innerJoin(task, eq(task.id, taskSectionEntry.taskId))
        .where(
          and(
            eq(taskSectionEntry.userId, userId),
            eq(task.organizationId, taskSection.organizationId),
            taskReachableBy(userId),
          ),
        )
        .orderBy(asc(taskSectionEntry.addedAt), asc(taskSectionEntry.taskId)),
    ),
});

const findAgentEntries = SqlSchema.findAll({
  Request: Schema.String,
  Result: AgentEntryRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select(AGENT_ENTRY_COLUMNS)
        .from(agentSectionEntry)
        .innerJoin(taskSection, eq(taskSection.id, agentSectionEntry.sectionId))
        .innerJoin(agentTable, eq(agentTable.id, agentSectionEntry.agentId))
        .where(agentEntryStands(userId))
        .orderBy(asc(agentSectionEntry.addedAt), asc(agentSectionEntry.agentId)),
    ),
});

const findSection = SqlSchema.findOneOption({
  Request: SectionKeySchema,
  Result: SectionRowSchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select(SECTION_COLUMNS)
        .from(taskSection)
        .where(
          and(
            eq(taskSection.id, id),
            eq(taskSection.userId, userId),
            workspaceReachableBy(userId, taskSection.organizationId),
          ),
        )
        .limit(1),
    ),
});

const countEntriesIn = SqlSchema.findAll({
  Request: SectionKeySchema,
  Result: Schema.Struct({ held: Schema.Number }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({ held: count() })
        .from(taskSectionEntry)
        .where(and(eq(taskSectionEntry.userId, userId), eq(taskSectionEntry.sectionId, id))),
    ),
});

const countSections = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ held: Schema.Number }),
  execute: (userId) =>
    Database.use((db) =>
      db.select({ held: count() }).from(taskSection).where(eq(taskSection.userId, userId)),
    ),
});

const lockAccount = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (userId) =>
    Database.use((db) =>
      db.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update"),
    ),
});

const findTaskIn = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.String,
    organizationId: Schema.String,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, taskId, organizationId }) =>
    Database.use((db) =>
      db
        .select({ id: task.id })
        .from(task)
        .where(
          and(
            eq(task.id, taskId),
            eq(task.organizationId, organizationId),
            taskReachableBy(userId),
          ),
        )
        .limit(1),
    ),
});

const findAgentIn = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    organizationId: Schema.String,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, agentId, organizationId }) =>
    Database.use((db) =>
      db
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(
          and(
            eq(agentTable.id, agentId),
            eq(AGENT_WORKSPACE, organizationId),
            isNull(agentTable.taskId),
            agentVisibleTo(userId),
          ),
        )
        .limit(1),
    ),
});

const findAgentEntry = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: AgentEntryRowSchema,
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select(AGENT_ENTRY_COLUMNS)
        .from(agentSectionEntry)
        .where(ownAgentEntry(userId, agentId))
        .limit(1),
    ),
});

const findEntry = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  Result: EntryRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({
          taskId: taskSectionEntry.taskId,
          sectionId: taskSectionEntry.sectionId,
          position: taskSectionEntry.position,
          addedAt: taskSectionEntry.addedAt,
        })
        .from(taskSectionEntry)
        .where(and(eq(taskSectionEntry.userId, userId), eq(taskSectionEntry.taskId, taskId)))
        .limit(1),
    ),
});

const insertSection = SqlSchema.findAll({
  Request: Schema.Struct({
    id: Schema.String,
    userId: Schema.String,
    organizationId: Schema.String,
    title: Schema.String,
    icon: Schema.NullOr(taskSectionIconSchema),
    now: Schema.Date,
  }),
  Result: WrittenSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(taskSection)
        .values({
          id: write.id,
          userId: write.userId,
          organizationId: write.organizationId,
          title: write.title,
          icon: write.icon,
          createdAt: write.now,
        })
        .onConflictDoNothing()
        .returning(TXID),
    ),
});

const editSection = SqlSchema.findAll({
  Request: Schema.Struct({
    ...SectionKeySchema.fields,
    title: Schema.String,
    icon: Schema.NullOr(taskSectionIconSchema),
  }),
  Result: WrittenSchema,
  execute: ({ userId, id, title, icon }) =>
    Database.use((db) =>
      db
        .update(taskSection)
        .set({ title, icon })
        .where(
          and(
            eq(taskSection.id, id),
            eq(taskSection.userId, userId),
            or(
              sql`${taskSection.title} is distinct from ${title}`,
              sql`${taskSection.icon} is distinct from ${icon === null ? null : JSON.stringify(icon)}::jsonb`,
            ),
          ),
        )
        .returning(TXID),
    ),
});

const moveSection = SqlSchema.findAll({
  Request: Schema.Struct({ ...SectionKeySchema.fields, position: Schema.String }),
  Result: WrittenSchema,
  execute: ({ userId, id, position }) =>
    Database.use((db) =>
      db
        .update(taskSection)
        .set({ position })
        .where(
          and(
            eq(taskSection.id, id),
            eq(taskSection.userId, userId),
            sql`${taskSection.position} is distinct from ${position}`,
          ),
        )
        .returning(TXID),
    ),
});

const deleteSection = SqlSchema.findAll({
  Request: SectionKeySchema,
  Result: WrittenSchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .delete(taskSection)
        .where(and(eq(taskSection.id, id), eq(taskSection.userId, userId)))
        .returning(TXID),
    ),
});

const putEntry = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.String,
    sectionId: Schema.String,
    position: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: WrittenSchema,
  execute: ({ userId, taskId, sectionId, position, now }) =>
    Database.use((db) =>
      db
        .insert(taskSectionEntry)
        .values({ userId, taskId, sectionId, position, addedAt: now })
        .onConflictDoUpdate({
          target: [taskSectionEntry.userId, taskSectionEntry.taskId],
          set: { sectionId, position, addedAt: now },
        })
        .returning(TXID),
    ),
});

const placeEntry = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String, position: Schema.String }),
  Result: WrittenSchema,
  execute: ({ userId, taskId, position }) =>
    Database.use((db) =>
      db
        .update(taskSectionEntry)
        .set({ position })
        .where(
          and(
            eq(taskSectionEntry.userId, userId),
            eq(taskSectionEntry.taskId, taskId),
            sql`${taskSectionEntry.position} is distinct from ${position}`,
          ),
        )
        .returning(TXID),
    ),
});

const deleteEntry = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  Result: WrittenSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .delete(taskSectionEntry)
        .where(and(eq(taskSectionEntry.userId, userId), eq(taskSectionEntry.taskId, taskId)))
        .returning(TXID),
    ),
});

const putAgentEntry = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    sectionId: Schema.String,
    position: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: WrittenSchema,
  execute: ({ userId, agentId, sectionId, position, now }) =>
    Database.use((db) =>
      db
        .insert(agentSectionEntry)
        .values({ userId, agentId: agentId, sectionId, position, addedAt: now })
        .onConflictDoUpdate({
          target: [agentSectionEntry.userId, agentSectionEntry.agentId],
          set: { sectionId, position, addedAt: now },
        })
        .returning(TXID),
    ),
});

const placeAgentEntry = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    position: Schema.String,
  }),
  Result: WrittenSchema,
  execute: ({ userId, agentId, position }) =>
    Database.use((db) =>
      db
        .update(agentSectionEntry)
        .set({ position })
        .where(
          and(
            ownAgentEntry(userId, agentId),
            sql`${agentSectionEntry.position} is distinct from ${position}`,
          ),
        )
        .returning(TXID),
    ),
});

const deleteAgentEntry = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: WrittenSchema,
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db.delete(agentSectionEntry).where(ownAgentEntry(userId, agentId)).returning(TXID),
    ),
});

type Applied = Option.Option<string | undefined>;

function done(rows: readonly Written[]): Applied {
  return Option.some(rows[0]?.txid);
}

const REFUSED: Applied = Option.none();

const UNCHANGED: Applied = Option.some(undefined);

function sectionOf(row: SectionRow): TaskSection {
  return {
    id: row.id,
    workspaceId: row.organizationId,
    title: row.title,
    ...(row.icon === null ? undefined : { icon: row.icon }),
    ...(row.position === null ? undefined : { position: row.position }),
    createdAt: row.createdAt.getTime(),
  };
}

function entryOf(row: EntryRow): TaskSectionEntry {
  return {
    taskId: row.taskId,
    sectionId: row.sectionId,
    ...(row.position === null ? undefined : { position: row.position }),
    addedAt: row.addedAt.getTime(),
  };
}

function agentEntryOf(row: AgentEntryRow): AgentSectionEntry {
  return {
    agentId: row.agentId,
    sectionId: row.sectionId,
    ...(row.position === null ? undefined : { position: row.position }),
    addedAt: row.addedAt.getTime(),
  };
}

export function listTaskSections(userId: string): TaskStoreEffect<TaskSections> {
  return Effect.gen(function* () {
    const sections = yield* findSections(userId);
    const entries = yield* findEntries(userId);
    const agentEntries = yield* findAgentEntries(userId);
    return {
      sections: sections.map(sectionOf),
      entries: entries.map(entryOf),
      agentEntries: agentEntries.map(agentEntryOf),
    };
  });
}

export type TaskSectionsLiveStatements = Readonly<
  Record<"sections" | "entries" | "agentEntries", LiveStatement>
>;

export function taskSectionsLiveStatements(
  userId: string,
): Option.Option<TaskSectionsLiveStatements> {
  const sections = queryBuilder
    .select(
      liveSelection(
        {
          id: taskSection.id,
          workspaceId: taskSection.organizationId,
          title: taskSection.title,
          icon: taskSection.icon,
          position: taskSection.position,
        },
        { createdAt: taskSection.createdAt },
      ),
    )
    .from(taskSection)
    .where(
      and(eq(taskSection.userId, userId), workspaceReachableBy(userId, taskSection.organizationId)),
    );
  const entries = queryBuilder
    .select(
      liveSelection(
        {
          taskId: taskSectionEntry.taskId,
          sectionId: taskSectionEntry.sectionId,
          position: taskSectionEntry.position,
        },
        { addedAt: taskSectionEntry.addedAt },
      ),
    )
    .from(taskSectionEntry)
    .innerJoin(taskSection, eq(taskSection.id, taskSectionEntry.sectionId))
    .innerJoin(task, eq(task.id, taskSectionEntry.taskId))
    .where(
      and(
        eq(taskSectionEntry.userId, userId),
        eq(task.organizationId, taskSection.organizationId),
        taskReachableBy(userId),
      ),
    );
  const agentEntries = queryBuilder
    .select(
      liveSelection(
        {
          agentId: agentSectionEntry.agentId,
          sectionId: agentSectionEntry.sectionId,
          position: agentSectionEntry.position,
        },
        { addedAt: agentSectionEntry.addedAt },
      ),
    )
    .from(agentSectionEntry)
    .innerJoin(taskSection, eq(taskSection.id, agentSectionEntry.sectionId))
    .innerJoin(agentTable, eq(agentTable.id, agentSectionEntry.agentId))
    .where(agentEntryStands(userId));
  return Option.all({
    sections: liveStatementOf(sections),
    entries: liveStatementOf(entries),
    agentEntries: liveStatementOf(agentEntries),
  });
}

function createSection(
  userId: string,
  write: Extract<TaskSectionWrite, { kind: typeof TASK_SECTION_WRITE.CREATE }>,
): TaskStoreEffect<Applied> {
  return Effect.gen(function* () {
    if (Option.isSome(yield* findSection({ userId, id: write.id }))) return UNCHANGED;
    if (!(yield* isWorkspaceMember(userId, write.workspaceId))) return REFUSED;
    const [counted] = yield* countSections(userId);
    if ((counted?.held ?? 0) >= TASK_SECTION_BOUNDS.MAX_SECTIONS) return REFUSED;
    const now = yield* DateTime.nowAsDate;
    const written = yield* insertSection({
      id: write.id,
      userId,
      organizationId: write.workspaceId,
      title: write.title,
      icon: write.icon ?? null,
      now,
    });
    return Option.isSome(yield* findSection({ userId, id: write.id })) ? done(written) : REFUSED;
  });
}

function placeTask(
  userId: string,
  write: Extract<TaskSectionWrite, { kind: typeof TASK_SECTION_WRITE.PLACE }>,
): TaskStoreEffect<Applied> {
  return Effect.gen(function* () {
    const { taskId, sectionId, position } = write;
    if (sectionId === null) return done(yield* deleteEntry({ userId, taskId }));
    const section = yield* findSection({ userId, id: sectionId });
    if (Option.isNone(section)) return REFUSED;
    const organizationId = section.value.organizationId;
    if (Option.isNone(yield* findTaskIn({ userId, taskId, organizationId }))) return REFUSED;
    const standing = yield* findEntry({ userId, taskId });
    if (Option.isSome(standing) && standing.value.sectionId === sectionId) {
      if (position === undefined) return UNCHANGED;
      return done(yield* placeEntry({ userId, taskId, position }));
    }
    const now = yield* DateTime.nowAsDate;
    return done(yield* putEntry({ userId, taskId, sectionId, position: position ?? null, now }));
  });
}

function placeAgent(
  userId: string,
  write: Extract<TaskSectionWrite, { kind: typeof TASK_SECTION_WRITE.PLACE_AGENT }>,
): TaskStoreEffect<Applied> {
  return Effect.gen(function* () {
    const { agentId, sectionId, position } = write;
    if (sectionId === null) return done(yield* deleteAgentEntry({ userId, agentId }));
    const section = yield* findSection({ userId, id: sectionId });
    if (Option.isNone(section)) return REFUSED;
    const organizationId = section.value.organizationId;
    if (Option.isNone(yield* findAgentIn({ userId, agentId, organizationId }))) return REFUSED;
    const standing = yield* findAgentEntry({ userId, agentId });
    if (Option.isSome(standing) && standing.value.sectionId === sectionId) {
      if (position === undefined) return UNCHANGED;
      return done(yield* placeAgentEntry({ userId, agentId, position }));
    }
    const now = yield* DateTime.nowAsDate;
    return done(
      yield* putAgentEntry({ userId, agentId, sectionId, position: position ?? null, now }),
    );
  });
}

export interface DeletedTaskSection {
  readonly section: TaskSection;
  readonly returnedTasks: number;
  readonly txid: string | undefined;
}

function sectionTaken(
  userId: string,
  id: string,
  workspaceId?: string,
): TaskStoreEffect<Option.Option<DeletedTaskSection>> {
  return Effect.gen(function* () {
    const found = yield* findSection({ userId, id });
    if (Option.isNone(found)) return Option.none();
    if (workspaceId !== undefined && found.value.organizationId !== workspaceId) {
      return Option.none();
    }
    const [entries] = yield* countEntriesIn({ userId, id });
    const [written] = yield* deleteSection({ userId, id });
    return Option.some({
      section: sectionOf(found.value),
      returnedTasks: entries?.held ?? 0,
      txid: written?.txid,
    });
  });
}

function applyWrite(userId: string, write: TaskSectionWrite): TaskStoreEffect<Applied> {
  switch (write.kind) {
    case TASK_SECTION_WRITE.CREATE:
      return createSection(userId, write);
    case TASK_SECTION_WRITE.EDIT:
      return Effect.gen(function* () {
        if (Option.isNone(yield* findSection({ userId, id: write.id }))) return REFUSED;
        return done(
          yield* editSection({ userId, id: write.id, title: write.title, icon: write.icon }),
        );
      });
    case TASK_SECTION_WRITE.MOVE:
      return Effect.gen(function* () {
        if (Option.isNone(yield* findSection({ userId, id: write.id }))) return REFUSED;
        return done(yield* moveSection({ userId, id: write.id, position: write.position }));
      });
    case TASK_SECTION_WRITE.DELETE:
      return Effect.map(sectionTaken(userId, write.id), (taken) =>
        Option.isNone(taken) ? UNCHANGED : Option.some(taken.value.txid),
      );
    case TASK_SECTION_WRITE.PLACE:
      return placeTask(userId, write);
    case TASK_SECTION_WRITE.PLACE_AGENT:
      return placeAgent(userId, write);
  }
}

export function writeTaskSections(
  userId: string,
  write: TaskSectionWrite,
): TaskStoreEffect<Option.Option<TaskSectionsWritten>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        if (Option.isNone(yield* lockAccount(userId))) return Option.none();
        const applied = yield* applyWrite(userId, write);
        if (Option.isNone(applied)) return Option.none();
        const sections = yield* listTaskSections(userId);
        const txid = applied.value;
        return Option.some(txid === undefined ? sections : { ...sections, txid });
      }),
    ),
  );
}

export function deleteTaskSectionIn(
  userId: string,
  workspaceId: string,
  id: string,
): TaskStoreEffect<Option.Option<DeletedTaskSection>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        if (Option.isNone(yield* lockAccount(userId))) return Option.none();
        return yield* sectionTaken(userId, id, workspaceId);
      }),
    ),
  );
}
