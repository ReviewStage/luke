import { LIVE_READ } from "@repo/features/live-wire";
import { type RunOnMacReason, runOnMacReason } from "@repo/features/workspace-tools-model";
import type { WorkspaceToolsAnswer } from "@repo/features/workspace-tools-wire";
import { HOST_CAPABILITY, MAC_COMMAND_MODE } from "@repo/settings";
import * as Atom from "effect/reactivity/Atom";
import { APP_SLICE, useAppSlice, useCapability } from "../use-app-state.js";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";

/**
 * agent-workspace-tools.ts -- our own tools as an agent's MCP popover draws them: the ones the service says the agent is offered, and whether its `run_on_mac` is on and why not.
 *
 * The host holds them while the popover shows (`LIVE_READ.WORKSPACE_TOOLS`),
 * asking the service as it is first held and again whenever a window comes
 * forward, which is how the developer comes back from Settings or from
 * opening the app on their Mac; each answer stands until the next lands, and
 * one held lately draws at once. Whether this Mac's Settings let no agent
 * run commands on it is the window's own to say, and counts only where the
 * reader is the member whose Mac the agent's commands run on, as the
 * service names them, and reads on a Mac.
 */

/** The agent whose built-in tools the popover draws, and who reads it. */
export interface WorkspaceToolsDoor {
  readonly agentId: string;
  /** The reader's account, which says whether this Mac's setting is the one the agent's commands meet. */
  readonly reader: string | undefined;
}

/** Our own tools as the popover draws them. */
export interface WorkspaceToolsRead {
  /** The service's answer; nothing while it is read, or where it failed. */
  readonly answer: WorkspaceToolsAnswer | undefined;
  /** Whether the read failed before it ever answered. */
  readonly failed: boolean;
  /** Why `run_on_mac` is off for the agent; nothing where it is on or not yet known. */
  readonly reason: RunOnMacReason | undefined;
}

/** Whether this window's Settings let no agent run commands on its Mac, which tells its readers only as that turns. */
const MAC_COMMANDS_NEVER = Atom.map(
  APP_SLICE.SETTINGS,
  (settings) => settings?.stored.macCommands === MAC_COMMAND_MODE.NEVER,
);

/** The agent's built-in tools, held for as long as the caller is drawn; nothing is held for no agent. */
export function useWorkspaceTools(door: WorkspaceToolsDoor | undefined): WorkspaceToolsRead {
  const { rows, status } = useHostRead(LIVE_READ.WORKSPACE_TOOLS, door?.agentId);
  const onMac = useCapability(HOST_CAPABILITY.MAC_COMMANDS);
  const never = useAppSlice(MAC_COMMANDS_NEVER);
  const standing = rows?.runOnMac;
  // Note that only the member whose Mac the commands run on can mend it in their own Settings.
  const ownMac =
    standing !== undefined &&
    !standing.on &&
    door?.reader !== undefined &&
    standing.owner === door.reader;
  return {
    answer: rows,
    failed: status === HOST_READ_STATUS.FAILED,
    reason: runOnMacReason({
      settingsOff: onMac && never && ownMac,
      standing,
    }),
  };
}
