import type { DatabaseServices } from "@luke/database/core/query";
import type { MemberSeams, WorkspaceSeams } from "@luke/database/models/workspace-seams";
import {
  createWorkspace,
  ensurePersonalWorkspace,
  listWorkspaces,
  readWorkspacePhoto,
  workspaceOf,
} from "@luke/database/models/workspace-store";
import { workspaceIdSchema } from "@luke/features/task-wire";
import {
  WORKSPACE_MEMBERS_QUERY,
  WORKSPACE_PHOTO_BOUNDS,
  WORKSPACE_ROLE,
  type WorkspaceRole,
  workspaceCreateRequestSchema,
  workspaceLeaveRequestSchema,
  workspaceMemberRemovalSchema,
  workspaceMemberRoleSchema,
  workspacePhotoSetRequestSchema,
  workspaceRenameRequestSchema,
  workspaceTransferSchema,
} from "@luke/features/workspace-wire";
import { readEither } from "@luke/wire/effect";
import { type Cause, Effect, Layer, Option, Result } from "effect";
import { type HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { unparsedWire } from "../core.js";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import type { GitHubApp } from "../github/github-app.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_BYTES_HEADERS,
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type SessionUserIdResolver,
  type UserIdResolver,
} from "../http/http-effect.js";
import type { StoreFailure } from "../http/store-failure.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { answeredWorkspace, managedWorkspace, pluginCallOrRefused } from "./workspace-access.js";
import { listFormerMembers, listMembers, memberIdOf } from "./workspace-members.js";

/**
 * workspaces-app.ts -- the account's workspaces as the Mac reads and asks for them: the list, a workspace created, renamed, given a photo, or handed over, and its members read, removed, given a role, or left.
 *
 * `GET /api/workspaces` answers every workspace the bearer's account is a
 * member of, the one made for it first and the rest by name, each with the
 * account's role and its connected GitHub account; that first workspace is
 * ensured before the read, so an account's first read makes it, and it is
 * then a workspace like any other. `POST` creates a
 * workspace with the name given through the organization plugin's
 * server-only create, the account its owner. A workspace's GitHub is
 * connected through the hosted procedures (`workspace-github-procedures.ts`),
 * and its repositories are its installations' alone, so one with nothing
 * connected has none.
 * `GET /api/workspaces/members` answers a workspace's
 * members to a member of it, and who its work still names but left. `POST /api/workspaces/members/remove` lets the
 * owner remove an admin or a member, and an admin a member alone;
 * `POST /api/workspaces/members/role` lets the owner alone make a member an
 * admin or an admin a member; `POST /api/workspaces/transfer` lets the owner
 * alone hand the workspace to an admin, becoming an admin, though never the
 * account's own first workspace, which is named for its creator; each
 * answers the members as they then stand. Nobody removes or changes
 * themselves, whose way out is leaving, or the owner.
 * `POST /api/workspaces/leave` lets anyone but an owner leave.
 * `POST /api/workspaces/rename` lets an owner or admin rename a workspace,
 * answering it under its new name and its old slug; an account's first
 * workspace is refused, since it is named by its owner's account name.
 * `GET /api/workspaces/<id>/photo` serves a workspace's photo as its bytes
 * to a member of it; the list names only which version of it stands.
 * `POST /api/workspaces/photo/set` lets an owner or admin set the photo, as
 * a `data:` URL of a photo's type within its bound, or remove it with null,
 * answering the workspace with its photo's new version or none.
 * The bearer is resolved before any row is touched.
 *
 * Removing, changing a role, handing over, leaving, renaming, and setting
 * the photo are Better Auth's own `removeMember`, `updateMemberRole`,
 * `leaveOrganization`, and `updateOrganization`
 * (https://www.better-auth.com/docs/plugins/organization#remove-member),
 * so their bearer is the Mac's Better Auth session, signed, which the bearer
 * plugin reads as the session cookie those calls take; every other path
 * here takes the Mac's OAuth token. Luke's own rules stand in front of the
 * plugin's, which checks the caller's role and membership again itself.
 * An owner's or an admin's invitations are made, read, and canceled the
 * same way, through the hosted procedures (`workspace-invitations-procedures.ts`).
 */

const WORKSPACES_PATH = "/api/workspaces";
const MEMBERS_PATH = "/api/workspaces/members";
const MEMBERS_REMOVE_PATH = "/api/workspaces/members/remove";
const MEMBERS_ROLE_PATH = "/api/workspaces/members/role";
const TRANSFER_PATH = "/api/workspaces/transfer";
const LEAVE_PATH = "/api/workspaces/leave";
const RENAME_PATH = "/api/workspaces/rename";
/** GET serves a workspace's photo; the rewrite moves the path's workspace id into the `id` query. */
const PHOTO_PATH = "/api/workspaces/photo";

/** POST sets or removes a workspace's photo. */
const PHOTO_SET_PATH = "/api/workspaces/photo/set";

/** The query the photo's rewrite names its workspace under. */
const PHOTO_QUERY = { ID: "id" } as const;

const HTTP_METHOD = { GET: "GET", POST: "POST" } as const;

/** A workspace's name or id is a few dozen characters, so a body past this is not one. */
const MAXIMUM_BODY_BYTES = 1_024;

/**
 * A photo's body: its bytes at their bound spelled in base64, four
 * characters to every three bytes, and a name's body beside them for the
 * URL's prefix and the workspace's id. Note that a photo just past the
 * bound still fits, because its refusal is the invalid one the schema says.
 */
const PHOTO_BODY_BYTES = Math.ceil(WORKSPACE_PHOTO_BOUNDS.MAX_BYTES / 3) * 4 + MAXIMUM_BODY_BYTES;

/** The roles a workspace is handed to: an admin, or an owner a handover cut short already made one. */
const HEIR_ROLES: ReadonlySet<WorkspaceRole> = new Set([
  WORKSPACE_ROLE.ADMIN,
  WORKSPACE_ROLE.OWNER,
]);

/** The roles each role removes: the owner an admin or a member, an admin a member alone. */
const REMOVABLE_BY: ReadonlyMap<WorkspaceRole, ReadonlySet<WorkspaceRole>> = new Map([
  [WORKSPACE_ROLE.OWNER, new Set([WORKSPACE_ROLE.ADMIN, WORKSPACE_ROLE.MEMBER])],
  [WORKSPACE_ROLE.ADMIN, new Set([WORKSPACE_ROLE.MEMBER])],
]);

export interface WorkspacesAppSeams {
  resolveUserId: UserIdResolver;
  /** The account the Mac's Better Auth session names, for the paths that write through the plugin under it. */
  resolveSessionUserId: SessionUserIdResolver;
  workspaces: WorkspaceSeams;
  /** The plugin's member writes, made under the session `resolveSessionUserId` read. */
  members: MemberSeams;
}

type Requirements =
  | HttpServerRequest.HttpServerRequest
  | DatabaseServices
  | HttpClient.HttpClient
  | GitHubApp;

/**
 * A write through the plugin, a store failure answered as
 * `hostedStoreOrUnavailable` answers one and the plugin's refusal as the
 * same outage the Mac may retry, logged by its kind alone, since what the
 * plugin threw may quote what it was asked to write.
 */
function pluginWriteOrUnavailable<A, R>(
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

/** The bearer's account, or the request refused as unauthenticated. */
const accountOf = Effect.fn("web/workspacesAccount")(function* (seams: WorkspacesAppSeams) {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

/**
 * The account the Mac's session names, and the headers that carry it on to
 * the plugin; a session the service does not take is refused as
 * unauthenticated, which is the Mac's cue to ask for a new one.
 */
const sessionAccountOf = Effect.fn("web/workspacesSessionAccount")(function* (
  seams: WorkspacesAppSeams,
) {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveSessionUserId(request).pipe(
    Effect.tapError((failure) => Effect.logWarning("the auth service read no session", failure)),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return { userId: account.value, headers: request.headers };
});

/** GET: the account's workspaces; POST: one created. */
const workspacesEndpoint = Effect.fn("web/workspacesEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET && incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const userId = yield* accountOf(seams);
  yield* pluginWriteOrUnavailable(ensurePersonalWorkspace(userId, seams.workspaces));
  if (incoming.method === HTTP_METHOD.GET) {
    const workspaces = yield* hostedStoreOrUnavailable(listWorkspaces(userId));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { workspaces });
  }
  const body = yield* readJsonBodyEffect(MAXIMUM_BODY_BYTES);
  const asked = readEither(workspaceCreateRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const organizationId = yield* pluginWriteOrUnavailable(
    createWorkspace(userId, asked.success.name, seams.workspaces),
  );
  yield* recordServerEvent(SERVER_EVENT.WORKSPACE_CREATE, userId, {});
  const workspace = yield* answeredWorkspace(userId, organizationId);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.CREATED, { workspace });
});

/** GET: a workspace's members, and who its work names but left, to a member of it. */
const membersEndpoint = Effect.fn("web/workspaceMembersEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const userId = yield* accountOf(seams);
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const named = new URL(request.url).searchParams.getAll(WORKSPACE_MEMBERS_QUERY.WORKSPACE_ID);
  const asked = readEither(workspaceIdSchema)(unparsedWire(named[0]));
  if (named.length !== 1 || Result.isFailure(asked)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const workspace = yield* answeredWorkspace(userId, asked.success);
  const members = yield* hostedStoreOrUnavailable(listMembers(workspace.id));
  const former = yield* hostedStoreOrUnavailable(listFormerMembers(workspace.id));
  // Note that nobody who left says nothing, so an answer is as it was before anyone could leave.
  return hostedJsonResponse(
    HOSTED_HTTP_STATUS.OK,
    former.length === 0 ? { members } : { members, former },
  );
});

/**
 * GET: a workspace's photo as its bytes under its media type, to a member
 * of it alone. A workspace the account is not in, an id that names none,
 * and one with no photo are all not found, so a non-member learns nothing.
 */
const photoEndpoint = Effect.fn("web/workspacePhotoEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const userId = yield* accountOf(seams);
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const named = new URL(request.url).searchParams.getAll(PHOTO_QUERY.ID);
  const asked = readEither(workspaceIdSchema)(unparsedWire(named[0]));
  if (named.length !== 1 || Result.isFailure(asked)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  const photo = yield* hostedStoreOrUnavailable(readWorkspacePhoto(userId, asked.success));
  if (Option.isNone(photo)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return HttpServerResponse.uint8Array(photo.value.bytes, {
    status: HOSTED_HTTP_STATUS.OK,
    contentType: photo.value.contentType,
    headers: HOSTED_BYTES_HEADERS,
  });
});

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

/** POST: the owner removes an admin or a member, and an admin a member, answered with those who remain. */
const removeEndpoint = Effect.fn("web/workspaceMemberRemoveEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const { userId, headers } = yield* sessionAccountOf(seams);
  const body = yield* readJsonBodyEffect(MAXIMUM_BODY_BYTES);
  const asked = readEither(workspaceMemberRemovalSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { workspaceId, userId: removed } = asked.success;
  const workspace = yield* answeredWorkspace(userId, workspaceId);
  const removable = REMOVABLE_BY.get(workspace.role);
  if (removable === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const { role, memberId } = yield* otherMemberOf(userId, workspaceId, removed);
  if (!removable.has(role)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  yield* pluginCallOrRefused(
    seams.members.removeMember({ headers, organizationId: workspaceId, memberId }),
  );
  const members = yield* hostedStoreOrUnavailable(listMembers(workspaceId));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { members });
});

/** POST: the owner makes another member an admin or an admin a member, answered with the members as they then stand. */
const roleEndpoint = Effect.fn("web/workspaceMemberRoleEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const { userId, headers } = yield* sessionAccountOf(seams);
  const body = yield* readJsonBodyEffect(MAXIMUM_BODY_BYTES);
  const asked = readEither(workspaceMemberRoleSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { workspaceId, userId: changed, role } = asked.success;
  yield* ownedWorkspace(userId, workspaceId);
  const other = yield* otherMemberOf(userId, workspaceId, changed);
  if (other.role === WORKSPACE_ROLE.OWNER) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  yield* pluginCallOrRefused(
    seams.members.updateMemberRole({
      headers,
      organizationId: workspaceId,
      memberId: other.memberId,
      role,
    }),
  );
  const members = yield* hostedStoreOrUnavailable(listMembers(workspaceId));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { members });
});

/**
 * POST: the owner hands the workspace to one of its admins and becomes an
 * admin, answered with the members as they then stand. The account's first
 * workspace is refused, because every read names it for its creator, whoever
 * owns it, and nobody may rename it.
 *
 * Note that the admin is made the owner before the owner is made an admin,
 * as two writes, because a failure between them then leaves the workspace
 * two owners rather than none, which nobody could mend; the plugin refuses
 * the sole owner's own step down besides. An heir who is already an owner
 * is one such handover cut short, so the old owner trying again finishes it.
 */
const transferEndpoint = Effect.fn("web/workspaceTransferEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const { userId, headers } = yield* sessionAccountOf(seams);
  const body = yield* readJsonBodyEffect(MAXIMUM_BODY_BYTES);
  const asked = readEither(workspaceTransferSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { workspaceId, userId: heir } = asked.success;
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
  if (other.role !== WORKSPACE_ROLE.OWNER) yield* giveRole(other.memberId, WORKSPACE_ROLE.OWNER);
  yield* giveRole(ownMemberId.value, WORKSPACE_ROLE.ADMIN);
  const members = yield* hostedStoreOrUnavailable(listMembers(workspaceId));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { members });
});

/** POST: the account leaves a workspace it does not own. */
const leaveEndpoint = Effect.fn("web/workspaceLeaveEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const { userId, headers } = yield* sessionAccountOf(seams);
  const body = yield* readJsonBodyEffect(MAXIMUM_BODY_BYTES);
  const asked = readEither(workspaceLeaveRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { workspaceId } = asked.success;
  const workspace = yield* answeredWorkspace(userId, workspaceId);
  if (workspace.role === WORKSPACE_ROLE.OWNER) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
  yield* pluginCallOrRefused(
    seams.members.leaveOrganization({ headers, organizationId: workspaceId }),
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { workspaceId });
});

/**
 * POST: an owner or admin renames a workspace, answered with it as it then
 * stands; an account's first workspace is refused, because every read names
 * it by its owner's account name and a name of its own would never show.
 * Note that the plugin is handed the name alone, because a slug it was
 * handed would move every link's first step with it.
 */
const renameEndpoint = Effect.fn("web/workspaceRenameEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const { userId, headers } = yield* sessionAccountOf(seams);
  const body = yield* readJsonBodyEffect(MAXIMUM_BODY_BYTES);
  const asked = readEither(workspaceRenameRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { workspaceId, name } = asked.success;
  const workspace = yield* managedWorkspace(userId, workspaceId);
  if (workspace.personal === true) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  yield* pluginCallOrRefused(
    seams.members.updateOrganization({ headers, organizationId: workspace.id, data: { name } }),
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    workspace: yield* answeredWorkspace(userId, workspace.id),
  });
});

/**
 * POST: an owner or admin sets a workspace's photo, or removes it with
 * null, answered with the workspace as it then stands. Note that the photo
 * is kept as the very `data:` URL the schema read, because the list's
 * version is a digest of that text and the photo's route decodes it again.
 */
const photoSetEndpoint = Effect.fn("web/workspacePhotoSetEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const { userId, headers } = yield* sessionAccountOf(seams);
  const body = yield* readJsonBodyEffect(PHOTO_BODY_BYTES);
  const asked = readEither(workspacePhotoSetRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { workspaceId, photo } = asked.success;
  const workspace = yield* managedWorkspace(userId, workspaceId);
  yield* pluginCallOrRefused(
    seams.members.updateOrganization({
      headers,
      organizationId: workspace.id,
      data: { logo: photo },
    }),
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    workspace: yield* answeredWorkspace(userId, workspace.id),
  });
});

/** The group: the workspaces path, the rename, the four members paths, the handover, the photo's two paths, and the hosted vocabulary's own refusal for any other. */
export function workspacesApp(
  seams: WorkspacesAppSeams,
): WebRoutes<DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, WORKSPACES_PATH, hostedRefusing(workspacesEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, MEMBERS_PATH, hostedRefusing(membersEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, MEMBERS_REMOVE_PATH, hostedRefusing(removeEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, MEMBERS_ROLE_PATH, hostedRefusing(roleEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TRANSFER_PATH, hostedRefusing(transferEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, LEAVE_PATH, hostedRefusing(leaveEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, RENAME_PATH, hostedRefusing(renameEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PHOTO_PATH, hostedRefusing(photoEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PHOTO_SET_PATH, hostedRefusing(photoSetEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
