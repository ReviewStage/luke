/**
 * pending-invitations.ts -- the invite page's pending invitations, shaped from the organization plugin's listing.
 *
 * The plugin lists every invitation a workspace has made, accepted,
 * canceled, and expired ones among them; the page shows only those still
 * waiting on their invitee. A listing the plugin refused is said to have
 * failed rather than read as a workspace with nothing pending, so the page
 * can keep the list it last had and say the listing could not be loaded.
 */

/** The plugin's status of an invitation still waiting on its invitee. */
const PENDING = "pending";

/** One invitation as the plugin lists it; its expiry arrives as JSON's string over the wire. */
interface ListedInvitation {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly expiresAt: Date | string;
}

/** The plugin's answer to a listing: its invitations, or its refusal. */
type InvitationListing =
  | { readonly data: readonly ListedInvitation[]; readonly error: null }
  | { readonly data: null; readonly error: object };

export interface PendingInvitation {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly expiresAt: Date;
}

export type PendingInvitations =
  | { readonly ok: true; readonly invitations: readonly PendingInvitation[] }
  | { readonly ok: false };

/** The invitations still waiting on their invitee at `now`; an expired one waits on nothing and is left out. */
export function pendingInvitationsFrom(
  listing: InvitationListing,
  now: number,
): PendingInvitations {
  if (listing.error !== null) return { ok: false };
  const invitations = listing.data
    .filter((invitation) => invitation.status === PENDING)
    .map(({ id, email, role, expiresAt }) => ({ id, email, role, expiresAt: new Date(expiresAt) }))
    .filter((invitation) => invitation.expiresAt.getTime() > now);
  return { ok: true, invitations };
}
