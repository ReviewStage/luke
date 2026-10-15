import { Database } from "@luke/database/core/query";
import { WORKSPACE_NAME } from "@luke/database/models/workspace-store";
import { invitation, member, organization, user } from "@luke/database/schemas/auth";
import {
  INVITATION_OFFER_REFUSAL,
  INVITATION_ROLE,
  type InvitationOfferAnswer,
  type WorkspaceInvitation,
} from "@luke/features/workspace-invitation-wire";
import { and, eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";

/**
 * invitation-offers.ts -- one invitation as its recipient is offered it on the accept page, read off the organization plugin's own rows.
 *
 * An invitation is the workspace's, not its inviter's, so it stays good
 * after whoever made it left: this read makes the plugin's own checks on it
 * (still pending, not expired, made for the reading account's address, and
 * that address verified, as `requireEmailVerificationOnInvitation` asks)
 * and leaves out the one the plugin's `getInvitation` adds, that the inviter
 * is still a member, which would turn a teammate's leaving into a dead link.
 * The inviter is named only while they are still a member; the plugin's
 * `acceptInvitation`, which the page calls next, asks nothing of the inviter.
 * The workspace is named as its members read it (`WORKSPACE_NAME`), an
 * account's first workspace by its owner's name as it stands now.
 */

/** The plugin's status for an invitation still waiting on its recipient. */
const PENDING = "pending";

const findInvitation = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({
    id: Schema.String,
    email: Schema.String,
    role: Schema.NullOr(Schema.String),
    status: Schema.String,
    expiresAt: Schema.Date,
    organizationId: Schema.String,
    inviterId: Schema.String,
    workspaceName: Schema.String,
  }),
  execute: (id) =>
    Database.use((db) =>
      db
        .select({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          organizationId: invitation.organizationId,
          inviterId: invitation.inviterId,
          workspaceName: WORKSPACE_NAME,
        })
        .from(invitation)
        .innerJoin(organization, eq(organization.id, invitation.organizationId))
        .where(eq(invitation.id, id))
        .limit(1),
    ),
});

const findAddress = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ email: Schema.String, emailVerified: Schema.Boolean }),
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({ email: user.email, emailVerified: user.emailVerified })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1),
    ),
});

const findMemberInviter = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: Schema.Struct({ name: Schema.String, email: Schema.String }),
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select({ name: user.name, email: user.email })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
        .limit(1),
    ),
});

/** The role an invitation's row holds, as the offer says it; the plugin writes none for a member. */
function roleOfRow(role: string | null): WorkspaceInvitation["role"] {
  return role === INVITATION_ROLE.ADMIN ? INVITATION_ROLE.ADMIN : INVITATION_ROLE.MEMBER;
}

/**
 * The invitation `id` as `userId` is offered it at `now`: the offer, naming
 * the inviter while they are a member, or why there is none, an invitation
 * that is unknown, used, canceled, or expired said alike as spent.
 */
export const invitationOffer = Effect.fn("web/invitationOffer")(function* (
  userId: string,
  id: string,
  now: number,
) {
  const found = yield* findInvitation(id);
  if (
    Option.isNone(found) ||
    found.value.status !== PENDING ||
    found.value.expiresAt.getTime() <= now
  ) {
    return { refused: INVITATION_OFFER_REFUSAL.SPENT } satisfies InvitationOfferAnswer;
  }
  const offered = found.value;
  const address = yield* findAddress(userId);
  if (Option.isNone(address) || address.value.email.toLowerCase() !== offered.email.toLowerCase()) {
    return { refused: INVITATION_OFFER_REFUSAL.NOT_RECIPIENT } satisfies InvitationOfferAnswer;
  }
  if (!address.value.emailVerified) {
    return { refused: INVITATION_OFFER_REFUSAL.UNVERIFIED } satisfies InvitationOfferAnswer;
  }
  const inviter = yield* findMemberInviter({
    userId: offered.inviterId,
    organizationId: offered.organizationId,
  });
  const offer = {
    id: offered.id,
    workspaceName: offered.workspaceName,
    role: roleOfRow(offered.role),
  };
  const answer: InvitationOfferAnswer = {
    offer: Option.isNone(inviter) ? offer : { ...offer, inviter: inviter.value },
  };
  return answer;
});
