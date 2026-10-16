import { Schema as EffectSchema } from "effect";
import { workspaceIdSchema } from "./task-wire.js";
import { ASSIGNABLE_ROLE } from "./workspace-wire.js";

/**
 * workspace-invitation-wire.ts -- a workspace invitation as the Mac asks for, lists, and cancels it, and the web page its invitee accepts it on.
 *
 * An owner or an admin invites people from Settings on the Mac, under its
 * own Better Auth session, through Luke's routes over the organization
 * plugin's invitation calls; each pending invitation comes back with the
 * accept page's address, which the owner copies and sends by hand, and the
 * invitee opens to accept it on the browser's own session.
 *
 * The accept address carries the invited address beside the invitation's
 * id, because an invitation is read to its recipient alone: a browser
 * signed in at another address, which a Google and a GitHub account of the
 * same person often are, learns nothing of it, and the page still has to
 * say whose invitation it is. The address in the query only names it; who
 * may accept is the plugin's check, not the page's.
 *
 * An invitation is the workspace's, not its inviter's: the accept page reads
 * it through Luke's own route (`invitationOfferAnswerSchema`), which names
 * the inviter only while they are still a member, so a link stays good after
 * whoever made it left, as the plugin's own read would not let it.
 */

/** The page an invitee accepts an invitation on. */
const INVITATION_ACCEPT_PAGE = {
  PATH: "/accept-invitation.html",
  /** Better Auth's id of the invitation. */
  ID_PARAM: "id",
  /** The address the invitation was made for. */
  EMAIL_PARAM: "email",
} as const;

/** What the accept page reads from its query: the invitation, and whom it was made for where the link says. */
export interface InvitationAcceptQuery {
  readonly id: string | undefined;
  readonly email: string | undefined;
}

/** The address an invitee opens to accept the invitation, on the service at `origin`. */
export function invitationAcceptUrl(origin: string, invitationId: string, email: string): string {
  const url = new URL(INVITATION_ACCEPT_PAGE.PATH, origin);
  url.searchParams.set(INVITATION_ACCEPT_PAGE.ID_PARAM, invitationId);
  url.searchParams.set(INVITATION_ACCEPT_PAGE.EMAIL_PARAM, email);
  return url.href;
}

/** The accept page's query, as `invitationAcceptUrl` wrote it; an empty parameter is none. */
export function invitationAcceptQuery(search: string): InvitationAcceptQuery {
  const params = new URLSearchParams(search);
  return {
    id: params.get(INVITATION_ACCEPT_PAGE.ID_PARAM) || undefined,
    email: params.get(INVITATION_ACCEPT_PAGE.EMAIL_PARAM) || undefined,
  };
}

/**
 * The roles an invitation may carry. A workspace has one owner, its
 * creator, so nobody is invited as one; and only the owner invites an admin.
 */
export const INVITATION_ROLE = ASSIGNABLE_ROLE;

const INVITATION_BOUNDS = {
  /** The most characters an address may spell (RFC 5321's path limit). */
  MAX_EMAIL_CHARS: 254,
} as const;

/** One address, its ends trimmed: something before an `@` and a dotted domain after it. */
const invitedEmailSchema = EffectSchema.Trim.check(
  EffectSchema.isMaxLength(INVITATION_BOUNDS.MAX_EMAIL_CHARS),
  EffectSchema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u),
);

const invitationRoleSchema = EffectSchema.Literals(Object.values(INVITATION_ROLE));

/**
 * One pending invitation as the Mac shows it: whom it is for, as what, until
 * when, and the accept link to copy, which only the invited address's
 * account accepts.
 */
export const workspaceInvitationSchema = EffectSchema.Struct({
  id: EffectSchema.String.check(EffectSchema.isNonEmpty()),
  email: EffectSchema.String,
  role: invitationRoleSchema,
  /** When the invitation stops being accepted, as an ISO 8601 instant. */
  expiresAt: EffectSchema.String,
  acceptUrl: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

export type WorkspaceInvitation = typeof workspaceInvitationSchema.Type;

/** An invitation asked for (POST), by an owner or an admin of a team's workspace. */
export const workspaceInviteRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  email: invitedEmailSchema,
  role: invitationRoleSchema,
});

/** The invitation made. */
export const workspaceInvitationAnswerSchema = EffectSchema.Struct({
  invitation: workspaceInvitationSchema,
});

/** A workspace's pending invitations, soonest to expire first (GET, and after a cancel). */
export const workspaceInvitationsAnswerSchema = EffectSchema.Struct({
  invitations: EffectSchema.Array(workspaceInvitationSchema),
});

/** The query an invitations read names its workspace under. */
export const WORKSPACE_INVITATIONS_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

/** Why the accept page's read found no invitation to offer: used, canceled, or expired; made for another address; or the address not verified. */
export const INVITATION_OFFER_REFUSAL = {
  SPENT: "spent",
  NOT_RECIPIENT: "not-recipient",
  UNVERIFIED: "unverified",
} as const;

/** The accept page's read's query parameter naming the invitation. */
export const INVITATION_OFFER_QUERY = { ID: "id" } as const;

/** The accept page's read of one invitation (GET), by its id. */
export const invitationOfferQuerySchema = EffectSchema.Struct({
  id: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

/**
 * An invitation as its recipient is offered it: the workspace's name, the
 * role, and who invited them while they are still a member; or why there is
 * none to offer.
 */
export const invitationOfferAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    offer: EffectSchema.Struct({
      id: EffectSchema.String,
      workspaceName: EffectSchema.String,
      role: invitationRoleSchema,
      inviter: EffectSchema.optionalKey(
        EffectSchema.Struct({ name: EffectSchema.String, email: EffectSchema.String }),
      ),
    }),
  }),
  EffectSchema.Struct({
    refused: EffectSchema.Literals(Object.values(INVITATION_OFFER_REFUSAL)),
  }),
]);

export type InvitationOfferAnswer = typeof invitationOfferAnswerSchema.Type;

/** A pending invitation canceled (POST), answered with those still pending. */
export const workspaceInvitationCancelSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  invitationId: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});
