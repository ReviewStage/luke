import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { MAC_TERMINAL_ACT_KIND } from "./kinds.js";

/**
 * mac-terminals.ts -- a local agent's worktree opened in the Mac's own Terminal, as a procedure.
 *
 * Main answers it itself (`apps/desktop/src/main/ipc/mac-terminal-acts.ts`).
 */

/** The agent whose worktree is opened, by its id. */
const macTerminalKeySchema = EffectSchema.Struct({
  agentId: EffectSchema.String.check(EffectSchema.isPattern(/^[0-9a-f-]{36}$/u)),
});

export const macTerminalActsContract = {
  [MAC_TERMINAL_ACT_KIND.MAC_TERMINAL_LOCAL_AGENT]: actProcedure(
    "Could not open Terminal in this agent's worktree. It is made when the agent first runs on this Mac.",
  )
    .input(exactInput(macTerminalKeySchema))
    .output(EffectSchema.Void),
};
