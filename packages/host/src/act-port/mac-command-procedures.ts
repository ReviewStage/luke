import { Effect } from "effect";
import { MAC_COMMAND_ACT_KIND } from "../contract/index.js";
import type { HostOperator } from "../host-operator.js";
import { type ActSender, actPort } from "./base.js";

export interface MacCommandProceduresDependencies {
  host: Pick<HostOperator, "answerMacCommand">;
}

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
