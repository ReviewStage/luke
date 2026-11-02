/**
 * workspace-invitations-procedures.ts -- a workspace's invitations as an owner or an admin lists, makes, and cancels them from the Mac, and one as its recipient is offered it on the accept page.
 *
 * Every procedure here runs under a Better Auth session, the Mac's signed
 * one or the browser's cookie, because the invitations are the
 * organization plugin's own: `GET /api/workspaces/invitations` answers the
 * pending invitations, each with its accept link, `POST` makes one through
 * the plugin's `createInvitation`
 * (https://www.better-auth.com/docs/plugins/organization#send-invitation),
 * the owner alone inviting an admin, and emails its link to the invited
 * address where the deployment names a sender (`invitation-mail.ts`), and `POST
 * /api/workspaces/invitations/cancel` cancels one through
 * `cancelInvitation`, answering those still pending. `GET
 * /api/workspaces/invitations/offer` answers one invitation as its
 * recipient is offered it (`invitation-offers.ts`): the workspace's name,
 * the role, and the inviter while they are still a member, or why there is
 * none to offer. Our own rules stand in front of the plugin's, which
 * checks the caller's role and membership again itself.
 *
 * The session is resolved before the input is read, by the middleware on
 * the resource, so an unsigned caller is refused as unauthenticated
 * whatever it sent.
 */

import type { MemberSeams, PluginInvitation } from "@luke/database/models/workspace-seams";
import { workspaceGitHubAccountId } from "@luke/database/models/workspace-store";
import { githubAccountAvatarUrl } from "@luke/features/account-picture";
import {
  INVITATION_ROLE,
  invitationAcceptUrl,
  WORKSPACE_INVITATIONS_QUERY,
  type WorkspaceInvitation,
} from "@luke/features/workspace-invitation-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
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

/** The plugin's word for an invitation not yet accepted, rejected, or canceled. */
const INVITATION_PENDING = "pending";

/** Who an invitation's email says invited them where the inviter's account cannot be read. */
const INVITER_UNKNOWN = "A teammate";

export interface WorkspaceInvitationsProcedureSeams {
  /** The account the Better Auth session names, the Mac's or the browser's. */
  resolveSessionUserId: SessionUserIdResolver;
  /** The plugin's invitation calls, made under that session. */
  members: MemberSeams;
}

/** An invitation's expiry as the instant it is, however the plugin's adapter handed it back. */
function expiryOf(invitation: PluginInvitation): Date {
  return invitation.expiresAt instanceof Date
    ? invitation.expiresAt
    : new Date(invitation.expiresAt);
}

/** The role an invitation carries, where it is one an invitation may; anything else is no invitation of ours. */
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

/**
 * The invitation made, emailed to its address from the deployment's sender
 * (`invitation-mail.ts`), naming the inviter by their name, or their address
 * where their account has none, as stage did. A runtime without a sender
 * emails nothing, and an inviter whose row cannot be read is "A teammate",
 * since the invitation already stands.
 *
 * The letter shows pictures a mail client loads by address alone: the
 * workspace's connected GitHub account's avatar, else, on the inviter's own
 * first workspace, their sign-in picture, else the letter draws its tile; and
 * the inviter's sign-in picture, else their initial. Note that a photo
 * uploaded in Settings is not shown, because it is served to members alone.
 */
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

/** The workspace invitations resource: the list, the make, and the cancel to an owner or an admin, and the offer to its recipient. */
export function workspaceInvitationsProcedures(seams: WorkspaceInvitationsProcedureSeams) {
  const resource = hosted.workspaceInvitations.use(sessionMiddleware(seams.resolveSessionUserId));

  /** The workspace's pending invitations as the plugin lists them under the session, read for the Mac. */
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
      // Note that only a pending invitation of this workspace is canceled,
      // because the plugin checks the caller's role in whichever workspace the
      // id names, not the one the body names.
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
