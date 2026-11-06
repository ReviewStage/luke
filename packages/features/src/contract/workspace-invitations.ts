/**
 * workspace-invitations.ts -- a workspace's invitations as an owner or an admin lists, makes, and cancels them, and one as its recipient is offered it (`workspace-invitation-wire.ts`).
 *
 * The list and the make share one path, told apart by their method, as the
 * old route did. The two reads take their query as their input.
 *
 * Each declares the refusals its handler answers beyond any procedure's
 * (`packages/service/src/accounts/workspace-invitations-procedures.ts`): a
 * workspace or invitation not found, a role that does not allow it, and,
 * for the invite alone, an address already a member or invited. The offer
 * answers "no offer" as an answer, never a refusal.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
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
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** A workspace's id, an address, and a role are a few dozen characters, so a body past this is not one. */
const BODY_BYTES = 1_024;

/** The invitations read's query: the one workspace whose invitations are asked for. */
const invitationsQuerySchema = EffectSchema.Struct({
  [WORKSPACE_INVITATIONS_QUERY.WORKSPACE_ID]: workspaceIdSchema,
});

export const workspaceInvitationsContract = {
  list: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS }))
    .input(invitationsQuerySchema)
    .output(EffectSchema.flip(workspaceInvitationsAnswerSchema)),
  invite: declaredProcedure
    .errors(
      refuses(
        HOSTED_API_ERROR.NOT_FOUND,
        HOSTED_API_ERROR.NOT_PERMITTED,
        HOSTED_API_ERROR.ALREADY_INVITED,
      ),
    )
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
  cancel: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS_CANCEL,
      }),
    )
    .input(exactInput(workspaceInvitationCancelSchema))
    .output(EffectSchema.flip(workspaceInvitationsAnswerSchema)),
  offer: declaredProcedure
    .meta(
      openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACES_INVITATION_OFFER }),
    )
    .input(invitationOfferQuerySchema)
    .output(EffectSchema.flip(invitationOfferAnswerSchema)),
};
