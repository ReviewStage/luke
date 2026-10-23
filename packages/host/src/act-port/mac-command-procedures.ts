import { Effect } from "effect";
import { MAC_COMMAND_ACT_KIND } from "../contract/index.js";
import type { HostOperator } from "../host-operator.js";
import { type ActSender, actPort } from "./base.js";

/**
 * mac-command-procedures.ts -- the developer's answer to a command an agent asked to run on this Mac, as a client answers it.
 *
 * The answer is carried to the host, which holds the ask and runs or
 * refuses the command by it. Only a panel draws the prompt, so the voice and
 * call windows are refused. An ask no longer waiting, answered already or
 * timed out, is answered all the same, since the prompt goes with it.
 */
export interface MacCommandProceduresDependencies {
  host: Pick<HostOperator, "answerMacCommand">;
}

/** The refusal a window that draws no prompt hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function macCommandProcedures(dependencies: MacCommandProceduresDependencies) {
  const { host } = dependencies;
  return {
    [MAC_COMMAND_ACT_KIND.MAC_COMMAND_ANSWER]: actPort[
      MAC_COMMAND_ACT_KIND.MAC_COMMAND_ANSWER
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.answerMacCommand(input);
    }),
  };
}
