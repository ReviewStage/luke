import { HTTP_METHOD } from "@repo/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  macCommandClaimAnswerSchema,
  macCommandClaimRequestSchema,
  macCommandListeningAnswerSchema,
  macCommandSettledAnswerSchema,
  macCommandSettleRequestSchema,
  macCommandsAnswerSchema,
} from "../mac-command-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

const waitingInput = EffectSchema.Struct({ kinds: EffectSchema.optionalKey(EffectSchema.String) });

const listeningInput = EffectSchema.Struct({
  kinds: EffectSchema.optionalKey(EffectSchema.String),
});

const CLAIM_BODY_BYTES = 1_024;

const RESULT_BODY_BYTES = 256 * 1_024;

export const macCommandsContract = {
  waiting: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.MAC_COMMANDS }))
    .input(waitingInput)
    .output(EffectSchema.flip(macCommandsAnswerSchema)),
  settle: hostedProcedure
    .meta(bodyCap(RESULT_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MAC_COMMANDS }))
    .input(exactInput(macCommandSettleRequestSchema))
    .output(EffectSchema.flip(macCommandSettledAnswerSchema)),
  claim: hostedProcedure
    .meta(bodyCap(CLAIM_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MAC_COMMAND_CLAIM }))
    .input(exactInput(macCommandClaimRequestSchema))
    .output(EffectSchema.flip(macCommandClaimAnswerSchema)),
  listening: hostedProcedure
    .meta(bodyCap(CLAIM_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MAC_COMMANDS_LISTENING }))
    .input(exactInput(listeningInput))
    .output(EffectSchema.flip(macCommandListeningAnswerSchema)),
};
