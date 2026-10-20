/**
 * workspaces.ts -- the account's workspaces (`workspace-wire.ts`): the list, a workspace created, renamed, given a photo, or handed over, and its members read, removed, given a role, or left.
 *
 * Every output is the wire schema flipped, so oRPC's output check encodes
 * the handler's value into the bytes the wire carries
 * (`packages/service/src/orpc/base.ts`); every JSON body is read whole
 * (`exactInput`), and the members read names its workspace in the query.
 * A workspace's photo, served as its bytes, stays on its own route.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { workspaceIdSchema } from "../task-wire.js";
import {
  WORKSPACE_MEMBERS_QUERY,
  workspaceAnswerSchema,
  workspaceCreateRequestSchema,
  workspaceLeaveAnswerSchema,
  workspaceLeaveRequestSchema,
  workspaceMemberRemovalSchema,
  workspaceMemberRoleSchema,
  workspaceMembersAnswerSchema,
  workspacePhotoSetRequestSchema,
  workspaceRenameRequestSchema,
  workspacesAnswerSchema,
  workspaceTransferSchema,
} from "../workspace-wire.js";
import { exactInput, hostedProcedure } from "./base.js";

/** The status a workspace created is answered with. */
const CREATED_STATUS = 201;

/** The members read's query: the one workspace it names. */
const workspaceMembersQuerySchema = EffectSchema.Struct({
  [WORKSPACE_MEMBERS_QUERY.WORKSPACE_ID]: workspaceIdSchema,
});

export const workspacesContract = {
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACES }))
    .output(EffectSchema.flip(workspacesAnswerSchema)),
  create: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACES,
        successStatus: CREATED_STATUS,
      }),
    )
    .input(exactInput(workspaceCreateRequestSchema))
    .output(EffectSchema.flip(workspaceAnswerSchema)),
  rename: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_RENAME }))
    .input(exactInput(workspaceRenameRequestSchema))
    .output(EffectSchema.flip(workspaceAnswerSchema)),
  setPhoto: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_PHOTO_SET }))
    .input(exactInput(workspacePhotoSetRequestSchema))
    .output(EffectSchema.flip(workspaceAnswerSchema)),
  members: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS }))
    .input(workspaceMembersQuerySchema)
    .output(EffectSchema.flip(workspaceMembersAnswerSchema)),
  removeMember: hostedProcedure
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS_REMOVE }),
    )
    .input(exactInput(workspaceMemberRemovalSchema))
    .output(EffectSchema.flip(workspaceMembersAnswerSchema)),
  changeRole: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS_ROLE }))
    .input(exactInput(workspaceMemberRoleSchema))
    .output(EffectSchema.flip(workspaceMembersAnswerSchema)),
  transfer: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_TRANSFER }))
    .input(exactInput(workspaceTransferSchema))
    .output(EffectSchema.flip(workspaceMembersAnswerSchema)),
  leave: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_LEAVE }))
    .input(exactInput(workspaceLeaveRequestSchema))
    .output(EffectSchema.flip(workspaceLeaveAnswerSchema)),
};
