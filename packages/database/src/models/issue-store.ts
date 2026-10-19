import {
  ISSUE_BOUNDS,
  ISSUE_PRIORITY,
  ISSUE_STATUS,
  type Issue,
  type IssuePriority,
  type IssueStatus,
  issuePrioritySchema,
  issueStatusSchema,
} from "@luke/features/issue-wire";
import { and, desc, eq, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, type DatabaseServices, type QueryError, queryBuilder } from "../core/query.js";
import { organization, user } from "../schemas/auth.js";
import { issue } from "../schemas/issue.js";
import { InstantColumnSchema } from "./columns.js";
import { workspaceReachableBy } from "./workspace-store.js";

/**
 * issue-store.ts -- a workspace's issues, listed, read, filed, and changed for `/api/issues`.
 *
 * Every statement names the account it runs for and gates on that account's
 * membership of the issue's workspace in its own `where`, so an issue of a
 * workspace the account is not in reads and changes exactly as an id that
 * names nothing: as none. A filing takes the workspace's next number under
 * the workspace row's own lock, whose `where` is the membership gate too, so
 * two filings at once never take one number and an account outside the
 * workspace files nothing. A change is one `update` over the row that stands,
 * under the row's own lock taken before the caller's clock is read, so
 * changes at once land in the order they are stamped and each answers the
 * issue as its own change left it. Every function is an effect over the
 * ambient `SqlClient` and names no database of its own.
 */

/** What an issue store operation answers: an effect over the ambient client, composed into whatever called it. */
export type IssueStoreEffect<A> = Effect.Effect<
  A,
  QueryError | Schema.SchemaError,
  DatabaseServices
>;

/** An issue to file in a workspace: its title, and whatever else the filing named. */
export interface NewIssue {
  readonly organizationId: string;
  readonly title: string;
  readonly description?: string;
  readonly status?: IssueStatus;
  readonly priority?: IssuePriority;
}

/** A change to an issue: any of its fields, and whether it is archived; a field left out stands as it was. */
export interface IssueChange {
  readonly title?: string;
  readonly description?: string;
  readonly status?: IssueStatus;
  readonly priority?: IssuePriority;
  readonly archived?: boolean;
}

const IssueRowSchema = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  description: Schema.String,
  status: issueStatusSchema,
  priority: issuePrioritySchema,
  creatorId: Schema.NullOr(Schema.String),
  creatorName: Schema.NullOr(Schema.String),
  archivedAt: Schema.NullOr(InstantColumnSchema),
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

const ISSUE_COLUMNS = {
  id: issue.id,
  organizationId: issue.organizationId,
  number: issue.number,
  title: issue.title,
  description: issue.description,
  status: issue.status,
  priority: issue.priority,
  creatorId: user.id,
  creatorName: user.name,
  archivedAt: issue.archivedAt,
  createdAt: issue.createdAt,
  updatedAt: issue.updatedAt,
};

const IssueKeySchema = Schema.Struct({ userId: Schema.String, issueId: Schema.String });

const WorkspaceKeySchema = Schema.Struct({ userId: Schema.String, organizationId: Schema.String });

/** The workspace's id where the account is a member of it; nothing otherwise. */
const findReachableWorkspace = SqlSchema.findOneOption({
  Request: WorkspaceKeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select({ id: organization.id })
        .from(organization)
        .where(
          and(eq(organization.id, organizationId), workspaceReachableBy(userId, organization.id)),
        ),
    ),
});

/** The workspace, locked until the transaction ends, where the account is a member of it: the lock serialises two filings in it. */
const lockReachableWorkspace = SqlSchema.findOneOption({
  Request: WorkspaceKeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select({ id: organization.id })
        .from(organization)
        .where(
          and(eq(organization.id, organizationId), workspaceReachableBy(userId, organization.id)),
        )
        .for("update"),
    ),
});

const findIssues = SqlSchema.findAll({
  Request: Schema.Struct({ ...WorkspaceKeySchema.fields, archived: Schema.Boolean }),
  Result: IssueRowSchema,
  execute: ({ userId, organizationId, archived }) =>
    Database.use((db) =>
      db
        .select(ISSUE_COLUMNS)
        .from(issue)
        .leftJoin(user, eq(user.id, issue.creatorId))
        .where(
          and(
            eq(issue.organizationId, organizationId),
            workspaceReachableBy(userId, issue.organizationId),
            archived ? isNotNull(issue.archivedAt) : isNull(issue.archivedAt),
          ),
        )
        .orderBy(desc(issue.updatedAt), desc(issue.number))
        .limit(ISSUE_BOUNDS.MAX_ISSUES_READ),
    ),
});

const findIssue = SqlSchema.findOneOption({
  Request: IssueKeySchema,
  Result: IssueRowSchema,
  execute: ({ userId, issueId }) =>
    Database.use((db) =>
      db
        .select(ISSUE_COLUMNS)
        .from(issue)
        .leftJoin(user, eq(user.id, issue.creatorId))
        .where(and(eq(issue.id, issueId), workspaceReachableBy(userId, issue.organizationId))),
    ),
});

/** The issue's id, locked until the transaction ends, where the account is a member of its workspace: the lock orders two changes of it. */
const lockReachableIssue = SqlSchema.findOneOption({
  Request: IssueKeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, issueId }) =>
    Database.use((db) =>
      db
        .select({ id: issue.id })
        .from(issue)
        .where(and(eq(issue.id, issueId), workspaceReachableBy(userId, issue.organizationId)))
        .for("update"),
    ),
});

/** The number the workspace's next issue takes: one past its highest, or one for its first. */
const findNextNumber = SqlSchema.findOne({
  Request: Schema.String,
  Result: Schema.Struct({ next: Schema.Number }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ next: sql<number>`coalesce(max(${issue.number}), 0)::int + 1` })
        .from(issue)
        .where(eq(issue.organizationId, organizationId)),
    ),
});

const insertIssue = SqlSchema.findOne({
  Request: Schema.Struct({
    organizationId: Schema.String,
    number: Schema.Number,
    title: Schema.String,
    description: Schema.String,
    status: issueStatusSchema,
    priority: issuePrioritySchema,
    creatorId: Schema.String,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ now, ...made }) =>
    Database.use((db) =>
      db
        .insert(issue)
        .values({ ...made, createdAt: now, updatedAt: now })
        .returning({ id: issue.id }),
    ),
});

/**
 * The archive stamp a change leaves: the one standing where the change says
 * nothing of it, cleared where it brings the issue back, and now where it
 * archives one. Note that archiving an archived issue keeps the instant it
 * was first archived.
 */
function archivedAtAfter(archived: boolean | undefined, now: Date): SQL | null {
  if (archived === undefined) return sql`${issue.archivedAt}`;
  return archived ? sql`coalesce(${issue.archivedAt}, ${now})` : null;
}

const updateIssue = SqlSchema.findOneOption({
  Request: Schema.Struct({
    ...IssueKeySchema.fields,
    title: Schema.optionalKey(Schema.String),
    description: Schema.optionalKey(Schema.String),
    status: Schema.optionalKey(issueStatusSchema),
    priority: Schema.optionalKey(issuePrioritySchema),
    archived: Schema.optionalKey(Schema.Boolean),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, issueId, archived, now, ...fields }) =>
    Database.use((db) =>
      db
        .update(issue)
        .set({
          ...fields,
          archivedAt: archivedAtAfter(archived, now),
          updatedAt: now,
        })
        .where(and(eq(issue.id, issueId), workspaceReachableBy(userId, issue.organizationId)))
        .returning({ id: issue.id }),
    ),
});

/** A row as the wire carries it, its instants as epoch milliseconds and its creator a member or none. */
function issueOfRow(row: typeof IssueRowSchema.Type): Issue {
  return {
    id: row.id,
    workspaceId: row.organizationId,
    number: row.number,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    creator: row.creatorId === null ? null : { userId: row.creatorId, name: row.creatorName ?? "" },
    archivedAt: row.archivedAt === null ? null : row.archivedAt.getTime(),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/**
 * The workspace's issues, the most recently changed first, up to the
 * bound: those standing, or the archived ones where `archived` asks for
 * them; nothing where the account is not a member of the workspace.
 */
export function listIssues(
  userId: string,
  organizationId: string,
  options: { readonly archived: boolean },
): IssueStoreEffect<Option.Option<readonly Issue[]>> {
  return Effect.gen(function* () {
    const workspace = yield* findReachableWorkspace({ userId, organizationId });
    if (Option.isNone(workspace)) return Option.none();
    const rows = yield* findIssues({ userId, organizationId, archived: options.archived });
    return Option.some(rows.map(issueOfRow));
  });
}

/**
 * The workspace's standing issues written for Neon Realtime: the rows,
 * bound, and rule of who may read them that `listIssues` reads, each column
 * under the key `issue-live.ts` reads it by and each instant in epoch
 * milliseconds. The bound is a subquery, so the statement names no window
 * of the clock and the order is the reader's to keep, since Realtime keeps
 * none. An account outside the workspace reads no row of it. None where the
 * statement names a value Realtime cannot carry.
 */
export function issuesLiveStatement(
  userId: string,
  organizationId: string,
): Option.Option<LiveStatement> {
  const standing = and(
    eq(issue.organizationId, organizationId),
    workspaceReachableBy(userId, issue.organizationId),
    isNull(issue.archivedAt),
  );
  const latest = queryBuilder
    .select({ id: issue.id })
    .from(issue)
    .where(standing)
    .orderBy(desc(issue.updatedAt), desc(issue.number))
    .limit(ISSUE_BOUNDS.MAX_ISSUES_READ);
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection(
          {
            id: issue.id,
            workspaceId: issue.organizationId,
            number: issue.number,
            title: issue.title,
            description: issue.description,
            status: issue.status,
            priority: issue.priority,
            creatorId: user.id,
            creatorName: user.name,
          },
          { createdAt: issue.createdAt, updatedAt: issue.updatedAt },
        ),
      )
      .from(issue)
      .leftJoin(user, eq(user.id, issue.creatorId))
      .where(and(standing, inArray(issue.id, latest))),
  );
}

/** One issue, archived or not; nothing where it is gone or of a workspace the account is not a member of. */
export function readIssue(userId: string, issueId: string): IssueStoreEffect<Option.Option<Issue>> {
  return Effect.map(findIssue({ userId, issueId }), Option.map(issueOfRow));
}

/**
 * Files an issue in the workspace under its next number, filed by the
 * account, and answers it as kept; nothing, with nothing written, where the
 * account is not a member of the workspace.
 */
export function createIssue(
  userId: string,
  made: NewIssue,
): IssueStoreEffect<Option.Option<Issue>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const workspace = yield* lockReachableWorkspace({
          userId,
          organizationId: made.organizationId,
        });
        if (Option.isNone(workspace)) return Option.none();
        // An aggregate that returned no row, or an insert that returned none, is the database breaking its own contract, not an outcome.
        const { next } = yield* findNextNumber(made.organizationId).pipe(
          Effect.catchTag("NoSuchElementError", Effect.die),
        );
        const now = yield* DateTime.nowAsDate;
        const { id } = yield* insertIssue({
          organizationId: made.organizationId,
          number: next,
          title: made.title,
          description: made.description ?? "",
          status: made.status ?? ISSUE_STATUS.BACKLOG,
          priority: made.priority ?? ISSUE_PRIORITY.NONE,
          creatorId: userId,
          now,
        }).pipe(Effect.catchTag("NoSuchElementError", Effect.die));
        return yield* readIssue(userId, id);
      }),
    ),
  );
}

/**
 * Changes an issue and answers it as kept: the fields named, its archive
 * stamped or cleared where `archived` says, and its change instant moved to
 * now; nothing, with nothing written, where it is gone or of a workspace the
 * account is not a member of.
 */
export function changeIssue(
  userId: string,
  issueId: string,
  change: IssueChange,
): IssueStoreEffect<Option.Option<Issue>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        // Note that the row is locked before the clock is read, so two changes at once land in the order they are stamped.
        const locked = yield* lockReachableIssue({ userId, issueId });
        if (Option.isNone(locked)) return Option.none();
        const now = yield* DateTime.nowAsDate;
        const changed = yield* updateIssue({ ...change, userId, issueId, now });
        if (Option.isNone(changed)) return Option.none();
        return yield* readIssue(userId, issueId);
      }),
    ),
  );
}

/** The statuses work on an issue has not yet begun in, which an agent started on it moves it out of. */
const NOT_BEGUN: readonly IssueStatus[] = [ISSUE_STATUS.BACKLOG, ISSUE_STATUS.TODO];

const beginIssue = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...IssueKeySchema.fields, now: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, issueId, now }) =>
    Database.use((db) =>
      db
        .update(issue)
        .set({ status: ISSUE_STATUS.IN_PROGRESS, updatedAt: now })
        .where(
          and(
            eq(issue.id, issueId),
            inArray(issue.status, [...NOT_BEGUN]),
            isNull(issue.archivedAt),
            workspaceReachableBy(userId, issue.organizationId),
          ),
        )
        .returning({ id: issue.id }),
    ),
});

/**
 * Moves an issue whose work has not begun, in the backlog or to do, to in
 * progress, as an agent started on a task from it does, and answers whether
 * it moved. An issue already in progress, done, or canceled, an archived
 * one, and one of a workspace the account is not a member of stand as they
 * were, so asking again moves nothing and nothing ever moves an issue back.
 */
export function beginIssueWork(userId: string, issueId: string): IssueStoreEffect<boolean> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        // Note that the row is locked before the clock is read, as a change's is, so a change landing meanwhile is never stamped later than this move.
        const locked = yield* lockReachableIssue({ userId, issueId });
        if (Option.isNone(locked)) return false;
        const now = yield* DateTime.nowAsDate;
        return Option.isSome(yield* beginIssue({ userId, issueId, now }));
      }),
    ),
  );
}
