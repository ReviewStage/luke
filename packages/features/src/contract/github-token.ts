import { HTTP_METHOD } from "@repo/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { githubTokenAnswerSchema, githubTokenSaveRequestSchema } from "../github-token-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

const SAVE_BODY_BYTES = 1_024;

export const githubTokenContract = {
  read: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.GITHUB_TOKEN }))
    .output(EffectSchema.flip(githubTokenAnswerSchema)),
  save: hostedProcedure
    .meta(bodyCap(SAVE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.GITHUB_TOKEN }))
    .input(exactInput(githubTokenSaveRequestSchema))
    .output(EffectSchema.flip(githubTokenAnswerSchema)),
  remove: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: HOSTED_SERVICE_PATH.GITHUB_TOKEN }))
    .output(EffectSchema.flip(githubTokenAnswerSchema)),
};
