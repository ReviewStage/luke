/**
 * mac-commands.ts -- the commands an account's agents queued for its Mac (`mac-command-wire.ts`): the held read that takes them, and each result posted back.
 *
 * Both procedures share the one public path, told apart by method. The
 * outputs are the wire schemas flipped, so oRPC's output check encodes the
 * handler's value into the bytes the wire carries (`packages/service/src/orpc/base.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  macCommandSettledAnswerSchema,
  macCommandSettleRequestSchema,
  macCommandsAnswerSchema,
} from "../mac-command-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

/** Two outputs at their bound, and room for the rest of the body. */
const RESULT_BODY_BYTES = 256 * 1_024;

export const macCommandsContract = {
  waiting: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.MAC_COMMANDS }))
    .output(EffectSchema.flip(macCommandsAnswerSchema)),
  settle: hostedProcedure
    .meta(bodyCap(RESULT_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MAC_COMMANDS }))
    .input(exactInput(macCommandSettleRequestSchema))
    .output(EffectSchema.flip(macCommandSettledAnswerSchema)),
};
