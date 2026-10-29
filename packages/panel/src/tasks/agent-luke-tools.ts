import type { AgentLukeToolsAnswerView } from "@luke/features/agent-view";
import { type RunOnMacReason, runOnMacReason } from "@luke/features/luke-tools-model";
import type { LukeToolsAnswer } from "@luke/features/luke-tools-wire";
import { ACT_KIND } from "@luke/host/acts";
import { HOST_CAPABILITY, MAC_COMMAND_MODE } from "@luke/settings";
import * as Atom from "effect/reactivity/Atom";
import { useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import { APP_SLICE, useAppSlice, useCapability } from "../use-app-state.js";

/**
 * agent-luke-tools.ts -- Luke's own tools as an agent's MCP popover draws them: the ones the service says the agent is offered, and whether its `run_on_mac` is on and why not.
 *
 * The service is asked as the popover opens and again whenever the window
 * is focused, which is how the developer comes back from Settings or from
 * opening Luke on their Mac; each answer stands until the next lands, and an
 * answer to an older ask never lands over a newer one. Whether this Mac's
 * Settings let no agent run commands on it is the window's own to say, and
 * counts only where the reader started the agent, whose Mac its commands
 * run on, and reads on a Mac.
 */

/** The agent whose Luke tools the popover draws, and whether its reader started it. */
export interface LukeToolsDoor {
  readonly agentId: string;
  /** Whether the reader started the agent, so this Mac's setting is the one its commands meet. */
  readonly starterReading: boolean;
}

/** Luke's tools as the popover draws them. */
export interface LukeToolsRead {
  /** The service's answer; nothing while it is read, or where it failed. */
  readonly answer: LukeToolsAnswer | undefined;
  /** Whether the last read failed. */
  readonly failed: boolean;
  /** Why `run_on_mac` is off for the agent; nothing where it is on or not yet known. */
  readonly reason: RunOnMacReason | undefined;
}

/** Whether this window's Settings let no agent run commands on its Mac, which tells its readers only as that turns. */
const MAC_COMMANDS_NEVER = Atom.map(
  APP_SLICE.SETTINGS,
  (settings) => settings?.stored.macCommands === MAC_COMMAND_MODE.NEVER,
);

/** The agent's Luke tools, read for as long as the caller is drawn; nothing is read for no agent. */
export function useLukeTools(door: LukeToolsDoor | undefined): LukeToolsRead {
  const { act } = useAct();
  const [read, setRead] = useState<{ answer: LukeToolsAnswer } | { failed: true } | undefined>(
    undefined,
  );
  const [focus, setFocus] = useState(0);
  // The agent and the focus last asked under, so each is asked once per focus.
  const asked = useRef<{ agentId: string; focus: number } | undefined>(undefined);
  const asks = useRef(0);
  const onMac = useCapability(HOST_CAPABILITY.MAC_COMMANDS);
  const never = useAppSlice(MAC_COMMANDS_NEVER);
  const agentId = door?.agentId;

  useEffect(() => {
    const focused = () => setFocus((count) => count + 1);
    window.addEventListener("focus", focused);
    return () => window.removeEventListener("focus", focused);
  }, []);

  useEffect(() => {
    if (agentId === undefined) return;
    if (asked.current?.agentId === agentId && asked.current.focus === focus) return;
    asked.current = { agentId, focus };
    asks.current += 1;
    const ask = asks.current;
    const land = (answer: AgentLukeToolsAnswerView | undefined) => {
      if (asks.current !== ask) return;
      // Note that a read that fails keeps the answer before it, because a focus that could not ask again changed nothing.
      setRead((was) =>
        answer !== undefined && "tools" in answer
          ? { answer }
          : was !== undefined && "answer" in was
            ? was
            : { failed: true },
      );
    };
    act(ACT_KIND.AGENTS_LUKE_TOOLS, { agentId }).then(land, () => land(undefined));
  });

  const answer = read !== undefined && "answer" in read ? read.answer : undefined;
  return {
    answer,
    failed: read !== undefined && "failed" in read,
    reason: runOnMacReason({
      settingsOff: onMac && never && door?.starterReading === true,
      standing: answer?.runOnMac,
    }),
  };
}
