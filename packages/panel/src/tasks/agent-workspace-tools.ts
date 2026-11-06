import { type RunOnMacReason, runOnMacReason } from "@repo/features/workspace-tools-model";
import type { WorkspaceToolsAnswer } from "@repo/features/workspace-tools-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { HOST_CAPABILITY, MAC_COMMAND_MODE } from "@repo/settings";
import { useQuery } from "@tanstack/react-query";
import { workspaceToolsQuery } from "../live-reads.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";

/**
 * agent-workspace-tools.ts -- our own tools as an agent's MCP popover draws them: the ones the service says the agent is offered, and whether its `run_on_mac` is on and why not.
 *
 * The host holds them while the popover shows (`LIVE_READ.WORKSPACE_TOOLS`),
 * asking the service as it is first held and again whenever a window comes
 * forward, which is how the developer comes back from Settings or from
 * opening the app on their Mac; each answer stands until the next lands, and
 * one held lately draws at once. Whether this Mac's Settings let no agent
 * run commands on it is the window's own to say, and counts only where the
 * reader started the agent, whose Mac its commands run on, and reads on a
 * Mac.
 */

/** The agent whose built-in tools the popover draws, and whether its reader started it. */
export interface WorkspaceToolsDoor {
  readonly agentId: string;
  /** Whether the reader started the agent, so this Mac's setting is the one its commands meet. */
  readonly starterReading: boolean;
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
const selectMacCommandsNever = (state: AppStateSnapshot): boolean =>
  state.settings?.stored.macCommands === MAC_COMMAND_MODE.NEVER;

/** The agent's built-in tools, held for as long as the caller is drawn; nothing is held for no agent. */
export function useWorkspaceTools(door: WorkspaceToolsDoor | undefined): WorkspaceToolsRead {
  const read = useQuery(workspaceToolsQuery(door?.agentId));
  const rows = read.data;
  const onMac =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.MAC_COMMANDS) }).data ===
    true;
  const never = useQuery({ ...appStateQuery, select: selectMacCommandsNever }).data === true;
  return {
    answer: rows,
    failed: read.isError,
    reason: runOnMacReason({
      settingsOff: onMac && never && door?.starterReading === true,
      standing: rows?.runOnMac,
    }),
  };
}
