import { ACT } from "@repo/sync";
import { Schema as EffectSchema } from "effect";
import { macCommandAnswerSchema } from "../mac-command-ask.js";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";

/**
 * mac-commands.ts -- the developer's answer to a command an agent asked to run on this Mac, declared.
 *
 * The host's Mac commands concern answers it (`compose-mac-commands.ts`):
 * the ask goes from the document as the host hears the answer, so the act
 * answers nothing of its own. Only a panel draws the prompt.
 */

/** The Mac commands' one act, answered by the Mac commands composer. */
export const MAC_COMMAND_ACTS = declaredActs({
  MAC_COMMAND_ANSWER: hostAct({
    input: macCommandAnswerSchema,
    output: EffectSchema.Void,
    refusal: "Could not answer for that command on this Mac.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
  }),
});

export const macCommandActsContract = contractOf(MAC_COMMAND_ACTS);
