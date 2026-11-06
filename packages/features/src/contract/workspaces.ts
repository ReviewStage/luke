/**
 * workspaces.ts -- the account's workspaces (`workspace-wire.ts`): the list, a workspace created, renamed, given a photo, or handed over, and its members read, removed, given a role, or left.
 *
 * Every output is the wire schema flipped, so oRPC's output check encodes
 * the handler's value into the bytes the wire carries
 * (`packages/service/src/orpc/base.ts`); every JSON body is read whole
 * (`exactInput`), and the members read names its workspace in the query.
 * A workspace's photo, served as its bytes, stays on its own route.
 *
 * Each declares the refusals its handler answers beyond any procedure's
 * (`packages/service/src/accounts/workspaces-procedures.ts`): a workspace
 * the caller is not in (`not-found`), a role that does not allow the write
 * (`not-permitted`), and a slug the service will not give
 * (`workspace-slug-*`). The plugin's already-invited refusal is declared on
 * the invite alone, the one call that answers it.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
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
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** A workspace's name or id is a few dozen characters, so a body past this is not one. */
const BODY_BYTES = 1_024;

/**
 * A photo's body: its bytes at their bound spelled in base64, four
 * characters to every three bytes, and a name's body beside them for the
 * URL's prefix and the workspace's id. Note that a photo just past the
 * bound still fits, because its refusal is the invalid one the schema says.
 */
const PHOTO_BODY_BYTES = Math.ceil(WORKSPACE_PHOTO_BOUNDS.MAX_BYTES / 3) * 4 + BODY_BYTES;

/** The status a workspace created is answered with. */
const CREATED_STATUS = 201;

/** The members read's query: the one workspace it names. */
const workspaceMembersQuerySchema = EffectSchema.Struct({
  [WORKSPACE_MEMBERS_QUERY.WORKSPACE_ID]: workspaceIdSchema,
});

export const workspacesContract = {
  list: declaredProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACES }))
    .output(EffectSchema.flip(workspacesAnswerSchema)),
  create: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
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
  rename: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_RENAME }))
    .input(exactInput(workspaceRenameRequestSchema))
    .output(EffectSchema.flip(workspaceAnswerSchema)),
  setSlug: declaredProcedure
    .errors(
      refuses(
        HOSTED_API_ERROR.NOT_FOUND,
        HOSTED_API_ERROR.NOT_PERMITTED,
        HOSTED_API_ERROR.WORKSPACE_SLUG_MALFORMED,
        HOSTED_API_ERROR.WORKSPACE_SLUG_RESERVED,
        HOSTED_API_ERROR.WORKSPACE_SLUG_TAKEN,
      ),
    )
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_SLUG_SET }))
    .input(exactInput(workspaceSlugSetRequestSchema))
    .output(EffectSchema.flip(workspaceAnswerSchema)),
  setPhoto: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(PHOTO_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_PHOTO_SET }))
    .input(exactInput(workspacePhotoSetRequestSchema))
    .output(EffectSchema.flip(workspaceAnswerSchema)),
  members: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS }))
    .input(workspaceMembersQuerySchema)
    .output(EffectSchema.flip(workspaceMembersAnswerSchema)),
  removeMember: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS_REMOVE }),
    )
    .input(exactInput(workspaceMemberRemovalSchema))
    .output(EffectSchema.flip(workspaceMembersAnswerSchema)),
  changeRole: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS_ROLE }))
    .input(exactInput(workspaceMemberRoleSchema))
    .output(EffectSchema.flip(workspaceMembersAnswerSchema)),
  transfer: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_TRANSFER }))
    .input(exactInput(workspaceTransferSchema))
    .output(EffectSchema.flip(workspaceMembersAnswerSchema)),
  leave: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACES_LEAVE }))
    .input(exactInput(workspaceLeaveRequestSchema))
    .output(EffectSchema.flip(workspaceLeaveAnswerSchema)),
};
