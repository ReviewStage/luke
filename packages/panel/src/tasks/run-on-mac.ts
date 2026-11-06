import { type RunOnMacReason, runOnMacReason } from "@repo/features/workspace-tools-model";
import type { RunOnMacStanding } from "@repo/features/workspace-tools-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { HOST_CAPABILITY, MAC_COMMAND_MODE } from "@repo/settings";
import { useQuery } from "@tanstack/react-query";
import { workspaceToolsQuery } from "../live-reads.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";

/**
 * run-on-mac.ts -- whose Mac an agent's `run_on_mac` runs on and how it stands, as the card its Runs on chip hangs reads it.
 *
 * The host holds the service's answer while the card shows
 * (`LIVE_READ.WORKSPACE_TOOLS`), asking as it is first held and again
 * whenever a window comes forward, which is how the developer comes back
 * from Settings or from opening the app on their Mac; each answer stands
 * until the next lands, and one held lately draws at once. Whether this
 * Mac's Settings let no agent run commands on it is the window's own to
 * say, and counts only where the Mac is the reader's own, on a Mac.
 */

/** Where an agent's `run_on_mac` stands, as the card reads it. */
export interface RunOnMacRead {
  /** The service's answer; nothing while it is read, where it failed, or for an agent offered no `run_on_mac`. */
  readonly standing: RunOnMacStanding | undefined;
  /** Why `run_on_mac` is off for the agent; nothing where it is on or not yet known. */
  readonly reason: RunOnMacReason | undefined;
}

/** Whether this window's Settings let no agent run commands on its Mac, which tells its readers only as that turns. */
const selectMacCommandsNever = (state: AppStateSnapshot): boolean =>
  state.settings?.stored.macCommands === MAC_COMMAND_MODE.NEVER;

/** The agent's `run_on_mac`, held for as long as the caller is drawn; `mine` says whether a Mac is the reader's own. */
export function useRunOnMac(agentId: string, mine: (userId: string) => boolean): RunOnMacRead {
  const standing = useQuery(workspaceToolsQuery(agentId)).data?.runOnMac;
  const onMac =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.MAC_COMMANDS) }).data ===
    true;
  const never = useQuery({ ...appStateQuery, select: selectMacCommandsNever }).data === true;
  return {
    standing,
    reason: runOnMacReason({
      settingsOff: onMac && never && standing !== undefined && mine(standing.owner.userId),
      standing,
    }),
  };
}
