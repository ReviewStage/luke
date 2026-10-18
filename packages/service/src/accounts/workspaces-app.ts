import type { DatabaseServices } from "@luke/database/core/query";
import type {
  MemberSeams,
  OrganizationRefused,
  PluginInvitation,
  WorkspaceSeams,
} from "@luke/database/models/workspace-seams";
import {
  createWorkspace,
  ensurePersonalWorkspace,
  listWorkspaces,
  readWorkspacePhoto,
  type Workspace,
  workspaceOf,
} from "@luke/database/models/workspace-store";
import { workspaceIdSchema } from "@luke/features/task-wire";
import {
  INVITATION_OFFER_QUERY,
  INVITATION_ROLE,
  invitationAcceptUrl,
  invitationOfferQuerySchema,
  WORKSPACE_INVITATIONS_QUERY,
  type WorkspaceInvitation,
  workspaceInvitationCancelSchema,
  workspaceInviteRequestSchema,
} from "@luke/features/workspace-invitation-wire";
import {
  WORKSPACE_MEMBERS_QUERY,
  WORKSPACE_PHOTO_BOUNDS,
  WORKSPACE_ROLE,
  type WorkspaceRole,
  workspaceCreateRequestSchema,
  workspaceGithubRequestSchema,
  workspaceLeaveRequestSchema,
  workspaceMemberRemovalSchema,
  workspaceMemberRoleSchema,
  workspacePhotoSetRequestSchema,
  workspaceRenameRequestSchema,
  workspaceTransferSchema,
} from "@luke/features/workspace-wire";
import { readEither } from "@luke/wire/effect";
import { type Cause, Clock, Effect, Layer, Option, Result } from "effect";
import { type HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { unparsedWire } from "../core.js";
import { GitHubApp } from "../github/github-app.js";
import { createConnectIntent, GITHUB_CONNECT_ROLES } from "../github/github-installations.js";
import { logGitHubReadFailure } from "../github/github-refusal.js";
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
import { invitationOffer } from "./invitation-offers.js";
import { listFormerMembers, listMembers, memberIdOf } from "./workspace-members.js";

/**
 * workspaces-app.ts -- the account's workspaces as the Mac reads and asks for them: the list, a workspace created, renamed, given a photo, or handed over, a GitHub account connected, and its members read, removed, given a role, or left.
 *
 * `GET /api/workspaces` answers every workspace the bearer's account is a
 * member of, the one made for it first and the rest by name, each with the
 * account's role and its connected GitHub account; that first workspace is
 * ensured before the read, so an account's first read makes it, and it is
 * then a workspace like any other. `POST` creates a
 * workspace with the name given through the organization plugin's
 * server-only create, the account its owner. `POST /api/workspaces/github/connect`
 * answers where the browser goes to connect GitHub: the Luke GitHub App's
 * install address with a single-use intent as its `state`, which the connect's
 * callback spends (`github-install-app.ts`), adding the installation beside
 * any the workspace holds; it takes an owner or admin of the workspace, and
 * a workspace the account is not in answers as none does. Which
 * installations and repositories a workspace holds is managed on GitHub, so
 * `.../disconnect`, which a Mac from before several installations still
 * sends, is refused as not permitted and removes nothing. A workspace's
 * repositories are its installations' alone, so one with nothing connected
 * has none.
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
 *
 * An owner or an admin of a workspace invites people from the Mac the
 * same way, under the session, the owner alone as an admin: `GET /api/workspaces/invitations` answers the
 * pending invitations, each with its accept link, `POST` makes one through
 * the plugin's `createInvitation`
 * (https://www.better-auth.com/docs/plugins/organization#send-invitation),
 * and `POST /api/workspaces/invitations/cancel` cancels one through
 * `cancelInvitation`, answering those still pending.
 */

const WORKSPACES_PATH = "/api/workspaces";
const GITHUB_CONNECT_PATH = "/api/workspaces/github/connect";
const GITHUB_DISCONNECT_PATH = "/api/workspaces/github/disconnect";
const MEMBERS_PATH = "/api/workspaces/members";
const MEMBERS_REMOVE_PATH = "/api/workspaces/members/remove";
const MEMBERS_ROLE_PATH = "/api/workspaces/members/role";
const TRANSFER_PATH = "/api/workspaces/transfer";
const LEAVE_PATH = "/api/workspaces/leave";
const RENAME_PATH = "/api/workspaces/rename";
const INVITATIONS_PATH = "/api/workspaces/invitations";
const INVITATION_OFFER_PATH = "/api/workspaces/invitations/offer";
const INVITATIONS_CANCEL_PATH = "/api/workspaces/invitations/cancel";
/** GET serves a workspace's photo; the rewrite moves the path's workspace id into the `id` query. */
const PHOTO_PATH = "/api/workspaces/photo";

/** POST sets or removes a workspace's photo. */
const PHOTO_SET_PATH = "/api/workspaces/photo/set";

/** The query the photo's rewrite names its workspace under. */
const PHOTO_QUERY = { ID: "id" } as const;

/** The plugin's word for an invitation not yet accepted, rejected, or canceled. */
const INVITATION_PENDING = "pending";

/** The plugin's codes for an address it will not invite because it already is, or already was. */
const ALREADY_INVITED_CODES: ReadonlySet<string> = new Set([
  "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION",
  "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION",
]);

const HTTP_METHOD = { GET: "GET", POST: "POST" } as const;

/** The query GitHub carries back to the Setup URL, which is the connect intent's state. */
const INSTALL_STATE_PARAM = "state";

/** A workspace's name or id is a few dozen characters, so a body past this is not one. */
const MAXIMUM_BODY_BYTES = 1_024;

/**
 * A photo's body: its bytes at their bound spelled in base64, four
 * characters to every three bytes, and a name's body beside them for the
 * URL's prefix and the workspace's id. Note that a photo just past the
 * bound still fits, because its refusal is the invalid one the schema says.
 */
const PHOTO_BODY_BYTES = Math.ceil(WORKSPACE_PHOTO_BOUNDS.MAX_BYTES / 3) * 4 + MAXIMUM_BODY_BYTES;

/** The roles that rename the workspace, set its photo, or invite people to it. */
const MANAGING_ROLES: ReadonlySet<string> = new Set([WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN]);

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

/**
 * A plugin call under the session: its refusal of the session as
 * unauthenticated, an address already in or invited as such, any other
 * refusal as not permitted, since Luke's own rules already passed, and a
 * failure that is not a refusal as the outage the Mac may retry, logged by
 * its kind alone.
 */
function pluginCallOrRefused<A, R>(
  write: Effect.Effect<A, OrganizationRefused | Cause.UnknownError, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return Effect.catch(write, (failure): Effect.Effect<never, HostedRefusal> => {
    if (failure._tag === "UnknownError") {
      return Effect.andThen(
        Effect.logWarning("Member write failed: UnknownError"),
        Effect.fail(HOSTED_REFUSAL.UNAVAILABLE),
      );
    }
    if (failure.status === HOSTED_HTTP_STATUS.UNAUTHORIZED) {
      return Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    }
    return Effect.fail(
      failure.code !== undefined && ALREADY_INVITED_CODES.has(failure.code)
        ? HOSTED_REFUSAL.ALREADY_INVITED
        : HOSTED_REFUSAL.NOT_PERMITTED,
    );
  });
}

/** An invitation's expiry as the instant it is, however the plugin's adapter handed it back. */
function expiryOf(invitation: PluginInvitation): Date {
  return invitation.expiresAt instanceof Date
    ? invitation.expiresAt
    : new Date(invitation.expiresAt);
}

/** The role an invitation carries, where it is one an invitation may; anything else is no invitation of Luke's. */
function invitationRoleOf(role: string): WorkspaceInvitation["role"] | undefined {
  return Object.values(INVITATION_ROLE).find((one) => one === role);
}

/**
 * The plugin's invitations as the Mac reads them: pending and unexpired
 * alone, soonest to expire first, each with its accept link on the service's
 * own origin.
 */
function pendingInvitations(
  invitations: readonly PluginInvitation[],
  origin: string,
  now: number,
): readonly WorkspaceInvitation[] {
  return invitations
    .filter((one) => one.status === INVITATION_PENDING && expiryOf(one).getTime() > now)
    .toSorted((first, second) => expiryOf(first).getTime() - expiryOf(second).getTime())
    .flatMap((one) => {
      const role = invitationRoleOf(one.role);
      if (role === undefined) return [];
      return [
        {
          id: one.id,
          email: one.email,
          role,
          expiresAt: expiryOf(one).toISOString(),
          acceptUrl: invitationAcceptUrl(origin, one.id, one.email),
        },
      ];
    });
}

/** The workspace the body names, where the account is an owner or admin of it; one it is not in is not found. */
const administeredWorkspace = Effect.fn("web/administeredWorkspace")(function* (userId: string) {
  const body = yield* readJsonBodyEffect(MAXIMUM_BODY_BYTES);
  const asked = readEither(workspaceGithubRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, asked.success.workspaceId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  if (!GITHUB_CONNECT_ROLES.has(workspace.value.role)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
  return workspace.value;
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
  const workspace = yield* answeredWorkspace(userId, organizationId);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.CREATED, { workspace });
});

/** The workspace as the account now sees it; one that vanished between the write and this read is not found. */
const answeredWorkspace = Effect.fn("web/answeredWorkspace")(function* (
  userId: string,
  organizationId: string,
): Effect.fn.Return<Workspace, HostedRefusal, DatabaseServices> {
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, organizationId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return workspace.value;
});

/** POST: where the browser goes to connect GitHub to the workspace. */
const connectEndpoint = Effect.fn("web/workspaceGithubConnectEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const userId = yield* accountOf(seams);
  const workspace = yield* administeredWorkspace(userId);
  const app = yield* GitHubApp;
  const installUrl = yield* app.installUrl.pipe(
    Effect.catch((failure) =>
      Effect.andThen(logGitHubReadFailure(failure), Effect.fail(HOSTED_REFUSAL.UNAVAILABLE)),
    ),
  );
  const state = yield* hostedStoreOrUnavailable(createConnectIntent(userId, workspace.id));
  const url = new URL(installUrl);
  url.searchParams.set(INSTALL_STATE_PARAM, state);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { url: url.toString() });
});

/**
 * POST: refused as not permitted to every account, removing nothing. A Mac
 * from before several installations offered Disconnect, which removed the
 * workspace's one; a workspace's installations are now managed on GitHub,
 * where uninstalling one reaches the webhook, so the old press must not
 * remove every installation the workspace holds.
 */
const disconnectEndpoint = Effect.fn("web/workspaceGithubDisconnectEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  yield* accountOf(seams);
  return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
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

/** A workspace the account is an owner or an admin of; the one whose invitations it manages, that it renames, or whose photo it sets. */
const managedWorkspace = Effect.fn("web/managedWorkspace")(function* (
  userId: string,
  organizationId: string,
): Effect.fn.Return<Workspace, HostedRefusal, DatabaseServices> {
  const workspace = yield* answeredWorkspace(userId, organizationId);
  if (!MANAGING_ROLES.has(workspace.role)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  return workspace;
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

/** The service's own origin, which an accept link is built on. */
const serviceOrigin = Effect.gen(function* () {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  return new URL(request.url).origin;
});

/** The workspace's pending invitations as the plugin lists them under the session, read for the Mac. */
const pendingOf = Effect.fn("web/workspacePendingInvitations")(function* (
  seams: WorkspacesAppSeams,
  headers: Headers,
  organizationId: string,
) {
  const listed = yield* pluginCallOrRefused(
    seams.members.listInvitations({ headers, organizationId }),
  );
  return pendingInvitations(listed, yield* serviceOrigin, yield* Clock.currentTimeMillis);
});

/** POST: an invitation made by an owner or an admin, as an admin by the owner alone, answered with it and its accept link. */
const inviteEndpoint = Effect.fn("web/workspaceInviteEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const { userId, headers } = yield* sessionAccountOf(seams);
  const body = yield* readJsonBodyEffect(MAXIMUM_BODY_BYTES);
  const asked = readEither(workspaceInviteRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { workspaceId, email, role } = asked.success;
  const workspace = yield* managedWorkspace(userId, workspaceId);
  if (role === INVITATION_ROLE.ADMIN && workspace.role !== WORKSPACE_ROLE.OWNER) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
  const made = yield* pluginCallOrRefused(
    seams.members.inviteMember({ headers, organizationId: workspace.id, email, role }),
  );
  const [invitation] = pendingInvitations(
    [made],
    yield* serviceOrigin,
    yield* Clock.currentTimeMillis,
  );
  if (invitation === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.CREATED, { invitation });
});

/** GET: a workspace's pending invitations, to an owner or an admin; POST: one made. */
const invitationsEndpoint = Effect.fn("web/workspaceInvitationsEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method === HTTP_METHOD.POST) return yield* inviteEndpoint(seams);
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const { userId, headers } = yield* sessionAccountOf(seams);
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const named = new URL(request.url).searchParams.getAll(WORKSPACE_INVITATIONS_QUERY.WORKSPACE_ID);
  const asked = readEither(workspaceIdSchema)(unparsedWire(named[0]));
  if (named.length !== 1 || Result.isFailure(asked)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const workspace = yield* managedWorkspace(userId, asked.success);
  const invitations = yield* pendingOf(seams, headers, workspace.id);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { invitations });
});

/**
 * GET: one invitation as its recipient is offered it on the accept page,
 * under the browser's session (`invitation-offers.ts`): the workspace's
 * name, the role, and the inviter while they are still a member, or why
 * there is none to offer. An invitation outlives the member who made it.
 */
const invitationOfferEndpoint = Effect.fn("web/workspaceInvitationOfferEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const { userId } = yield* sessionAccountOf(seams);
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const named = new URL(request.url).searchParams.getAll(INVITATION_OFFER_QUERY.ID);
  const asked = readEither(invitationOfferQuerySchema)(unparsedWire({ id: named[0] }));
  if (named.length !== 1 || Result.isFailure(asked)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const now = yield* Clock.currentTimeMillis;
  const answer = yield* hostedStoreOrUnavailable(invitationOffer(userId, asked.success.id, now));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, answer);
});

/** POST: a pending invitation canceled by an owner or an admin, answered with those still pending. */
const cancelInvitationEndpoint = Effect.fn("web/workspaceInvitationCancelEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const { userId, headers } = yield* sessionAccountOf(seams);
  const body = yield* readJsonBodyEffect(MAXIMUM_BODY_BYTES);
  const asked = readEither(workspaceInvitationCancelSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { workspaceId, invitationId } = asked.success;
  const workspace = yield* managedWorkspace(userId, workspaceId);
  // Note that only a pending invitation of this workspace is canceled,
  // because the plugin checks the caller's role in whichever workspace the
  // id names, not the one the body names.
  const pending = yield* pendingOf(seams, headers, workspace.id);
  if (!pending.some((one) => one.id === invitationId)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  yield* pluginCallOrRefused(seams.members.cancelInvitation({ headers, invitationId }));
  const invitations = yield* pendingOf(seams, headers, workspace.id);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { invitations });
});

/** The group: the workspaces path, the rename, the two GitHub paths, the four members paths, the handover, the photo's two paths, the two invitations paths, and the hosted vocabulary's own refusal for any other. */
export function workspacesApp(
  seams: WorkspacesAppSeams,
): WebRoutes<DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, WORKSPACES_PATH, hostedRefusing(workspacesEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, GITHUB_CONNECT_PATH, hostedRefusing(connectEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, GITHUB_DISCONNECT_PATH, hostedRefusing(disconnectEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, MEMBERS_PATH, hostedRefusing(membersEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, MEMBERS_REMOVE_PATH, hostedRefusing(removeEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, MEMBERS_ROLE_PATH, hostedRefusing(roleEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TRANSFER_PATH, hostedRefusing(transferEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, LEAVE_PATH, hostedRefusing(leaveEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, RENAME_PATH, hostedRefusing(renameEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PHOTO_PATH, hostedRefusing(photoEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PHOTO_SET_PATH, hostedRefusing(photoSetEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, INVITATIONS_PATH, hostedRefusing(invitationsEndpoint(seams))),
    HttpRouter.add(
      ANY_METHOD,
      INVITATION_OFFER_PATH,
      hostedRefusing(invitationOfferEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      INVITATIONS_CANCEL_PATH,
      hostedRefusing(cancelInvitationEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}
