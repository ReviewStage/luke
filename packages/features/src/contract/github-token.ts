/**
 * github-token.ts -- the member's own classic GitHub personal access token (`github-token-wire.ts`): read what it is, save one, remove it.
 *
 * The one path answers all three by its method. The save's body is read
 * exactly, a key it does not name refused, as the old group's `readEither`
 * refused one; the read and the removal take nothing. Every output is the
 * token as it then stands, its wire schema flipped
 * (`packages/service/src/orpc/base.ts`), and none carries the token.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { githubTokenAnswerSchema, githubTokenSaveRequestSchema } from "../github-token-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

/** A save is one token bounded at 255 characters, so a body past this is not one. */
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
