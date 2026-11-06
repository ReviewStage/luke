import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@repo/database/core/live-statement";
import { Database, queryBuilder } from "@repo/database/core/query";
import {
  type WorkspaceStoreEffect,
  workspaceReachableBy,
} from "@repo/database/models/workspace-store";
import { agentTable } from "@repo/database/schemas/agent";
import { member, user } from "@repo/database/schemas/auth";
import { automation } from "@repo/database/schemas/automation";
import { inboxItem } from "@repo/database/schemas/inbox";
import { descriptionRevision } from "@repo/database/schemas/description-revision";
import { task } from "@repo/database/schemas/task";
import { pinnedPictureUrl } from "@repo/features/account-picture";
import { AUTOMATION_SCOPE } from "@repo/features/automation-wire";
import type { FormerMember, WorkspaceMember, WorkspaceRole } from "@repo/features/workspace-wire";
import { roleOf, WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { and, asc, eq, inArray, isNotNull, notInArray, or, type SQL } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";

const ROLE_ORDER: readonly WorkspaceRole[] = [
  WORKSPACE_ROLE.OWNER,
  WORKSPACE_ROLE.ADMIN,
  WORKSPACE_ROLE.MEMBER,
];

const findMembers = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({
    userId: Schema.String,
    name: Schema.String,
    email: Schema.String,
    role: Schema.String,
    image: Schema.NullOr(Schema.String),
  }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({
          userId: user.id,
          name: user.name,
          email: user.email,
          role: member.role,
          image: user.image,
        })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, organizationId))
        .orderBy(asc(user.name), asc(user.id)),
    ),
});

function formerOf(organizationId: string): SQL | undefined {
  const tasks = queryBuilder
    .select({ id: task.id })
    .from(task)
    .where(eq(task.organizationId, organizationId));
  return and(
    or(
      inArray(
        user.id,
        queryBuilder
          .select({ id: task.userId })
          .from(task)
          .where(eq(task.organizationId, organizationId)),
      ),
      inArray(
        user.id,
        queryBuilder
          .select({ id: agentTable.userId })
          .from(agentTable)
          .where(eq(agentTable.organizationId, organizationId)),
      ),
      inArray(
        user.id,
        queryBuilder
          .select({ id: automation.userId })
          .from(automation)
          .where(
            and(
              eq(automation.organizationId, organizationId),
              eq(automation.scope, AUTOMATION_SCOPE.WORKSPACE),
            ),
          ),
      ),
      inArray(
        user.id,
        queryBuilder
          .select({ id: descriptionRevision.userId })
          .from(descriptionRevision)
          .where(
            and(inArray(descriptionRevision.taskId, tasks), isNotNull(descriptionRevision.userId)),
          ),
      ),
      inArray(
        user.id,
        queryBuilder
          .select({ id: inboxItem.answeredBy })
          .from(inboxItem)
          .where(
            and(eq(inboxItem.organizationId, organizationId), isNotNull(inboxItem.answeredBy)),
          ),
      ),
    ),
    notInArray(
      user.id,
      queryBuilder
        .select({ id: member.userId })
        .from(member)
        .where(eq(member.organizationId, organizationId)),
    ),
  );
}

const findFormer = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({
    userId: Schema.String,
    name: Schema.String,
    image: Schema.NullOr(Schema.String),
  }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ userId: user.id, name: user.name, image: user.image })
        .from(user)
        .where(formerOf(organizationId))
        .orderBy(asc(user.name), asc(user.id)),
    ),
});

const findMemberId = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
        .limit(1),
    ),
});

export function listMembers(
  organizationId: string,
): WorkspaceStoreEffect<readonly WorkspaceMember[]> {
  return Effect.map(findMembers(organizationId), (rows) => {
    const members = rows.map(({ image, ...row }): WorkspaceMember => {
      const listed = { ...row, role: roleOf(row.role) };
      const pictureUrl = pinnedPictureUrl(image);
      return pictureUrl === undefined ? listed : { ...listed, pictureUrl };
    });
    return ROLE_ORDER.flatMap((role) => members.filter((one) => one.role === role));
  });
}

export function listFormerMembers(
  organizationId: string,
): WorkspaceStoreEffect<readonly FormerMember[]> {
  return Effect.map(findFormer(organizationId), (rows) =>
    rows.map(({ image, ...row }): FormerMember => {
      const pictureUrl = pinnedPictureUrl(image);
      return pictureUrl === undefined ? row : { ...row, pictureUrl };
    }),
  );
}

export function memberIdOf(
  userId: string,
  organizationId: string,
): WorkspaceStoreEffect<Option.Option<string>> {
  return Effect.map(
    findMemberId({ userId, organizationId }),
    Option.map((row) => row.id),
  );
}

export type WorkspaceMembersLiveStatements = Readonly<Record<"members" | "former", LiveStatement>>;

export function workspaceMembersLiveStatements(
  readerId: string,
  organizationId: string,
): Option.Option<WorkspaceMembersLiveStatements> {
  const reached = workspaceReachableBy(readerId, organizationId);
  const members = queryBuilder
    .select(
      liveSelection({
        userId: user.id,
        name: user.name,
        email: user.email,
        role: member.role,
        image: user.image,
      }),
    )
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, organizationId), reached));
  const former = queryBuilder
    .select(liveSelection({ userId: user.id, name: user.name, image: user.image }))
    .from(user)
    .where(and(formerOf(organizationId), reached));
  return Option.all({ members: liveStatementOf(members), former: liveStatementOf(former) });
}
