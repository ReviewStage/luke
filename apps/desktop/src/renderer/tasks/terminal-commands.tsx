import { RegistryContext } from "@effect/atom-react/RegistryContext";
import {
  TERMINAL_ASK,
  TERMINAL_TARGET,
  type TerminalAsk,
  terminalTarget,
} from "@luke/features/terminal-entry";
import { sandboxRead, shellsAsked } from "@luke/features/terminal-store";
import { ACT_KIND } from "@luke/host/acts";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { useCallback, useContext, useState } from "react";
import { useAct } from "../act";
import { useAppCommand } from "../app-commands";
import { TerminalPicker } from "./terminal-picker";
import type { CodingAgentsControl } from "./use-coding-agents";
import type { SidePanelControl } from "./use-side-panel";

/**
 * terminal-commands.tsx -- Show terminal (⌘J) and New terminal while a task is drawn: which agent each means by the rules, its Terminal tab shown, and the picker where the rules ask.
 *
 * Both commands are offers on the window's one keymap (`app-commands.ts`), so
 * the menu bar and ⌘K run them as ⌘J does. Each decides the agent
 * (`terminal-entry.ts`) from where the developer is, then shows that agent's
 * Terminal tab in the side panel, New terminal asking its sandbox for a new
 * shell first (`terminal-store.ts`'s `shellsAsked`), which the tab starts
 * once the sandbox runs. Where the rules leave the agent to the developer
 * the picker asks, and what it is answered with is done as the command
 * would have done it.
 */

/** What the picker stands open for: the command that asked, and the agent chosen to begin with. */
interface Asking {
  readonly ask: TerminalAsk;
  readonly chosen: string | undefined;
}

/**
 * Opens an agent's terminal as a command means it: its Terminal tab shown,
 * after a new shell is asked of its sandbox where the command was New
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
  agents: CodingAgentsControl;
  sidePanel: Pick<SidePanelControl, "onChoose" | "lastTerminal">;
  /** Hands the keyboard to the side panel, where the terminal now stands. */
  onShown: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const registry = useContext(RegistryContext);
  const [asking, setAsking] = useState<Asking | undefined>(undefined);
  const open = useOpenTerminal(sidePanel, onShown);
  const run = (ask: TerminalAsk) => {
    // A task whose agents are not read yet asks, rather than offer to start one it may not need.
    if (agents.agents === undefined && here === undefined) {
      return setAsking({ ask, chosen: undefined });
    }
    const agentIds = (agents.agents ?? []).map((agent) => agent.id);
    const target = terminalTarget(ask, {
      here,
      agents: agentIds,
      lastUsed: sidePanel.lastTerminal,
    });
    switch (target.kind) {
      case TERMINAL_TARGET.AGENT:
        return open(target.agentId, ask);
      case TERMINAL_TARGET.PICK:
        return setAsking({ ask, chosen: target.chosen });
      case TERMINAL_TARGET.NO_AGENT:
        return setAsking({ ask, chosen: undefined });
    }
  };
  useAppCommand(APP_COMMAND.SHOW_TERMINAL, () => run(TERMINAL_ASK.SHOW));
  useAppCommand(APP_COMMAND.NEW_TERMINAL, () => run(TERMINAL_ASK.NEW));
  // How each sandbox stands, read as the picker opens, which never wakes one.
  const readSandbox = useCallback(
    (agentId: string) => {
      void act(ACT_KIND.TERMINAL_LIST, { agentId }).then(
        (answer) => {
          if (!("refused" in answer)) registry.set(sandboxRead(agentId), answer);
        },
        () => undefined,
      );
    },
    [act, registry],
  );
  return (
    <TerminalPicker
      pick={asking}
      agents={agents}
      lastUsed={sidePanel.lastTerminal}
      readSandbox={readSandbox}
      onPick={(agentId) => open(agentId, asking?.ask ?? TERMINAL_ASK.SHOW)}
      onStartAgent={() => agents.start.onPress()}
      start={agents.start}
      onClose={() => setAsking(undefined)}
    />
  );
}
