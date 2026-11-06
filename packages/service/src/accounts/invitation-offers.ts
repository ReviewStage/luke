import { Database } from "@repo/database/core/query";
import { WORKSPACE_NAME } from "@repo/database/models/workspace-store";
import { invitation, member, organization, user } from "@repo/database/schemas/auth";
import {
  INVITATION_OFFER_REFUSAL,
  INVITATION_ROLE,
  type InvitationOfferAnswer,
  type WorkspaceInvitation,
} from "@repo/features/workspace-invitation-wire";
import { and, eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";

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

const findMember = SqlSchema.findOneOption({
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

function roleOfRow(role: string | null): WorkspaceInvitation["role"] {
  return role === INVITATION_ROLE.ADMIN ? INVITATION_ROLE.ADMIN : INVITATION_ROLE.MEMBER;
}

export const invitationOffer = Effect.fn("web/invitationOffer")(function* (
  userId: string,
  id: string,
  now: number,
) {
  const found = yield* findInvitation(id);
  if (Option.isSome(found)) {
    const joined = yield* findMember({
      userId,
      organizationId: found.value.organizationId,
    });
    if (Option.isSome(joined)) {
      return {
        member: { workspaceName: found.value.workspaceName },
      } satisfies InvitationOfferAnswer;
    }
  }
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
  const inviter = yield* findMember({
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
