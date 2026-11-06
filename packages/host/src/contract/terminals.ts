import {
  terminalAgentParamsSchema,
  terminalAttachParamsSchema,
  terminalCreatedActAnswerSchema,
  terminalCreateParamsSchema,
  terminalRenameParamsSchema,
  terminalResumedActAnswerSchema,
  terminalShellParamsSchema,
  terminalsActAnswerSchema,
} from "@repo/features/terminal-acts";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { TERMINAL_ACT_KIND } from "./kinds.js";

export const terminalActsContract = {
  [TERMINAL_ACT_KIND.TERMINAL_LIST]: actProcedure("Could not reach this agent's sandbox.")
    .input(exactInput(terminalAgentParamsSchema))
    .output(EffectSchema.flip(terminalsActAnswerSchema)),
  [TERMINAL_ACT_KIND.TERMINAL_CREATE]: actProcedure(
    "Could not start a shell in this agent's sandbox.",
  )
    .input(exactInput(terminalCreateParamsSchema))
    .output(EffectSchema.flip(terminalCreatedActAnswerSchema)),
  [TERMINAL_ACT_KIND.TERMINAL_RENAME]: actProcedure("Could not rename that shell.")
    .input(exactInput(terminalRenameParamsSchema))
    .output(EffectSchema.flip(terminalsActAnswerSchema)),
  [TERMINAL_ACT_KIND.TERMINAL_KILL]: actProcedure("Could not end that shell.")
    .input(exactInput(terminalShellParamsSchema))
    .output(EffectSchema.flip(terminalsActAnswerSchema)),
  [TERMINAL_ACT_KIND.TERMINAL_RESUME]: actProcedure("Could not resume this agent's sandbox.")
    .input(exactInput(terminalAgentParamsSchema))
    .output(EffectSchema.flip(terminalResumedActAnswerSchema)),
  [TERMINAL_ACT_KIND.TERMINAL_ATTACH]: actProcedure("Could not open that shell.")
    .input(exactInput(terminalAttachParamsSchema))
    .output(EffectSchema.Void),
  [TERMINAL_ACT_KIND.TERMINAL_DETACH]: actProcedure("Could not close that shell.")
    .input(exactInput(terminalShellParamsSchema))
    .output(EffectSchema.Void),
};
