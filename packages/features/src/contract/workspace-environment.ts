/**
 * workspace-environment.ts -- a workspace's environment variables and secrets read, one saved, and one removed (`workspace-environment-wire.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import {
  WORKSPACE_ENVIRONMENT_BOUNDS,
  workspaceEnvironmentAnswerSchema,
  workspaceEnvironmentListRequestSchema,
  workspaceEnvironmentRemoveRequestSchema,
  workspaceEnvironmentSaveRequestSchema,
} from "../workspace-environment-wire.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

/** The most a request body may hold: a workspace id, a name, and a value at its bound, each character up to four bytes. */
const BODY_BYTES = 4 * WORKSPACE_ENVIRONMENT_BOUNDS.MAX_VALUE_CHARS + 1_024;

export const workspaceEnvironmentContract = {
  list: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_ENVIRONMENT }))
    .input(exactInput(workspaceEnvironmentListRequestSchema))
    .output(EffectSchema.flip(workspaceEnvironmentAnswerSchema)),
  save: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_ENVIRONMENT_SAVE }),
    )
    .input(exactInput(workspaceEnvironmentSaveRequestSchema))
    .output(EffectSchema.flip(workspaceEnvironmentAnswerSchema)),
  remove: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_ENVIRONMENT_REMOVE }),
    )
    .input(exactInput(workspaceEnvironmentRemoveRequestSchema))
    .output(EffectSchema.flip(workspaceEnvironmentAnswerSchema)),
};
