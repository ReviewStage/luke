import { LINEAR_BOUNDS } from "@luke/features/linear-wire";
import {
  TASK_ISSUE_PROVIDER,
  TASK_ISSUE_RELATION,
  type TaskIssueProvider,
  type TaskIssueRelation,
  type TaskIssueTag,
} from "@luke/features/task-issue-wire";
import { TASK_BOUNDS } from "@luke/features/task-wire";
import { and, asc, count, eq, exists, inArray, max, type SQL } from "drizzle-orm";
import { Data, DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError, queryBuilder } from "../core/query.js";
import { task } from "../schemas/task.js";
import { taskIssue } from "../schemas/task-issue.js";
import { InstantColumnSchema } from "./columns.js";
import { TaskArchived } from "./task-store.js";
import { reachableTask, taskReachableBy } from "./workspace-store.js";

/**
 * task-issue-store.ts -- the external issues a task links, as the members of its workspace link, read, and change them.
 *
 * A link is the task's, so every member of the task's workspace reads and
 * changes its links, whoever made them; every statement here names the
 * account it runs for beside the task and gates on that account's
 * membership of the task's workspace (`workspace-store.ts`), so a task of a
 * workspace the account is not in reads and changes exactly as an id that
 * names nothing: as no links. A task links an issue once, by its provider
 * and the provider's own id, and at most `TASK_BOUNDS.MAX_ISSUES` issues;
 * a link past either is refused and nothing is written. The task's row is
 * held while a link is counted and written, so two links made at once
 * cannot both take the last place, and a task's links read in the order
 * they were made, the first of them first. A link, a relation, and an
 * unlink are a task's edits, so an archived task takes none of them, refused
 * with `TaskArchived` under the task's lock as a rename is; a refresh of what
 * a link's chip draws, its key and title as the provider last answered them,
 * is a read's and lands on an archived task too. A description is kept to
 * `LINEAR_BOUNDS.MAX_DESCRIPTION_CHARS`, whoever read it. Every function is
 * an effect over the ambient `SqlClient` and names no database of its own.
 */

export type TaskIssueStoreFailure = QueryError | Schema.SchemaError;

/** The task links `TASK_BOUNDS.MAX_ISSUES` issues already; nothing was written. */
export class TaskIssuesFull extends Data.TaggedError("TaskIssuesFull") {}

/** The task links this issue already; nothing was written. */
export class TaskIssueLinked extends Data.TaggedError("TaskIssueLinked") {}

/**
 * An issue a task is to link, as its provider was read for it: the
 * provider's own id for it, its repository and number where GitHub holds
 * it, what a chip draws of it, its description, and which keyword a pull
 * request writes of it, `closes` where none is named.
 */
export interface NewTaskIssueLink {
  readonly provider: TaskIssueProvider;
  readonly externalId: string;
  /** A GitHub issue's repository, `owner/name`; absent for Linear's. */
  readonly repository?: string;
  /** A GitHub issue's number; absent for Linear's. */
  readonly number?: number;
  readonly key: string;
  readonly url: string;
  readonly title: string;
  readonly description: string;
  readonly relation?: TaskIssueRelation;
}

const TaskIssueLinkSchema = Schema.Struct({
  id: Schema.String,
  provider: Schema.Literals(Object.values(TASK_ISSUE_PROVIDER)),
  externalId: Schema.String,
  repository: Schema.NullOr(Schema.String),
  number: Schema.NullOr(Schema.Number),
  key: Schema.String,
  url: Schema.String,
  title: Schema.String,
  description: Schema.String,
  relation: Schema.Literals(Object.values(TASK_ISSUE_RELATION)),
  /** The member who made the link; null once their account is gone. */
  linkedBy: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
});

/** One issue a task links, as its row reads. */
export type TaskIssueLink = typeof TaskIssueLinkSchema.Type;

/** The columns every read and every `returning` projects. */
const LINK_COLUMNS = {
  id: taskIssue.id,
  provider: taskIssue.provider,
  externalId: taskIssue.externalId,
  repository: taskIssue.repository,
  number: taskIssue.number,
  key: taskIssue.key,
  url: taskIssue.url,
  title: taskIssue.title,
  description: taskIssue.description,
  relation: taskIssue.relation,
  linkedBy: taskIssue.linkedBy,
  createdAt: taskIssue.createdAt,
};

const TaskKeySchema = Schema.Struct({ userId: Schema.String, taskId: Schema.String });

const LinkKeySchema = Schema.Struct({
  userId: Schema.String,
  taskId: Schema.String,
  linkId: Schema.String,
});

/** Whether the account reaches the task, as a condition on a statement over its links. */
function taskReached(userId: string, taskId: string): SQL {
  return exists(
    queryBuilder.select({ id: task.id }).from(task).where(reachableTask(userId, taskId)),
  );
}

/**
 * The task's row held until the transaction ends, where the account
 * reaches it. Note that it is held `for no key update`, because that
 * serializes two links of one task without holding off a row elsewhere that
 * names the task, which takes the key's share.
 */
const lockLinkedTask = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: Schema.Struct({ id: Schema.String, archivedAt: Schema.NullOr(InstantColumnSchema) }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({ id: task.id, archivedAt: task.archivedAt })
        .from(task)
        .where(reachableTask(userId, taskId))
        .for("no key update"),
    ),
});

/** How many issues the task links, and when the newest of them was linked; null before any. */
const countLinks = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ held: Schema.Number, latest: Schema.NullOr(InstantColumnSchema) }),
  execute: (taskId) =>
    Database.use((db) =>
      db
        .select({ held: count(), latest: max(taskIssue.createdAt) })
        .from(taskIssue)
        .where(eq(taskIssue.taskId, taskId)),
    ),
});

/**
 * The instant a link is stamped with: now, or a millisecond after the
 * task's newest link where that is later. Note that no two links of a task
 * share an instant, because the first names the task's branches, and links
 * made together, as a task's start makes them, would otherwise order by
 * chance.
 */
function stampAfter(now: Date, latest: Date | null): Date {
  return latest === null || now.getTime() > latest.getTime() ? now : new Date(latest.getTime() + 1);
}

/** The link written, or nothing where the task links the issue already. */
const insertLink = SqlSchema.findOneOption({
  Request: Schema.Struct({
    taskId: Schema.String,
    provider: Schema.Literals(Object.values(TASK_ISSUE_PROVIDER)),
    externalId: Schema.String,
    repository: Schema.NullOr(Schema.String),
    number: Schema.NullOr(Schema.Number),
    key: Schema.String,
    url: Schema.String,
    title: Schema.String,
    description: Schema.String,
    relation: Schema.Literals(Object.values(TASK_ISSUE_RELATION)),
    linkedBy: Schema.String,
    createdAt: Schema.Date,
  }),
  Result: TaskIssueLinkSchema,
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(taskIssue)
        .values(row)
        .onConflictDoNothing({
          target: [taskIssue.taskId, taskIssue.provider, taskIssue.externalId],
        })
        .returning(LINK_COLUMNS),
    ),
});

const findLinks = SqlSchema.findAll({
  Request: TaskKeySchema,
  Result: TaskIssueLinkSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select(LINK_COLUMNS)
        .from(taskIssue)
        .innerJoin(task, eq(task.id, taskIssue.taskId))
        .where(reachableTask(userId, taskId))
        .orderBy(asc(taskIssue.createdAt), asc(taskIssue.id)),
    ),
});

/** The tags of every link of the tasks named, each beside its task, where the account reaches the task; oldest linked first. */
const findTags = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, taskIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({
    taskId: Schema.String,
    id: Schema.String,
    provider: Schema.Literals(Object.values(TASK_ISSUE_PROVIDER)),
    key: Schema.String,
    url: Schema.String,
    relation: Schema.Literals(Object.values(TASK_ISSUE_RELATION)),
  }),
  execute: ({ userId, taskIds }) =>
    Database.use((db) =>
      db
        .select({
          taskId: taskIssue.taskId,
          id: taskIssue.id,
          provider: taskIssue.provider,
          key: taskIssue.key,
          url: taskIssue.url,
          relation: taskIssue.relation,
        })
        .from(taskIssue)
        .innerJoin(task, eq(task.id, taskIssue.taskId))
        .where(and(inArray(taskIssue.taskId, [...taskIds]), taskReachableBy(userId)))
        .orderBy(asc(taskIssue.createdAt), asc(taskIssue.id)),
    ),
});

const updateRelation = SqlSchema.findOneOption({
  Request: Schema.Struct({
    ...LinkKeySchema.fields,
    relation: Schema.Literals(Object.values(TASK_ISSUE_RELATION)),
  }),
  Result: TaskIssueLinkSchema,
  execute: ({ userId, taskId, linkId, relation }) =>
    Database.use((db) =>
      db
        .update(taskIssue)
        .set({ relation })
        .where(
          and(eq(taskIssue.id, linkId), eq(taskIssue.taskId, taskId), taskReached(userId, taskId)),
        )
        .returning(LINK_COLUMNS),
    ),
});

const updateDrawn = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...LinkKeySchema.fields, key: Schema.String, title: Schema.String }),
  Result: TaskIssueLinkSchema,
  execute: ({ userId, taskId, linkId, key, title }) =>
    Database.use((db) =>
      db
        .update(taskIssue)
        .set({ key, title })
        .where(
          and(eq(taskIssue.id, linkId), eq(taskIssue.taskId, taskId), taskReached(userId, taskId)),
        )
        .returning(LINK_COLUMNS),
    ),
});

const removeLink = SqlSchema.findOneOption({
  Request: LinkKeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, taskId, linkId }) =>
    Database.use((db) =>
      db
        .delete(taskIssue)
        .where(
          and(eq(taskIssue.id, linkId), eq(taskIssue.taskId, taskId), taskReached(userId, taskId)),
        )
        .returning({ id: taskIssue.id }),
    ),
});

/**
 * The edit run with the task's row held, where the account reaches the
 * task: nothing where it reaches none, and refused with `TaskArchived`
 * where the task is archived, nothing written either way.
 */
function onLiveTask<A, E>(
  userId: string,
  taskId: string,
  edit: Effect.Effect<Option.Option<A>, E, DatabaseServices>,
): Effect.Effect<Option.Option<A>, TaskIssueStoreFailure | TaskArchived | E, DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockLinkedTask({ userId, taskId });
        if (Option.isNone(locked)) return Option.none<A>();
        if (locked.value.archivedAt !== null) return yield* new TaskArchived();
        return yield* edit;
      }),
    ),
  );
}

/**
 * Links the issue to the task as the account, from now, and answers the
 * link; nothing where the account reaches no such task. Refused with
 * `TaskIssueLinked` where the task links the issue already, with
 * `TaskIssuesFull` where it links `TASK_BOUNDS.MAX_ISSUES` issues, and with
 * `TaskArchived` where the task is archived, nothing written any way.
 */
export function linkTaskIssue(
  userId: string,
  taskId: string,
  link: NewTaskIssueLink,
): Effect.Effect<
  Option.Option<TaskIssueLink>,
  TaskIssueStoreFailure | TaskIssuesFull | TaskIssueLinked | TaskArchived,
  DatabaseServices
> {
  return onLiveTask(
    userId,
    taskId,
    Effect.gen(function* () {
      const [standing] = yield* countLinks(taskId);
      if ((standing?.held ?? 0) >= TASK_BOUNDS.MAX_ISSUES) return yield* new TaskIssuesFull();
      const createdAt = stampAfter(yield* DateTime.nowAsDate, standing?.latest ?? null);
      const written = yield* insertLink({
        taskId,
        provider: link.provider,
        externalId: link.externalId,
        repository: link.repository ?? null,
        number: link.number ?? null,
        key: link.key,
        url: link.url,
        title: link.title,
        description: link.description.slice(0, LINEAR_BOUNDS.MAX_DESCRIPTION_CHARS),
        relation: link.relation ?? TASK_ISSUE_RELATION.CLOSES,
        linkedBy: userId,
        createdAt,
      });
      if (Option.isNone(written)) return yield* new TaskIssueLinked();
      return written;
    }),
  );
}

/**
 * The issues the task links, oldest linked first, so the first is the one
 * that names its agents' branches; none for a task the account does not
 * reach.
 */
export function listTaskIssues(
  userId: string,
  taskId: string,
): Effect.Effect<readonly TaskIssueLink[], TaskIssueStoreFailure, DatabaseServices> {
  return findLinks({ userId, taskId });
}

/**
 * The issues each of the tasks named links, as the task list's tags name
 * them, oldest linked first, read in one statement for the whole list; a
 * task that links none, or that the account does not reach, is absent.
 */
export function listTaskIssueTags(
  userId: string,
  taskIds: readonly string[],
): Effect.Effect<
  ReadonlyMap<string, readonly TaskIssueTag[]>,
  TaskIssueStoreFailure,
  DatabaseServices
> {
  if (taskIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(findTags({ userId, taskIds }), (rows) => {
    const tags = new Map<string, TaskIssueTag[]>();
    for (const { taskId, ...tag } of rows) {
      const held = tags.get(taskId);
      if (held === undefined) tags.set(taskId, [tag]);
      else held.push(tag);
    }
    return tags;
  });
}

/**
 * Sets which keyword a pull request writes of a link of the task, and
 * answers the link; nothing where the account reaches no such link, and
 * refused with `TaskArchived` where the task is archived.
 */
export function relateTaskIssue(
  userId: string,
  taskId: string,
  linkId: string,
  relation: TaskIssueRelation,
): Effect.Effect<
  Option.Option<TaskIssueLink>,
  TaskIssueStoreFailure | TaskArchived,
  DatabaseServices
> {
  return onLiveTask(userId, taskId, updateRelation({ userId, taskId, linkId, relation }));
}

/**
 * What a link's chip draws, its key and title, as its provider answered
 * them on a read, and answers the link; nothing where the account reaches
 * no such link. Its description, relation, and the rest stand as they were.
 */
export function refreshTaskIssue(
  userId: string,
  taskId: string,
  linkId: string,
  drawn: { readonly key: string; readonly title: string },
): Effect.Effect<Option.Option<TaskIssueLink>, TaskIssueStoreFailure, DatabaseServices> {
  return updateDrawn({ userId, taskId, linkId, ...drawn });
}

/**
 * Takes a link off the task; false where the account reaches no such link,
 * and refused with `TaskArchived` where the task is archived. The issue
 * itself is the provider's and is left as it stands.
 */
export function unlinkTaskIssue(
  userId: string,
  taskId: string,
  linkId: string,
): Effect.Effect<boolean, TaskIssueStoreFailure | TaskArchived, DatabaseServices> {
  return Effect.map(
    onLiveTask(userId, taskId, removeLink({ userId, taskId, linkId })),
    Option.isSome,
  );
}
