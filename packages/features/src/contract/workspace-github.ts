/**
 * workspace-github.ts -- a workspace's GitHub connected or disconnected by an owner or an admin of it (`workspace-wire.ts`).
 *
 * Disconnect takes any input, because it is refused to every signed-in
 * caller whatever its body says, as it always was; a Mac still sends the
 * workspace's id in it.
 *
 * Connect refuses a workspace the caller is not in and a role that does not
 * allow it; disconnect refuses every caller as not permitted
 * (`packages/service/src/accounts/workspace-github-procedures.ts`).
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import {
  workspaceAnswerSchema,
  workspaceGithubConnectAnswerSchema,
  workspaceGithubRequestSchema,
} from "../workspace-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** A workspace's id is a few dozen characters, so a body past this is not one. */
const BODY_BYTES = 1_024;

export const workspaceGithubContract = {
  connect: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_GITHUB_CONNECT }))
    .input(exactInput(workspaceGithubRequestSchema))
    .output(EffectSchema.flip(workspaceGithubConnectAnswerSchema)),
  disconnect: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_GITHUB_DISCONNECT }),
    )
    .input(EffectSchema.Unknown)
    .output(EffectSchema.flip(workspaceAnswerSchema)),
};
