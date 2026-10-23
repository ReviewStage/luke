import { Schema as EffectSchema } from "effect";
import { macCommandAnswerSchema } from "../mac-command-ask.js";
import { actProcedure, exactInput } from "./base.js";
import { MAC_COMMAND_ACT_KIND } from "./kinds.js";

/**
 * mac-commands.ts -- the developer's answer to a command an agent asked to run on this Mac, as a procedure.
 *
 * The host answers it (`../act-port/mac-command-procedures.ts`): the ask
 * goes from the document as the host hears the answer, so the procedure
 * answers nothing of its own.
 */
export const macCommandActsContract = {
  [MAC_COMMAND_ACT_KIND.MAC_COMMAND_ANSWER]: actProcedure(
    "Could not answer for that command on this Mac.",
  )
    .input(exactInput(macCommandAnswerSchema))
    .output(EffectSchema.Void),
};
