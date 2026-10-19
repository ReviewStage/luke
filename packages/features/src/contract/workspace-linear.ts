/**
 * workspace-linear.ts -- a workspace's one Linear connection begun and ended, and the issues it reaches read (`workspace-wire.ts`, `linear-wire.ts`).
 *
 * Where Connect returns the browser (`linear/connected`) is a redirect, not
 * a procedure, and stays a route of its own.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { linearIssuesAnswerSchema } from "../linear-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import {
  linearIssuesRequestSchema,
  workspaceAnswerSchema,
  workspaceLinearConnectAnswerSchema,
  workspaceLinearRequestSchema,
} from "../workspace-wire.js";
import { exactInput, hostedProcedure } from "./base.js";

export const workspaceLinearContract = {
  connect: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_CONNECT }))
    .input(exactInput(workspaceLinearRequestSchema))
    .output(EffectSchema.flip(workspaceLinearConnectAnswerSchema)),
  disconnect: hostedProcedure
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_DISCONNECT }),
    )
    .input(exactInput(workspaceLinearRequestSchema))
    .output(EffectSchema.flip(workspaceAnswerSchema)),
  issues: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_ISSUES }))
    .input(exactInput(linearIssuesRequestSchema))
    .output(EffectSchema.flip(linearIssuesAnswerSchema)),
};
