/**
 * mac-commands.ts -- the commands an account's agents queued for its Mac (`mac-command-wire.ts`): the held read that takes them, and each result posted back.
 *
 * Both procedures share the one public path, told apart by method. The
 * held read names the kinds its Mac runs beyond `shell` in its `kinds`
 * query, as text (`macCommandKindsQuery`); an older Mac's read names none,
 * which is `shell` alone. A browser command's result, which may carry an
 * image, is posted to a path of its own under a larger body cap, so the
 * shell result's cap stays as it was. A Mac that follows its commands live
 * (`contract/live.ts`) claims each it hears of by its id, and says it
 * listens, naming its kinds as the held read does. The outputs are the wire schemas flipped, so oRPC's output check encodes the
 * handler's value into the bytes the wire carries (`packages/service/src/orpc/base.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  MAC_COMMAND_BOUNDS,
  MAC_COMMAND_MAX_IMAGE_BASE64_CHARS,
  macBrowserSettleRequestSchema,
  macCommandClaimAnswerSchema,
  macCommandClaimRequestSchema,
  macCommandListeningAnswerSchema,
  macCommandSettledAnswerSchema,
  macCommandSettleRequestSchema,
  macCommandsAnswerSchema,
} from "../mac-command-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

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

/**
 * A browser result's image at its bound in base64, its output at its bound
 * in UTF-8 at most, and room for the rest: well under the hosted ceiling
 * (`HOSTED_BODY_CEILING_BYTES`, 4.5 MB).
 */
const BROWSER_RESULT_BODY_BYTES =
  MAC_COMMAND_MAX_IMAGE_BASE64_CHARS + MAC_COMMAND_BOUNDS.MAX_BROWSER_OUTPUT_CHARS * 3 + 64 * 1_024;

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
  settleBrowser: hostedProcedure
    .meta(bodyCap(BROWSER_RESULT_BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MAC_COMMAND_BROWSER_RESULTS }),
    )
    .input(exactInput(macBrowserSettleRequestSchema))
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
