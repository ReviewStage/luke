/**
 * github-token.ts -- the member's own classic GitHub personal access token (`github-token-wire.ts`): read what it is, save one, remove it.
 *
 * The one path answers all three by its method. The save's body is read
 * exactly, a key it does not name refused, as the old group's `readEither`
 * refused one; the read and the removal take nothing. Every output is the
 * token as it then stands, its wire schema flipped
 * (`packages/service/src/orpc/base.ts`), and none carries the token.
 *
 * None refuses beyond what any procedure may (`ANY_PROCEDURE_REFUSALS`): a
 * bearer not taken, a deployment without a key ring, and a store that could
 * not answer; a token GitHub refused is an answer that says why.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { githubTokenAnswerSchema, githubTokenSaveRequestSchema } from "../github-token-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, declaredProcedure, exactInput } from "./base.js";

/** A save is one token bounded at 255 characters, so a body past this is not one. */
const SAVE_BODY_BYTES = 1_024;

export const githubTokenContract = {
  read: declaredProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.GITHUB_TOKEN }))
    .output(EffectSchema.flip(githubTokenAnswerSchema)),
  save: declaredProcedure
    .meta(bodyCap(SAVE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.GITHUB_TOKEN }))
    .input(exactInput(githubTokenSaveRequestSchema))
    .output(EffectSchema.flip(githubTokenAnswerSchema)),
  remove: declaredProcedure
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: HOSTED_SERVICE_PATH.GITHUB_TOKEN }))
    .output(EffectSchema.flip(githubTokenAnswerSchema)),
};
