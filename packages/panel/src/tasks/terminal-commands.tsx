import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { remedyLabel } from "@repo/features/failure-remedy";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  TERMINAL_ASK,
  TERMINAL_TARGET,
  type TerminalAsk,
  terminalTarget,
} from "@repo/features/terminal-entry";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { STATUS_TONE } from "@repo/ui";
import { useCallback, useContext, useEffect, useState } from "react";
import { useAppCommand } from "../app-commands.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { useRepositoryRemedy } from "./repository-remedy.js";
import { shellsAsked } from "./terminal-held.js";
import { TerminalPicker } from "./terminal-picker.js";
import type { AgentsControl } from "./use-agents.js";
import type { SidePanelControl } from "./use-side-panel.js";

/**
 * terminal-commands.tsx -- Show terminal (⌘J) and New terminal while a task is drawn: which agent each means by the rules, its Terminal tab shown, and the offer to start an agent on a task with none.
 *
 * Both commands are offers on the window's one keymap (`app-commands.ts`), so
 * the menu bar and ⌘K run them as ⌘J does. Each decides the agent
 * (`terminal-entry.ts`) from where the developer is, never asking, then
 * shows that agent's Terminal tab in the side panel, New terminal asking for
 * a new shell in its mirror first (`terminal-held.ts`'s `shellsAsked`),
 * which the tab opens. A task with no agent offers to start one; one whose
 * agents are still being read waits on them, and lands as the rules have it
 * once they are.
 */

/**
 * Opens an agent's terminal as a command means it: its Terminal tab shown,
 * after a new shell is asked of its mirror where the command was New
 * terminal. The panel's "+" opens its Terminal rows through the same door.
 */
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
  /** The agent whose own tab, Changes tab, or Terminal tab holds the developer, if any. */
  here: string | undefined;
  agents: AgentsControl;
  sidePanel: Pick<SidePanelControl, "onChoose" | "lastTerminal">;
  /** Hands the keyboard to the side panel, where the terminal now stands. */
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
    // A task with no agent offers to start one; one whose agents are not read yet waits on them.
    setAsking(ask);
  };
  // The task's agents read while the command waits on them: it lands on one where there is one.
  const waiting = asking !== undefined && agents.agents !== undefined && agents.agents.length > 0;
  useEffect(() => {
    if (!waiting || asking === undefined) return;
    setAsking(undefined);
    const landed = target();
    if (landed.kind === TERMINAL_TARGET.AGENT) open(landed.agentId, asking);
  });
  useAppCommand(APP_COMMAND.SHOW_TERMINAL, () => run(TERMINAL_ASK.SHOW));
  useAppCommand(APP_COMMAND.NEW_TERMINAL, () => run(TERMINAL_ASK.NEW));
  // A refused start says why on the toast, its repository's remedy as its action where it has one,
  // since the palette that pressed it has closed; a move starts the agent again once it lands.
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
