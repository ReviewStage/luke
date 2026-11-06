import { HTTP_METHOD } from "@repo/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import {
  workspaceAnswerSchema,
  workspaceGithubConnectAnswerSchema,
  workspaceGithubRequestSchema,
} from "../workspace-wire.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

const BODY_BYTES = 1_024;

export const workspaceGithubContract = {
  connect: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_GITHUB_CONNECT }))
    .input(exactInput(workspaceGithubRequestSchema))
    .output(EffectSchema.flip(workspaceGithubConnectAnswerSchema)),
  disconnect: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_GITHUB_DISCONNECT }),
    )
    .input(EffectSchema.Unknown)
    .output(EffectSchema.flip(workspaceAnswerSchema)),
};
