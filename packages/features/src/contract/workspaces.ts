import { HTTP_METHOD } from "@repo/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { workspaceIdSchema } from "../task-wire.js";
import {
  WORKSPACE_MEMBERS_QUERY,
  WORKSPACE_PHOTO_BOUNDS,
  workspaceAnswerSchema,
  workspaceCreateRequestSchema,
  workspaceLeaveAnswerSchema,
  workspaceLeaveRequestSchema,
  workspaceMemberRemovalSchema,
  workspaceMemberRoleSchema,
  workspaceMembersAnswerSchema,
  workspacePhotoSetRequestSchema,
  workspaceRenameRequestSchema,
  workspaceSlugSetRequestSchema,
  workspacesAnswerSchema,
  workspaceTransferSchema,
} from "../workspace-wire.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

const BODY_BYTES = 1_024;

const PHOTO_BODY_BYTES = Math.ceil(WORKSPACE_PHOTO_BOUNDS.MAX_BYTES / 3) * 4 + BODY_BYTES;

const CREATED_STATUS = 201;

const workspaceMembersQuerySchema = EffectSchema.Struct({
  [WORKSPACE_MEMBERS_QUERY.WORKSPACE_ID]: workspaceIdSchema,
});

export const workspacesContract = {
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACES }))
    .output(EffectSchema.flip(workspacesAnswerSchema)),
  create: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
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
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_RENAME }))
    .input(exactInput(workspaceRenameRequestSchema))
    .output(EffectSchema.flip(workspaceAnswerSchema)),
  setSlug: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_SLUG_SET }))
    .input(exactInput(workspaceSlugSetRequestSchema))
    .output(EffectSchema.flip(workspaceAnswerSchema)),
  setPhoto: hostedProcedure
    .meta(bodyCap(PHOTO_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_PHOTO_SET }))
    .input(exactInput(workspacePhotoSetRequestSchema))
    .output(EffectSchema.flip(workspaceAnswerSchema)),
  members: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS }))
    .input(workspaceMembersQuerySchema)
    .output(EffectSchema.flip(workspaceMembersAnswerSchema)),
  removeMember: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS_REMOVE }),
    )
    .input(exactInput(workspaceMemberRemovalSchema))
    .output(EffectSchema.flip(workspaceMembersAnswerSchema)),
  changeRole: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS_ROLE }))
    .input(exactInput(workspaceMemberRoleSchema))
    .output(EffectSchema.flip(workspaceMembersAnswerSchema)),
  transfer: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_TRANSFER }))
    .input(exactInput(workspaceTransferSchema))
    .output(EffectSchema.flip(workspaceMembersAnswerSchema)),
  leave: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_LEAVE }))
    .input(exactInput(workspaceLeaveRequestSchema))
    .output(EffectSchema.flip(workspaceLeaveAnswerSchema)),
};
