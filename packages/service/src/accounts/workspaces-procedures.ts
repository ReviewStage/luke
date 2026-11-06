import type { DatabaseServices } from "@repo/database/core/query";
import type { MemberSeams, WorkspaceSeams } from "@repo/database/models/workspace-seams";
import { setWorkspaceSlug } from "@repo/database/models/workspace-slug-store";
import {
  createWorkspace,
  ensurePersonalWorkspace,
  listWorkspaces,
  workspaceOf,
} from "@repo/database/models/workspace-store";
import {
  WORKSPACE_MEMBERS_QUERY,
  WORKSPACE_ROLE,
  WORKSPACE_SLUG_PROBLEM,
  type WorkspaceRole,
  type WorkspaceSlugProblem,
  workspaceSlugProblemOf,
} from "@repo/features/workspace-wire";
import { type Cause, Effect, Option } from "effect";
import {
  recordServerEvent,
  SERVER_EVENT,
  SERVER_WORKSPACE_MEMBER_ACTION,
  type ServerWorkspaceMemberAction,
  workspaceRenamed,
} from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type SessionUserIdResolver,
  type UserIdResolver,
} from "../http/http-effect.js";
import type { StoreFailure } from "../http/store-failure.js";
import { accountMiddleware, hosted, sessionMiddleware } from "../orpc/base.js";
import { answeredWorkspace, managedWorkspace, pluginCallOrRefused } from "./workspace-access.js";
import { listFormerMembers, listMembers, memberIdOf } from "./workspace-members.js";

const HEIR_ROLES: ReadonlySet<WorkspaceRole> = new Set([
  WORKSPACE_ROLE.ADMIN,
  WORKSPACE_ROLE.OWNER,
]);

const SLUG_REFUSAL = {
  [WORKSPACE_SLUG_PROBLEM.MALFORMED]: HOSTED_REFUSAL.WORKSPACE_SLUG_MALFORMED,
  [WORKSPACE_SLUG_PROBLEM.RESERVED]: HOSTED_REFUSAL.WORKSPACE_SLUG_RESERVED,
  [WORKSPACE_SLUG_PROBLEM.TAKEN]: HOSTED_REFUSAL.WORKSPACE_SLUG_TAKEN,
} as const satisfies Record<WorkspaceSlugProblem, HostedRefusal>;

const REMOVABLE_BY: ReadonlyMap<WorkspaceRole, ReadonlySet<WorkspaceRole>> = new Map([
  [WORKSPACE_ROLE.OWNER, new Set([WORKSPACE_ROLE.ADMIN, WORKSPACE_ROLE.MEMBER])],
  [WORKSPACE_ROLE.ADMIN, new Set([WORKSPACE_ROLE.MEMBER])],
]);

export interface WorkspacesProcedureSeams {
  resolveUserId: UserIdResolver;
  resolveSessionUserId: SessionUserIdResolver;
  workspaces: WorkspaceSeams;
  members: MemberSeams;
}

export function pluginWriteOrUnavailable<A, R>(
  effect: Effect.Effect<A, StoreFailure | Cause.UnknownError, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return Effect.catch(effect, (failure) =>
    failure._tag === "UnknownError"
      ? Effect.andThen(
          Effect.logWarning("Workspace not made: UnknownError"),
          Effect.fail(HOSTED_REFUSAL.UNAVAILABLE),
        )
      : hostedStoreOrUnavailable(Effect.fail(failure)),
  );
}

const otherMemberOf = Effect.fn("web/workspaceOtherMember")(function* (
  userId: string,
  workspaceId: string,
  otherId: string,
) {
  if (otherId === userId) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const other = yield* hostedStoreOrUnavailable(workspaceOf(otherId, workspaceId));
  const memberId = yield* hostedStoreOrUnavailable(memberIdOf(otherId, workspaceId));
  if (Option.isNone(other) || Option.isNone(memberId)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  return { role: other.value.role, memberId: memberId.value };
});

const ownedWorkspace = Effect.fn("web/ownedWorkspace")(function* (
  userId: string,
  workspaceId: string,
) {
  const workspace = yield* answeredWorkspace(userId, workspaceId);
  if (workspace.role !== WORKSPACE_ROLE.OWNER) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
  return workspace;
});

const membersNow = (
  workspaceId: string,
): Effect.Effect<
  { members: Effect.Success<ReturnType<typeof listMembers>> },
  HostedRefusal,
  DatabaseServices
> => Effect.map(hostedStoreOrUnavailable(listMembers(workspaceId)), (members) => ({ members }));

function memberChanged(userId: string, workspaceId: string, action: ServerWorkspaceMemberAction) {
  return recordServerEvent(
    SERVER_EVENT.WORKSPACE_MEMBER_CHANGE,
    { userId, workspaceId },
    { action },
  );
}

export function workspacesProcedures(seams: WorkspacesProcedureSeams) {
  const account = hosted.workspaces.use(accountMiddleware(seams.resolveUserId));
  const session = hosted.workspaces.use(sessionMiddleware(seams.resolveSessionUserId));
  return {
    list: account.list.effect(function* ({ context }) {
      yield* pluginWriteOrUnavailable(ensurePersonalWorkspace(context.userId, seams.workspaces));
      return { workspaces: yield* hostedStoreOrUnavailable(listWorkspaces(context.userId)) };
    }),
    create: account.create.effect(function* ({ context, input }) {
      yield* pluginWriteOrUnavailable(ensurePersonalWorkspace(context.userId, seams.workspaces));
      const organizationId = yield* pluginWriteOrUnavailable(
        createWorkspace(context.userId, input.name, seams.workspaces),
      );
      yield* recordServerEvent(
        SERVER_EVENT.WORKSPACE_CREATE,
        { userId: context.userId, workspaceId: organizationId },
        {},
      );
      return { workspace: yield* answeredWorkspace(context.userId, organizationId) };
    }),
    members: account.members.effect(function* ({ context, input }) {
      const workspace = yield* answeredWorkspace(
        context.userId,
        input[WORKSPACE_MEMBERS_QUERY.WORKSPACE_ID],
      );
      const members = yield* hostedStoreOrUnavailable(listMembers(workspace.id));
      const former = yield* hostedStoreOrUnavailable(listFormerMembers(workspace.id));
      return former.length === 0 ? { members } : { members, former };
    }),
    removeMember: session.removeMember.effect(function* ({ context, input }) {
      const { userId, sessionHeaders: headers } = context;
      const { workspaceId, userId: removed } = input;
      const workspace = yield* answeredWorkspace(userId, workspaceId);
      const removable = REMOVABLE_BY.get(workspace.role);
      if (removable === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
      const { role, memberId } = yield* otherMemberOf(userId, workspaceId, removed);
      if (!removable.has(role)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
      yield* pluginCallOrRefused(
        seams.members.removeMember({ headers, organizationId: workspaceId, memberId }),
      );
      yield* memberChanged(userId, workspaceId, SERVER_WORKSPACE_MEMBER_ACTION.REMOVE);
      return yield* membersNow(workspaceId);
    }),
    changeRole: session.changeRole.effect(function* ({ context, input }) {
      const { userId, sessionHeaders: headers } = context;
      const { workspaceId, userId: changed, role } = input;
      yield* ownedWorkspace(userId, workspaceId);
      const other = yield* otherMemberOf(userId, workspaceId, changed);
      if (other.role === WORKSPACE_ROLE.OWNER) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
      }
      yield* pluginCallOrRefused(
        seams.members.updateMemberRole({
          headers,
          organizationId: workspaceId,
          memberId: other.memberId,
          role,
        }),
      );
      yield* memberChanged(userId, workspaceId, SERVER_WORKSPACE_MEMBER_ACTION.ROLE_CHANGE);
      return yield* membersNow(workspaceId);
    }),
    transfer: session.transfer.effect(function* ({ context, input }) {
      const { userId, sessionHeaders: headers } = context;
      const { workspaceId, userId: heir } = input;
      const workspace = yield* ownedWorkspace(userId, workspaceId);
      if (workspace.personal === true) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
      const other = yield* otherMemberOf(userId, workspaceId, heir);
      if (!HEIR_ROLES.has(other.role)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
      const ownMemberId = yield* hostedStoreOrUnavailable(memberIdOf(userId, workspaceId));
      if (Option.isNone(ownMemberId)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const giveRole = (memberId: string, role: WorkspaceRole) =>
        pluginCallOrRefused(
          seams.members.updateMemberRole({ headers, organizationId: workspaceId, memberId, role }),
        );
      if (other.role !== WORKSPACE_ROLE.OWNER) {
        yield* giveRole(other.memberId, WORKSPACE_ROLE.OWNER);
      }
      yield* giveRole(ownMemberId.value, WORKSPACE_ROLE.ADMIN);
      yield* memberChanged(userId, workspaceId, SERVER_WORKSPACE_MEMBER_ACTION.TRANSFER);
      return yield* membersNow(workspaceId);
    }),
    leave: session.leave.effect(function* ({ context, input }) {
      const { userId, sessionHeaders: headers } = context;
      const { workspaceId } = input;
      const workspace = yield* answeredWorkspace(userId, workspaceId);
      if (workspace.role === WORKSPACE_ROLE.OWNER) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
      }
      yield* pluginCallOrRefused(
        seams.members.leaveOrganization({ headers, organizationId: workspaceId }),
      );
      yield* memberChanged(userId, workspaceId, SERVER_WORKSPACE_MEMBER_ACTION.LEAVE);
      return { workspaceId };
    }),
    rename: session.rename.effect(function* ({ context, input }) {
      const { userId, sessionHeaders: headers } = context;
      const { workspaceId, name } = input;
      const workspace = yield* managedWorkspace(userId, workspaceId);
      if (workspace.personal === true) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
      yield* pluginCallOrRefused(
        seams.members.updateOrganization({ headers, organizationId: workspace.id, data: { name } }),
      );
      yield* workspaceRenamed(userId, workspace.id);
      yield* memberChanged(userId, workspace.id, SERVER_WORKSPACE_MEMBER_ACTION.RENAME);
      return { workspace: yield* answeredWorkspace(userId, workspace.id) };
    }),
    setSlug: account.setSlug.effect(function* ({ context, input }) {
      const { userId } = context;
      const { workspaceId, slug } = input;
      const workspace = yield* ownedWorkspace(userId, workspaceId);
      const problem = workspaceSlugProblemOf(slug);
      if (problem !== undefined) return yield* Effect.fail(SLUG_REFUSAL[problem]);
      const set = yield* hostedStoreOrUnavailable(
        setWorkspaceSlug(workspace.id, slug).pipe(
          Effect.as(true),
          Effect.catchTag("WorkspaceSlugTaken", () => Effect.succeed(false)),
        ),
      );
      if (!set) return yield* Effect.fail(SLUG_REFUSAL[WORKSPACE_SLUG_PROBLEM.TAKEN]);
      return { workspace: yield* answeredWorkspace(userId, workspace.id) };
    }),
    setPhoto: session.setPhoto.effect(function* ({ context, input }) {
      const { userId, sessionHeaders: headers } = context;
      const { workspaceId, photo } = input;
      const workspace = yield* managedWorkspace(userId, workspaceId);
      yield* pluginCallOrRefused(
        seams.members.updateOrganization({
          headers,
          organizationId: workspace.id,
          data: { logo: photo },
        }),
      );
      return { workspace: yield* answeredWorkspace(userId, workspace.id) };
    }),
  };
}
