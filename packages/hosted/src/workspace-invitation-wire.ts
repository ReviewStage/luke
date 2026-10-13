/**
 * workspace-invitation-wire.ts -- the two web pages a workspace invitation passes through, and the query each reads.
 *
 * An owner or an admin opens the invite page from the Mac for the workspace
 * it names; the page asks Better Auth for the invitation and shows the
 * accept page's address, which the invitee opens to accept it. Both pages
 * talk to Better Auth's organization endpoints on the browser's own session.
 */

/** The page an owner or an admin invites people from, and lists and cancels pending invitations on. */
export const WORKSPACE_INVITE_PAGE = {
  PATH: "/invite.html",
  /** The id of the workspace to invite people to. */
  WORKSPACE_PARAM: "workspace",
} as const;

/** The page an invitee accepts an invitation on. */
export const INVITATION_ACCEPT_PAGE = {
  PATH: "/accept-invitation.html",
  /** Better Auth's id of the invitation. */
  ID_PARAM: "id",
} as const;
