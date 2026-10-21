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
} from "@luke/features/task-section-wire";
import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, queryBuilder } from "../core/query.js";
import { user } from "../schemas/auth.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { task } from "../schemas/task.js";
import { agentSectionEntry, taskSection, taskSectionEntry } from "../schemas/task-section.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";
import {
  AGENT_WORKSPACE,
  agentReachableBy,
  isWorkspaceMember,
  taskReachableBy,
  workspaceReachableBy,
} from "./workspace-store.js";

/**
 * task-section-store.ts -- the sections an account made in its sidebars and the tasks and agents it keeps in them, read and written for `/api/task-sections`.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account reads or moves another's sections. A section is
 * read only while the account is a member of its workspace, and an entry
 * only while the account still reaches its task in that same workspace, so
 * a task moved to another workspace leaves its section without a write. An
 * agent's entry is read on the same terms, and only while the agent stands
 * on no task, since only such an agent is a row of the sidebar of its own,
 * as its pin is (`pinCodingAgent`).
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

const AgentEntryRowSchema = Schema.Struct({
  agentId: Schema.String,
  sectionId: Schema.String,
  position: Schema.NullOr(Schema.String),
  addedAt: InstantColumnSchema,
});

type AgentEntryRow = typeof AgentEntryRowSchema.Type;

const AGENT_ENTRY_COLUMNS = {
  agentId: agentSectionEntry.codingAgentId,
  sectionId: agentSectionEntry.sectionId,
  position: agentSectionEntry.position,
  addedAt: agentSectionEntry.addedAt,
};

/** The condition that the account's agent entry a statement reads stands: its agent, on no task, is one the account reaches in its section's own workspace. */
function agentEntryStands(userId: string) {
  return and(
    eq(agentSectionEntry.userId, userId),
    eq(AGENT_WORKSPACE, taskSection.organizationId),
    isNull(codingAgent.taskId),
    agentReachableBy(userId),
  );
}

/** The condition that a statement touches the account's own entry for the agent. */
function ownAgentEntry(userId: string, agentId: string) {
  return and(eq(agentSectionEntry.userId, userId), eq(agentSectionEntry.codingAgentId, agentId));
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

/**
 * The id of the transaction that made a write, read in the write's own
 * `RETURNING`, as Neon's mutations guide does it: a follower of the sidebar
 * waits for it to arrive on its live query. A write that changed no row
 * returns none, so there is nothing to wait for.
 */
const TXID = { txid: sql<string>`pg_current_xact_id()::text` };

/** The transaction a statement wrote its rows in; no row where it changed none. */
const WrittenSchema = Schema.Struct({ txid: Schema.String });

type Written = typeof WrittenSchema.Type;

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

/** The account's entries whose agent, on no task, it still reaches in its section's own workspace. */
const findAgentEntries = SqlSchema.findAll({
  Request: Schema.String,
  Result: AgentEntryRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select(AGENT_ENTRY_COLUMNS)
        .from(agentSectionEntry)
        .innerJoin(taskSection, eq(taskSection.id, agentSectionEntry.sectionId))
        .innerJoin(codingAgent, eq(codingAgent.id, agentSectionEntry.codingAgentId))
        .where(agentEntryStands(userId))
        .orderBy(asc(agentSectionEntry.addedAt), asc(agentSectionEntry.codingAgentId)),
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

/** The agent under this id, on no task, where the account reaches it in the workspace given; nothing otherwise. */
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
        .select({ id: codingAgent.id })
        .from(codingAgent)
        .where(
          and(
            eq(codingAgent.id, agentId),
            eq(AGENT_WORKSPACE, organizationId),
            isNull(codingAgent.taskId),
            agentReachableBy(userId),
          ),
        )
        .limit(1),
    ),
});

/** The account's entry for an agent, whichever section it names. */
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

/** A section given a new title and icon; no row where it already had them. */
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

/** A section stood at a new place among the others; no row where it already stood there. */
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

/** The task in a section from now, at the place given or by its instant; an entry standing elsewhere moves here. */
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

/** The task's entry given a new place in the section it already stands in, its instant kept; no row where it already stood there. */
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

/** The agent in a section from now, at the place given or by its instant; an entry standing elsewhere moves here. */
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
        .values({ userId, codingAgentId: agentId, sectionId, position, addedAt: now })
        .onConflictDoUpdate({
          target: [agentSectionEntry.userId, agentSectionEntry.codingAgentId],
          set: { sectionId, position, addedAt: now },
        })
        .returning(TXID),
    ),
});

/** The agent's entry given a new place in the section it already stands in, its instant kept; no row where it already stood there. */
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

/** What one write did: refused, with nothing written, or done, in the transaction it changed rows in, none where it changed none. */
type Applied = Option.Option<string | undefined>;

/** A write done, in the transaction its statement's rows name. */
function done(rows: readonly Written[]): Applied {
  return Option.some(rows[0]?.txid);
}

const REFUSED: Applied = Option.none();

/** A write done that changed no row. */
const UNCHANGED: Applied = Option.some(undefined);

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

/** An agent's entry as the wire reads it. */
function agentEntryOf(row: AgentEntryRow): AgentSectionEntry {
  return {
    agentId: row.agentId,
    sectionId: row.sectionId,
    ...(row.position === null ? undefined : { position: row.position }),
    addedAt: row.addedAt.getTime(),
  };
}

/** The account's sections, oldest made first, and the tasks and agents it keeps in them. */
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

/** The statements the account's sections are followed by live: the sections, and the tasks and agents it keeps in them. */
export type TaskSectionsLiveStatements = Readonly<
  Record<"sections" | "entries" | "agentEntries", LiveStatement>
>;

/**
 * The account's sections written for Neon Realtime: the same rows and rule
 * of who may read them as `listTaskSections`, each column under the key
 * `live-wire.ts` reads it by and each instant in epoch milliseconds. The
 * order is the reader's to keep, since Realtime keeps none. None where a
 * statement names a value Realtime cannot carry.
 */
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
          agentId: agentSectionEntry.codingAgentId,
          sectionId: agentSectionEntry.sectionId,
          position: agentSectionEntry.position,
        },
        { addedAt: agentSectionEntry.addedAt },
      ),
    )
    .from(agentSectionEntry)
    .innerJoin(taskSection, eq(taskSection.id, agentSectionEntry.sectionId))
    .innerJoin(codingAgent, eq(codingAgent.id, agentSectionEntry.codingAgentId))
    .where(agentEntryStands(userId));
  return Option.all({
    sections: liveStatementOf(sections),
    entries: liveStatementOf(entries),
    agentEntries: liveStatementOf(agentEntries),
  });
}

/** Makes a section, in a workspace the account is a member of and under the bound; one made under this id already is made again as nothing. */
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
    // Note that an id another account's section holds is written as nothing, so it is read back rather than trusted.
    return Option.isSome(yield* findSection({ userId, id: write.id })) ? done(written) : REFUSED;
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

/**
 * Puts an agent with no task in one of the account's sections, at the place
 * given, or in none; nothing where the section is not the account's or the
 * agent is not one it reaches, on no task, in the section's workspace. An
 * agent already in the section keeps the instant it was put there and only
 * moves.
 */
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

/** Runs one write; none where it was refused. */
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
      // Deleting a section already gone moves nothing, so it is no refusal.
      return Effect.map(deleteSection({ userId, id: write.id }), done);
    case TASK_SECTION_WRITE.PLACE:
      return placeTask(userId, write);
    case TASK_SECTION_WRITE.PLACE_AGENT:
      return placeAgent(userId, write);
  }
}

/**
 * Runs one write of the account's sections and answers them all as they
 * then stand, with the transaction the write changed rows in; nothing where
 * the write was refused, or the account is gone, with nothing written. A
 * write that changed no row, such as a section given the title it had,
 * answers no transaction, so a follower has nothing to wait for.
 */
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
