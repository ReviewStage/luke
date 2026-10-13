/**
 * workspace-invitation-wire.ts -- the two web pages a workspace invitation passes through, and the query each reads.
 *
 * An owner or an admin opens the invite page from the Mac for the workspace
 * it names; the page asks Better Auth for the invitation and shows the
 * accept page's address, which the invitee opens to accept it. Both pages
 * talk to Better Auth's organization endpoints on the browser's own session.
 *
 * The accept address carries the invited address beside the invitation's
 * id, because Better Auth reads an invitation to its recipient alone: a
 * browser signed in at another address, which a Google and a GitHub account
 * of the same person often are, learns nothing from the plugin, and the
 * page still has to say whose invitation it is. The address in the query
 * only names it; who may accept is the plugin's check, not the page's.
 */

/** The page an owner or an admin invites people from, and lists and cancels pending invitations on. */
export const WORKSPACE_INVITE_PAGE = {
  PATH: "/invite.html",
  /** The id of the workspace to invite people to. */
  WORKSPACE_PARAM: "workspace",
} as const;

/** The page an invitee accepts an invitation on. */
const INVITATION_ACCEPT_PAGE = {
  PATH: "/accept-invitation.html",
  /** Better Auth's id of the invitation. */
  ID_PARAM: "id",
  /** The address the invitation was made for, as the invite page knew it. */
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
