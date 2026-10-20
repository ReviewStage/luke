/**
 * workspace-github.ts -- a workspace's GitHub connected or disconnected by an owner or an admin of it (`workspace-wire.ts`).
 *
 * Disconnect takes any input, because it is refused to every signed-in
 * caller whatever its body says, as it always was; a Mac still sends the
 * workspace's id in it.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import {
  workspaceAnswerSchema,
  workspaceGithubConnectAnswerSchema,
  workspaceGithubRequestSchema,
} from "../workspace-wire.js";
import { exactInput, hostedProcedure } from "./base.js";

export const workspaceGithubContract = {
  connect: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_GITHUB_CONNECT }))
    .input(exactInput(workspaceGithubRequestSchema))
    .output(EffectSchema.flip(workspaceGithubConnectAnswerSchema)),
  disconnect: hostedProcedure
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_GITHUB_DISCONNECT }),
    )
    .input(EffectSchema.Unknown)
    .output(EffectSchema.flip(workspaceAnswerSchema)),
};
