/**
 * mac-commands.ts -- the commands an account's agents queued for its Mac (`mac-command-wire.ts`): the held read that takes them, and each result posted back.
 *
 * Both procedures share the one public path, told apart by method. The
 * held read names the kinds its Mac runs beyond `shell` in its `kinds`
 * query, as text (`macCommandKindsQuery`); an older Mac's read names none,
 * which is `shell` alone. A Mac that follows its commands live
 * (`contract/live.ts`) claims each it hears of by its id, and says it
 * listens, naming its kinds as the held read does. A result or a claim
 * for a command the account does not hold, claimed or waiting, is refused
 * as not found; the read and the presence refuse only as any procedure
 * may. The outputs are the wire schemas flipped, so oRPC's output check encodes the
 * handler's value into the bytes the wire carries (`packages/service/src/orpc/base.ts`).
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
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
import { HOSTED_API_ERROR } from "../service-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** The held read's input: the kinds its Mac runs, where it names any, as the query spells them. */
const waitingInput = EffectSchema.Struct({ kinds: EffectSchema.optionalKey(EffectSchema.String) });

/** A presence's input: the kinds its Mac runs, as the held read names them. */
const listeningInput = EffectSchema.Struct({
  kinds: EffectSchema.optionalKey(EffectSchema.String),
});

/** A claim's body: one id, and room to spare. */
const CLAIM_BODY_BYTES = 1_024;

/** Two outputs at their bound, and room for the rest of the body. */
const RESULT_BODY_BYTES = 256 * 1_024;

export const macCommandsContract = {
  waiting: declaredProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.MAC_COMMANDS }))
    .input(waitingInput)
    .output(EffectSchema.flip(macCommandsAnswerSchema)),
  settle: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(bodyCap(RESULT_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MAC_COMMANDS }))
    .input(exactInput(macCommandSettleRequestSchema))
    .output(EffectSchema.flip(macCommandSettledAnswerSchema)),
  claim: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(bodyCap(CLAIM_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MAC_COMMAND_CLAIM }))
    .input(exactInput(macCommandClaimRequestSchema))
    .output(EffectSchema.flip(macCommandClaimAnswerSchema)),
  listening: declaredProcedure
    .meta(bodyCap(CLAIM_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MAC_COMMANDS_LISTENING }))
    .input(exactInput(listeningInput))
    .output(EffectSchema.flip(macCommandListeningAnswerSchema)),
};
