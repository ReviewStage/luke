import { Schema as EffectSchema } from "effect";
import { macCommandAnswerSchema } from "../mac-command-ask.js";
import { actProcedure, exactInput } from "./base.js";
import { MAC_COMMAND_ACT_KIND } from "./kinds.js";

export const macCommandActsContract = {
  [MAC_COMMAND_ACT_KIND.MAC_COMMAND_ANSWER]: actProcedure(
    "Could not answer for that command on this Mac.",
  )
    .input(exactInput(macCommandAnswerSchema))
    .output(EffectSchema.Void),
};
