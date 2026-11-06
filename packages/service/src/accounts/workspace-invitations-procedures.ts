import type { MemberSeams, PluginInvitation } from "@repo/database/models/workspace-seams";
import { workspaceGitHubAccountId } from "@repo/database/models/workspace-store";
import { githubAccountAvatarUrl } from "@repo/features/account-picture";
import {
  INVITATION_ROLE,
  invitationAcceptUrl,
  WORKSPACE_INVITATIONS_QUERY,
  type WorkspaceInvitation,
} from "@repo/features/workspace-invitation-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { Clock, Effect, Option } from "effect";
import {
  recordServerEvent,
  SERVER_EVENT,
  SERVER_WORKSPACE_MEMBER_ACTION,
} from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type SessionUserIdResolver,
} from "../http/http-effect.js";
import { hosted, sessionMiddleware } from "../orpc/base.js";
import { readAccountPerson, readAccountPicture } from "./account-person.js";
import { InvitationMail } from "./invitation-mail.js";
import { invitationOffer } from "./invitation-offers.js";
import { managedWorkspace, pluginCallOrRefused } from "./workspace-access.js";

const INVITATION_PENDING = "pending";

const INVITER_UNKNOWN = "A teammate";

export interface WorkspaceInvitationsProcedureSeams {
  resolveSessionUserId: SessionUserIdResolver;
  members: MemberSeams;
}

function expiryOf(invitation: PluginInvitation): Date {
  return invitation.expiresAt instanceof Date
    ? invitation.expiresAt
    : new Date(invitation.expiresAt);
}

function invitationRoleOf(role: string): WorkspaceInvitation["role"] | undefined {
  return Object.values(INVITATION_ROLE).find((one) => one === role);
}

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

const emailInvitation = Effect.fn("web/emailWorkspaceInvitation")(function* (
  invitation: WorkspaceInvitation,
  workspace: Workspace,
  inviterId: string,
) {
  const mail = yield* Effect.serviceOption(InvitationMail);
  if (Option.isNone(mail)) return;
  const inviter = yield* readAccountPerson(inviterId).pipe(Effect.orElseSucceed(() => undefined));
  const accountId = yield* workspaceGitHubAccountId(inviterId, workspace.id).pipe(
    Effect.orElseSucceed(() => Option.none<number>()),
  );
  const workspacePictureUrl = Option.match(accountId, {
    onNone: () => workspace.pictureUrl,
    onSome: githubAccountAvatarUrl,
  });
  const inviterPictureUrl = yield* readAccountPicture(inviterId).pipe(
    Effect.orElseSucceed(() => undefined),
  );
  yield* mail.value.send({
    email: invitation.email,
    acceptUrl: invitation.acceptUrl,
    workspaceName: workspace.name,
    inviterLabel: inviter?.name.trim() || inviter?.email || INVITER_UNKNOWN,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    ...(workspacePictureUrl === undefined ? {} : { workspacePictureUrl }),
    ...(inviterPictureUrl === undefined ? {} : { inviterPictureUrl }),
  });
});

export function workspaceInvitationsProcedures(seams: WorkspaceInvitationsProcedureSeams) {
  const resource = hosted.workspaceInvitations.use(sessionMiddleware(seams.resolveSessionUserId));

  const pendingOf = Effect.fn("web/workspacePendingInvitations")(function* (
    request: Request,
    headers: Headers,
    organizationId: string,
  ) {
    const listed = yield* pluginCallOrRefused(
      seams.members.listInvitations({ headers, organizationId }),
    );
    return pendingInvitations(listed, new URL(request.url).origin, yield* Clock.currentTimeMillis);
  });

  return {
    list: resource.list.effect(function* ({ input, context }) {
      const workspace = yield* managedWorkspace(
        context.userId,
        input[WORKSPACE_INVITATIONS_QUERY.WORKSPACE_ID],
      );
      const invitations = yield* pendingOf(context.request, context.sessionHeaders, workspace.id);
      return { invitations };
    }),
    invite: resource.invite.effect(function* ({ input, context }) {
      const { workspaceId, email, role } = input;
      const workspace = yield* managedWorkspace(context.userId, workspaceId);
      if (role === INVITATION_ROLE.ADMIN && workspace.role !== WORKSPACE_ROLE.OWNER) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
      }
      const made = yield* pluginCallOrRefused(
        seams.members.inviteMember({
          headers: context.sessionHeaders,
          organizationId: workspace.id,
          email,
          role,
        }),
      );
      yield* recordServerEvent(
        SERVER_EVENT.WORKSPACE_INVITE_SEND,
        { userId: context.userId, workspaceId: workspace.id },
        { role },
      );
      const [invitation] = pendingInvitations(
        [made],
        new URL(context.request.url).origin,
        yield* Clock.currentTimeMillis,
      );
      if (invitation === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      yield* emailInvitation(invitation, workspace, context.userId);
      return { invitation };
    }),
    cancel: resource.cancel.effect(function* ({ input, context }) {
      const { workspaceId, invitationId } = input;
      const workspace = yield* managedWorkspace(context.userId, workspaceId);
      const pending = yield* pendingOf(context.request, context.sessionHeaders, workspace.id);
      if (!pending.some((one) => one.id === invitationId)) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      }
      yield* pluginCallOrRefused(
        seams.members.cancelInvitation({ headers: context.sessionHeaders, invitationId }),
      );
      yield* recordServerEvent(
        SERVER_EVENT.WORKSPACE_MEMBER_CHANGE,
        { userId: context.userId, workspaceId: workspace.id },
        { action: SERVER_WORKSPACE_MEMBER_ACTION.INVITE_CANCEL },
      );
      const invitations = yield* pendingOf(context.request, context.sessionHeaders, workspace.id);
      return { invitations };
    }),
    offer: resource.offer.effect(function* ({ input, context }) {
      const now = yield* Clock.currentTimeMillis;
      return yield* hostedStoreOrUnavailable(invitationOffer(context.userId, input.id, now));
    }),
  };
}
