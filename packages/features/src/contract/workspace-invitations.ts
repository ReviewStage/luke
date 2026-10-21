/**
 * workspace-invitations.ts -- a workspace's invitations as an owner or an admin lists, makes, and cancels them, and one as its recipient is offered it (`workspace-invitation-wire.ts`).
 *
 * The list and the make share one path, told apart by their method, as the
 * old route did. The two reads take their query as their input.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { workspaceIdSchema } from "../task-wire.js";
import {
  invitationOfferAnswerSchema,
  invitationOfferQuerySchema,
  WORKSPACE_INVITATIONS_QUERY,
  workspaceInvitationAnswerSchema,
  workspaceInvitationCancelSchema,
  workspaceInvitationsAnswerSchema,
  workspaceInviteRequestSchema,
} from "../workspace-invitation-wire.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

/** A workspace's id, an address, and a role are a few dozen characters, so a body past this is not one. */
const BODY_BYTES = 1_024;

/** The invitations read's query: the one workspace whose invitations are asked for. */
const invitationsQuerySchema = EffectSchema.Struct({
  [WORKSPACE_INVITATIONS_QUERY.WORKSPACE_ID]: workspaceIdSchema,
});

export const workspaceInvitationsContract = {
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS }))
    .input(invitationsQuerySchema)
    .output(EffectSchema.flip(workspaceInvitationsAnswerSchema)),
  invite: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS,
        successStatus: 201,
      }),
    )
    .input(exactInput(workspaceInviteRequestSchema))
    .output(EffectSchema.flip(workspaceInvitationAnswerSchema)),
  cancel: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS_CANCEL,
      }),
    )
    .input(exactInput(workspaceInvitationCancelSchema))
    .output(EffectSchema.flip(workspaceInvitationsAnswerSchema)),
  offer: hostedProcedure
    .meta(
      openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACES_INVITATION_OFFER }),
    )
    .input(invitationOfferQuerySchema)
    .output(EffectSchema.flip(invitationOfferAnswerSchema)),
};
