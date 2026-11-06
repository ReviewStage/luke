import { HTTP_METHOD } from "@repo/wire";
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

const BODY_BYTES = 1_024;

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
