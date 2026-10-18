import {
  TASK_SECTION_BOUNDS,
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSectionEntry,
  type TaskSections,
  type TaskSectionWrite,
  taskSectionIconSchema,
} from "@luke/features/task-section-wire";
import { and, asc, count, eq } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { user } from "../schemas/auth.js";
import { task } from "../schemas/task.js";
import { taskSection, taskSectionEntry } from "../schemas/task-section.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";
import { isWorkspaceMember, taskReachableBy, workspaceReachableBy } from "./workspace-store.js";

/**
 * task-section-store.ts -- the sections an account made in its sidebars and the tasks it keeps in them, read and written for `/api/task-sections`.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account reads or moves another's sections. A section is
 * read only while the account is a member of its workspace, and an entry
 * only while the account still reaches its task in that same workspace, so
 * a task moved to another workspace leaves its section without a write.
 * Every write runs under a lock on the account's own row, so two Macs
 * writing at once land one after the other and neither slips past the
 * bound, and answers the whole as it then stands, or nothing where it was
 * refused, with nothing written.
 */

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

const SECTION_COLUMNS = {
  id: taskSection.id,
  organizationId: taskSection.organizationId,
  title: taskSection.title,
  icon: taskSection.icon,
  position: taskSection.position,
  createdAt: taskSection.createdAt,
};

const SectionKeySchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

/** The account's sections in the workspaces it is a member of. */
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

/** The account's entries whose task it still reaches in its section's own workspace. */
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

/** One of the account's own sections in a workspace it is a member of; nothing for any other id. */
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

/** How many of the account's entries stand in one of its sections. */
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

/** How many sections the account keeps, in every workspace. */
const countSections = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ held: Schema.Number }),
  execute: (userId) =>
    Database.use((db) =>
      db.select({ held: count() }).from(taskSection).where(eq(taskSection.userId, userId)),
    ),
});

/** The account's row, held for the transaction, which is what serializes one account's writes; nothing for an account gone. */
const lockAccount = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (userId) =>
    Database.use((db) =>
      db.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update"),
    ),
});

/** The task under this id, where the account reaches it in the workspace given; nothing otherwise. */
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

/** The account's entry for a task, whichever section it names. */
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

const insertSection = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    userId: Schema.String,
    organizationId: Schema.String,
    title: Schema.String,
    icon: Schema.NullOr(taskSectionIconSchema),
    now: Schema.Date,
  }),
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
        .onConflictDoNothing(),
    ),
});

const updateSection = SqlSchema.void({
  Request: Schema.Struct({
    ...SectionKeySchema.fields,
    title: Schema.optionalKey(Schema.String),
    icon: Schema.optionalKey(Schema.NullOr(taskSectionIconSchema)),
    position: Schema.optionalKey(Schema.String),
  }),
  execute: ({ userId, id, ...set }) =>
    Database.use((db) =>
      db
        .update(taskSection)
        .set(set)
        .where(and(eq(taskSection.id, id), eq(taskSection.userId, userId))),
    ),
});

const deleteSection = SqlSchema.void({
  Request: SectionKeySchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db.delete(taskSection).where(and(eq(taskSection.id, id), eq(taskSection.userId, userId))),
    ),
});

/** The task in a section from now, at the place given or by its instant; an entry standing elsewhere moves here. */
const putEntry = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.String,
    sectionId: Schema.String,
    position: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  execute: ({ userId, taskId, sectionId, position, now }) =>
    Database.use((db) =>
      db
        .insert(taskSectionEntry)
        .values({ userId, taskId, sectionId, position, addedAt: now })
        .onConflictDoUpdate({
          target: [taskSectionEntry.userId, taskSectionEntry.taskId],
          set: { sectionId, position, addedAt: now },
        }),
    ),
});

/** The task's entry given a new place in the section it already stands in, its instant kept. */
const placeEntry = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String, position: Schema.String }),
  execute: ({ userId, taskId, position }) =>
    Database.use((db) =>
      db
        .update(taskSectionEntry)
        .set({ position })
        .where(and(eq(taskSectionEntry.userId, userId), eq(taskSectionEntry.taskId, taskId))),
    ),
});

const deleteEntry = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .delete(taskSectionEntry)
        .where(and(eq(taskSectionEntry.userId, userId), eq(taskSectionEntry.taskId, taskId))),
    ),
});

/** A section's row as the wire reads it: an icon and a place only where they stand. */
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

/** An entry's row as the wire reads it. */
function entryOf(row: EntryRow): TaskSectionEntry {
  return {
    taskId: row.taskId,
    sectionId: row.sectionId,
    ...(row.position === null ? undefined : { position: row.position }),
    addedAt: row.addedAt.getTime(),
  };
}

/** The account's sections, oldest made first, and the tasks it keeps in them. */
export function listTaskSections(userId: string): TaskStoreEffect<TaskSections> {
  return Effect.gen(function* () {
    const sections = yield* findSections(userId);
    const entries = yield* findEntries(userId);
    return { sections: sections.map(sectionOf), entries: entries.map(entryOf) };
  });
}

/** Makes a section, in a workspace the account is a member of and under the bound; one made under this id already is made again as nothing. */
function createSection(
  userId: string,
  write: Extract<TaskSectionWrite, { kind: typeof TASK_SECTION_WRITE.CREATE }>,
): TaskStoreEffect<boolean> {
  return Effect.gen(function* () {
    if (Option.isSome(yield* findSection({ userId, id: write.id }))) return true;
    if (!(yield* isWorkspaceMember(userId, write.workspaceId))) return false;
    const [counted] = yield* countSections(userId);
    if ((counted?.held ?? 0) >= TASK_SECTION_BOUNDS.MAX_SECTIONS) return false;
    const now = yield* DateTime.nowAsDate;
    yield* insertSection({
      id: write.id,
      userId,
      organizationId: write.workspaceId,
      title: write.title,
      icon: write.icon ?? null,
      now,
    });
    // Note that an id another account's section holds is written as nothing, so it is read back rather than trusted.
    return Option.isSome(yield* findSection({ userId, id: write.id }));
  });
}

/**
 * Puts a task in one of the account's sections, at the place given, or in
 * none; nothing where the section is not the account's or the task is not
 * one it reaches in the section's workspace. A task already in the section
 * keeps the instant it was put there and only moves.
 */
function placeTask(
  userId: string,
  write: Extract<TaskSectionWrite, { kind: typeof TASK_SECTION_WRITE.PLACE }>,
): TaskStoreEffect<boolean> {
  return Effect.gen(function* () {
    const { taskId, sectionId, position } = write;
    if (sectionId === null) {
      yield* deleteEntry({ userId, taskId });
      return true;
    }
    const section = yield* findSection({ userId, id: sectionId });
    if (Option.isNone(section)) return false;
    const organizationId = section.value.organizationId;
    if (Option.isNone(yield* findTaskIn({ userId, taskId, organizationId }))) return false;
    const standing = yield* findEntry({ userId, taskId });
    if (Option.isSome(standing) && standing.value.sectionId === sectionId) {
      if (position !== undefined) yield* placeEntry({ userId, taskId, position });
      return true;
    }
    const now = yield* DateTime.nowAsDate;
    yield* putEntry({ userId, taskId, sectionId, position: position ?? null, now });
    return true;
  });
}

/** Runs one write; false where it was refused. */
function applyWrite(userId: string, write: TaskSectionWrite): TaskStoreEffect<boolean> {
  switch (write.kind) {
    case TASK_SECTION_WRITE.CREATE:
      return createSection(userId, write);
    case TASK_SECTION_WRITE.EDIT:
      return Effect.gen(function* () {
        if (Option.isNone(yield* findSection({ userId, id: write.id }))) return false;
        yield* updateSection({ userId, id: write.id, title: write.title, icon: write.icon });
        return true;
      });
    case TASK_SECTION_WRITE.MOVE:
      return Effect.gen(function* () {
        if (Option.isNone(yield* findSection({ userId, id: write.id }))) return false;
        yield* updateSection({ userId, id: write.id, position: write.position });
        return true;
      });
    case TASK_SECTION_WRITE.DELETE:
      // Deleting a section already gone moves nothing, so it is no refusal.
      return Effect.as(deleteSection({ userId, id: write.id }), true);
    case TASK_SECTION_WRITE.PLACE:
      return placeTask(userId, write);
  }
}

/**
 * Runs one write of the account's sections and answers them all as they
 * then stand; nothing where the write was refused, or the account is gone,
 * with nothing written.
 */
export function writeTaskSections(
  userId: string,
  write: TaskSectionWrite,
): TaskStoreEffect<Option.Option<TaskSections>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        if (Option.isNone(yield* lockAccount(userId))) return Option.none();
        if (!(yield* applyWrite(userId, write))) return Option.none();
        return Option.some(yield* listTaskSections(userId));
      }),
    ),
  );
}

/** A section a delete took away, and how many of the account's tasks went back under Tasks with it. */
export interface DeletedTaskSection {
  readonly section: TaskSection;
  readonly returnedTasks: number;
}

/**
 * Deletes one of the account's sections of the workspace given, under the
 * same lock every write takes, and answers what it took away as it read it
 * there: the section, and how many entries went with it. Nothing where the
 * account keeps no such section in that workspace, the account is gone, or
 * another write deleted it first, with nothing written.
 */
export function deleteTaskSectionIn(
  userId: string,
  workspaceId: string,
  id: string,
): TaskStoreEffect<Option.Option<DeletedTaskSection>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        if (Option.isNone(yield* lockAccount(userId))) return Option.none();
        const found = yield* findSection({ userId, id });
        if (Option.isNone(found) || found.value.organizationId !== workspaceId) {
          return Option.none();
        }
        const [entries] = yield* countEntriesIn({ userId, id });
        yield* deleteSection({ userId, id });
        return Option.some({ section: sectionOf(found.value), returnedTasks: entries?.held ?? 0 });
      }),
    ),
  );
}
