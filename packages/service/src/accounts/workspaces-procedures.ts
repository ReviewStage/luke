/**
 * workspaces-procedures.ts -- the account's workspaces as the Mac reads and asks for them: the list, a workspace created, renamed, given a slug or a photo, handed over, or deleted, and its members read, removed, given a role, or left.
 *
 * `GET /api/workspaces` answers every workspace the bearer's account is a
 * member of, the one made for it first and the rest by name, each with the
 * account's role and its connected GitHub account; that first workspace is
 * ensured before the read, so an account's first read makes it, and it is
 * then a workspace like any other. `POST` creates a workspace with the name
 * given through the organization plugin's server-only create, the account
 * its owner.
 * `GET /api/workspaces/members` answers a workspace's members to a member
 * of it, and who its work still names but left. `POST /api/workspaces/members/remove`
 * lets the owner remove an admin or a member, and an admin a member alone;
 * `POST /api/workspaces/members/role` lets the owner alone make a member an
 * admin or an admin a member; `POST /api/workspaces/transfer` lets the owner
 * alone hand the workspace to an admin, becoming an admin, though never the
 * account's own first workspace, which is named for its creator; each
 * answers the members as they then stand. Nobody removes or changes
 * themselves, whose way out is leaving, or the owner.
 * `POST /api/workspaces/leave` lets anyone but an owner leave. A member
 * removed, or one who leaves, lets go of every task of the workspace assigned
 * to them, in the plugin's own delete (the `task_assignee_leaves_with_member`
 * trigger).
 * `POST /api/workspaces/delete` lets the owner alone delete a workspace,
 * though never the account's own first workspace, which goes only with the
 * account. Every agent of the workspace not archived, any member's, one
 * the owner cannot see among them, is stopped first under the account that
 * started it, and the delete is refused as not ready, stopping no one,
 * where one cannot be stopped yet;
 * the plugin then deletes the workspace and every row of it, and its hooks
 * stamp the agents' conversations deleted (`workspace-deletion.ts`).
 * `POST /api/workspaces/rename` lets an owner or admin rename a workspace,
 * answering it under its new name and its old slug; an account's first
 * workspace is refused, since it is named by its owner's account name.
 * `POST /api/workspaces/slug/set` lets the owner alone change the slug, an
 * account's first workspace's among them, refusing one spelled other than a
 * slug may be, one reserved, and one another workspace holds or held, each
 * by its own word; the slug it stood under stays its own
 * (`workspace-slug-store.ts`), and it is answered under the new one.
 * `POST /api/workspaces/photo/set` lets an owner or admin set the photo, as
 * a `data:` URL of a photo's type within its bound, or remove it with null,
 * answering the workspace with its photo's new version or none. The photo's
 * bytes are served apart (`workspaces-app.ts`).
 *
 * Removing, changing a role, handing over, leaving, deleting, renaming,
 * and setting the photo are Better Auth's own `removeMember`,
 * `updateMemberRole`, `leaveOrganization`, `deleteOrganization`, and
 * `updateOrganization`
 * (https://www.better-auth.com/docs/plugins/organization#remove-member),
 * so their bearer is the Mac's Better Auth session, signed, which the bearer
 * plugin reads as the session cookie those calls take; the list, a
 * workspace created, its slug changed, and the members read take the Mac's
 * OAuth token.
 * Our own rules stand in front of the plugin's, which checks the caller's
 * role and membership again itself.
 *
 * The caller is resolved, and a body held to its bound, on the resource
 * before its input is read, so an unsigned caller is refused as
 * unauthenticated and an oversized body as too large whatever it carries.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { type Agent, listAgentsOfDeletedWorkspace } from "@repo/database/models/agent-store";
import type { MemberSeams, WorkspaceSeams } from "@repo/database/models/workspace-seams";
import { setWorkspaceSlug } from "@repo/database/models/workspace-slug-store";
import {
  createWorkspace,
  ensurePersonalWorkspace,
  listWorkspaces,
  workspaceOf,
} from "@repo/database/models/workspace-store";
import { storeWriter } from "@repo/database/models/writer";
import {
  WORKSPACE_MEMBERS_QUERY,
  WORKSPACE_ROLE,
  WORKSPACE_SLUG_PROBLEM,
  type WorkspaceRole,
  type WorkspaceSlugProblem,
  workspaceSlugProblemOf,
} from "@repo/features/workspace-wire";
import { type Cause, Effect, Option } from "effect";
import { everyStoppedByStarter, everyStopsForGood } from "../agents/coder-host/stop.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
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
import type { WorkspaceDeleteCall } from "./deletion-hooks.js";
import { answeredWorkspace, managedWorkspace, pluginCallOrRefused } from "./workspace-access.js";
import { listFormerMembers, listMembers, memberIdOf } from "./workspace-members.js";

/** How many of a workspace's agents a delete reads at once, page by page, before it stops any. */
const DELETE_AGENTS_PAGE = 100;

/** Whoever a delete's Stops are written as: the workspace's agents, as a task's archive stops its own. */
const STOPPER = storeWriter({ tools: CODER_TOOL_SET });

/** The roles a workspace is handed to: an admin, or an owner a handover cut short already made one. */
const HEIR_ROLES: ReadonlySet<WorkspaceRole> = new Set([
  WORKSPACE_ROLE.ADMIN,
  WORKSPACE_ROLE.OWNER,
]);

/** The refusal each reason a slug is refused for is answered with. */
const SLUG_REFUSAL = {
  [WORKSPACE_SLUG_PROBLEM.MALFORMED]: HOSTED_REFUSAL.WORKSPACE_SLUG_MALFORMED,
  [WORKSPACE_SLUG_PROBLEM.RESERVED]: HOSTED_REFUSAL.WORKSPACE_SLUG_RESERVED,
  [WORKSPACE_SLUG_PROBLEM.TAKEN]: HOSTED_REFUSAL.WORKSPACE_SLUG_TAKEN,
} as const satisfies Record<WorkspaceSlugProblem, HostedRefusal>;

/** The roles each role removes: the owner an admin or a member, an admin a member alone. */
const REMOVABLE_BY: ReadonlyMap<WorkspaceRole, ReadonlySet<WorkspaceRole>> = new Map([
  [WORKSPACE_ROLE.OWNER, new Set([WORKSPACE_ROLE.ADMIN, WORKSPACE_ROLE.MEMBER])],
  [WORKSPACE_ROLE.ADMIN, new Set([WORKSPACE_ROLE.MEMBER])],
]);

export interface WorkspacesProcedureSeams {
  resolveUserId: UserIdResolver;
  /** The account the Mac's Better Auth session names, for the procedures that write through the plugin under it. */
  resolveSessionUserId: SessionUserIdResolver;
  workspaces: WorkspaceSeams;
  /** The plugin's member writes, made under the session `resolveSessionUserId` read. */
  members: MemberSeams;
  /** The plugin's delete of a workspace, made under the same session, its hooks run on the asking fiber's services. */
  deleteWorkspace: WorkspaceDeleteCall;
}

/**
 * A write through the plugin, a store failure answered as
 * `hostedStoreOrUnavailable` answers one and the plugin's refusal as the
 * same outage the Mac may retry, logged by its kind alone, since what the
 * plugin threw may quote what it was asked to write.
 */
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

/**
 * Another member of the workspace, as the account would act on them: their
 * role and the plugin's member id. One not in it is not found; the account
 * itself is not permitted, since its own way out is leaving.
 */
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

/** A workspace the account owns; one it is not in is not found, and one it is in but does not own not permitted. */
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

/** Every agent of the workspace not archived, any member's, whether or not the owner sees it, read a page at a time. */
const workspaceAgentsToStop = Effect.fn("web/workspaceAgentsToStop")(function* (
  workspaceId: string,
) {
  const agents: Agent[] = [];
  for (;;) {
    const page = yield* hostedStoreOrUnavailable(
      listAgentsOfDeletedWorkspace(workspaceId, {
        offset: agents.length,
        limit: DELETE_AGENTS_PAGE,
      }),
    );
    agents.push(...page);
    if (page.length < DELETE_AGENTS_PAGE) return agents;
  }
});

/** The members of a workspace as they stand after a write. */
const membersNow = (
  workspaceId: string,
): Effect.Effect<
  { members: Effect.Success<ReturnType<typeof listMembers>> },
  HostedRefusal,
  DatabaseServices
> => Effect.map(hostedStoreOrUnavailable(listMembers(workspaceId)), (members) => ({ members }));

/** A change to a workspace's members, or to the workspace, counted under the member who made it. */
function memberChanged(userId: string, workspaceId: string, action: ServerWorkspaceMemberAction) {
  return recordServerEvent(
    SERVER_EVENT.WORKSPACE_MEMBER_CHANGE,
    { userId, workspaceId },
    { action },
  );
}

/** The workspaces resource: the list, a workspace created, its slug changed, and its members read under the OAuth token; every other write under the Mac's session. */
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
      // Note that nobody who left says nothing, so an answer is as it was before anyone could leave.
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
    /**
     * The owner hands the workspace to one of its admins and becomes an
     * admin. The account's first workspace is refused, because every read
     * names it for its creator, whoever owns it, and nobody may rename it.
     *
     * Note that the admin is made the owner before the owner is made an
     * admin, as two writes, because a failure between them then leaves the
     * workspace two owners rather than none, which nobody could mend; the
     * plugin refuses the sole owner's own step down besides. An heir who is
     * already an owner is one such handover cut short, so the old owner
     * trying again finishes it.
     */
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
    /**
     * Note that every agent is read before any is stopped, so a delete
     * refused as not ready cancels no one's work, and that the workspace's
     * kind is our rule rather than the plugin's, because an account's
     * deletion deletes its own first workspace through the same plugin call.
     */
    delete: session.delete.effect(function* ({ context, input }) {
      const { userId, sessionHeaders: headers } = context;
      const { workspaceId } = input;
      const workspace = yield* ownedWorkspace(userId, workspaceId);
      if (workspace.personal === true) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
      const agents = yield* workspaceAgentsToStop(workspace.id);
      if (!(yield* everyStopsForGood(agents))) {
        return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
      }
      yield* everyStoppedByStarter(STOPPER, agents);
      yield* pluginCallOrRefused(seams.deleteWorkspace({ headers, organizationId: workspace.id }));
      yield* memberChanged(userId, workspace.id, SERVER_WORKSPACE_MEMBER_ACTION.DELETE);
      return { workspaceId: workspace.id };
    }),
    /**
     * Note that the plugin is handed the name alone, because a slug it was
     * handed would move every link's first step with it.
     */
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
    /**
     * Note that the slug is written by the store rather than the plugin,
     * because the slug it leaves is kept as the workspace's in the same
     * transaction, and the owner alone may change it, which our rule holds.
     */
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
    /**
     * Note that the photo is kept as the very `data:` URL the schema read,
     * because the list's version is a digest of that text and the photo's
     * route decodes it again.
     */
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
