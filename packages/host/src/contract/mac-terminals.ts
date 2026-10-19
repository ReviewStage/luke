import {
  macRepositoriesAnswerSchema,
  macRepositorySchema,
  macTerminalKeySchema,
  macTerminalOpenParamsSchema,
} from "@luke/features/mac-terminal-wire";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { MAC_TERMINAL_ACT_KIND } from "./kinds.js";

/**
 * mac-terminals.ts -- a coding agent's branch run on this Mac: the run commands read and set, a run started, stopped, and closed, and its worktree opened in Terminal, as procedures.
 *
 * Main answers them itself (`apps/desktop/src/main/ipc/mac-terminal-acts.ts`).
 * What a run prints, and the terminal's size, travel on the port an open
 * posts to the asking panel, never on these.
 */
/** The refusal of a read of the run commands, which an open that could not read them answers too. */
export const MAC_REPOSITORIES_REFUSAL = "Could not read the run commands set on this Mac.";

export const macTerminalActsContract = {
  [MAC_TERMINAL_ACT_KIND.MAC_REPOSITORIES]: actProcedure(MAC_REPOSITORIES_REFUSAL)
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.flip(macRepositoriesAnswerSchema)),
  [MAC_TERMINAL_ACT_KIND.MAC_REPOSITORY_SET]: actProcedure(
    "Could not save the repository's run command on this Mac.",
  )
    .input(exactInput(macRepositorySchema))
    .output(EffectSchema.Void),
  [MAC_TERMINAL_ACT_KIND.MAC_TERMINAL_OPEN]: actProcedure("Could not open a terminal on this Mac.")
    .input(exactInput(macTerminalOpenParamsSchema))
    .output(EffectSchema.Void),
  [MAC_TERMINAL_ACT_KIND.MAC_TERMINAL_CLOSE]: actProcedure("Could not close the terminal.")
    .input(exactInput(macTerminalKeySchema))
    .output(EffectSchema.Void),
  [MAC_TERMINAL_ACT_KIND.MAC_TERMINAL_STOP]: actProcedure("Could not stop the run.")
    .input(exactInput(macTerminalKeySchema))
    .output(EffectSchema.Void),
  [MAC_TERMINAL_ACT_KIND.MAC_TERMINAL_REVEAL]: actProcedure(
    "Could not open Terminal on this branch. Press Run first.",
  )
    .input(exactInput(macTerminalKeySchema))
    .output(EffectSchema.Void),
};
