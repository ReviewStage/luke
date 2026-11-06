import { ACT_KIND } from "@repo/host/acts";
import type { MacCommandAsk } from "@repo/host/app-state";
import { MAC_COMMAND_DECISION, type MacCommandDecision } from "@repo/host/contract";
import { CommandAsk } from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { pressMutation } from "./act-mutations.js";
import { appStateQuery, selectMacCommands } from "./use-app-state.js";
import { useHeldThroughExit } from "./use-held-through-exit.js";

function firstAsk(asks: readonly MacCommandAsk[] | undefined): MacCommandAsk | undefined {
  return asks?.[0];
}

export function MacCommandAskDialog(): React.JSX.Element | null {
  const waiting = firstAsk(useQuery({ ...appStateQuery, select: selectMacCommands }).data?.asks);
  const { mutate: answerAsk } = useMutation(pressMutation(ACT_KIND.MAC_COMMAND_ANSWER));
  const { held: ask, onExited } = useHeldThroughExit(waiting);
  if (ask === undefined) return null;
  const answer = (decision: MacCommandDecision) => answerAsk({ id: ask.id, decision });
  return (
    <CommandAsk
      key={ask.id}
      open={waiting !== undefined}
      onExited={onExited}
      command={ask.command}
      onAllowOnce={() => answer(MAC_COMMAND_DECISION.ALLOW_ONCE)}
      onAllowAlways={() => answer(MAC_COMMAND_DECISION.ALLOW_ALWAYS)}
      onDeny={() => answer(MAC_COMMAND_DECISION.DENY)}
    />
  );
}
