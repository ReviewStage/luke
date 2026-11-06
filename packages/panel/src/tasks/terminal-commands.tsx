import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { remedyLabel } from "@repo/features/failure-remedy";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  TERMINAL_ASK,
  TERMINAL_TARGET,
  type TerminalAsk,
  terminalTarget,
} from "@repo/features/terminal-entry";
import { shellsAsked } from "@repo/features/terminal-store";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { STATUS_TONE } from "@repo/ui";
import { useCallback, useContext, useEffect, useState } from "react";
import { useAppCommand } from "../app-commands.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { useRepositoryRemedy } from "./repository-remedy.js";
import { TerminalPicker } from "./terminal-picker.js";
import type { AgentsControl } from "./use-agents.js";
import type { SidePanelControl } from "./use-side-panel.js";

export function useOpenTerminal(
  sidePanel: Pick<SidePanelControl, "onChoose">,
  onShown: () => void,
): (agentId: string, ask: TerminalAsk) => void {
  const registry = useContext(RegistryContext);
  return useCallback(
    (agentId, ask) => {
      if (ask === TERMINAL_ASK.NEW) registry.update(shellsAsked(agentId), (asked) => asked + 1);
      sidePanel.onChoose({ terminal: agentId });
      onShown();
    },
    [registry, sidePanel.onChoose, onShown],
  );
}

export function TerminalCommands({
  here,
  agents,
  sidePanel,
  onShown,
}: {
  here: string | undefined;
  agents: AgentsControl;
  sidePanel: Pick<SidePanelControl, "onChoose" | "lastTerminal">;
  onShown: () => void;
}): React.JSX.Element {
  const toast = useToast();
  const repositoryRemedy = useRepositoryRemedy();
  const [asking, setAsking] = useState<TerminalAsk | undefined>(undefined);
  const open = useOpenTerminal(sidePanel, onShown);
  const target = () =>
    terminalTarget({
      here,
      agents: (agents.agents ?? []).map((agent) => agent.id),
      lastUsed: sidePanel.lastTerminal,
    });
  const run = (ask: TerminalAsk) => {
    const landed = target();
    if (landed.kind === TERMINAL_TARGET.AGENT) return open(landed.agentId, ask);
    setAsking(ask);
  };
  const waiting = asking !== undefined && agents.agents !== undefined && agents.agents.length > 0;
  useEffect(() => {
    if (!waiting || asking === undefined) return;
    setAsking(undefined);
    const landed = target();
    if (landed.kind === TERMINAL_TARGET.AGENT) open(landed.agentId, asking);
  });
  useAppCommand(APP_COMMAND.SHOW_TERMINAL, () => run(TERMINAL_ASK.SHOW));
  useAppCommand(APP_COMMAND.NEW_TERMINAL, () => run(TERMINAL_ASK.NEW));
  const startAgent = () => {
    void agents.start.onPress().then((failure) => {
      if (failure === undefined) return;
      const label = remedyLabel(failure);
      const remedy = repositoryRemedy(failure, startAgent);
      const shown = {
        surface: FAILURE_SURFACE.AGENT_START,
        cause: failure.cause ?? { failure: failure.reason },
        about: { taskId: "taskId" in failure ? failure.taskId : undefined },
      };
      toast(
        label === undefined || remedy === undefined
          ? {
              words: failure.text,
              tone: STATUS_TONE.DANGER,
              hold: TOAST_HOLD.FAILED,
              failure: shown,
            }
          : {
              words: failure.text,
              tone: STATUS_TONE.DANGER,
              action: { label, onPress: remedy },
              failure: shown,
            },
      );
    });
  };
  return (
    <TerminalPicker
      open={asking !== undefined && !waiting}
      agents={agents}
      onStartAgent={startAgent}
      start={agents.start}
      onClose={() => setAsking(undefined)}
    />
  );
}
