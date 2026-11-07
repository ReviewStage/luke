import { type RunOnMacReason, runOnMacReason } from "@repo/features/workspace-tools-model";
import type { RunOnMacStanding } from "@repo/features/workspace-tools-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { HOST_CAPABILITY, MAC_COMMAND_MODE, type MacCommandMode } from "@repo/settings";
import { useQuery } from "@tanstack/react-query";
import { workspaceToolsQuery } from "../live-reads.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";

/**
 * run-on-mac.ts -- whose Mac an agent's `run_on_mac` runs on and how it stands, as its Runs on chip and card read it.
 *
 * The host holds the service's answer while the chip shows
 * (`LIVE_READ.WORKSPACE_TOOLS`), asking as it is first held and again
 * whenever a window comes forward, which is how the developer comes back
 * from Settings or from opening the app on their Mac; each answer stands
 * until the next lands, and one held lately draws at once. What this Mac's
 * Settings let agents do with commands (`MAC_COMMAND_MODE`) is the window's
 * own to say, read only on a Mac, and turns `run_on_mac` off only where
 * the Mac is the reader's own.
 */

/** Where an agent's `run_on_mac` stands, as the card reads it. */
export interface RunOnMacRead {
  /** The service's answer; nothing while it is read, where it failed, or for an agent offered no `run_on_mac`. */
  readonly standing: RunOnMacStanding | undefined;
  /** Why `run_on_mac` is off for the agent; nothing where it is on or not yet known. */
  readonly reason: RunOnMacReason | undefined;
  /** What this Mac's Settings let agents do with commands; nothing where the window reads on no Mac. */
  readonly mode: MacCommandMode | undefined;
}

/** What this window's Settings let agents do with commands on its Mac, which tells its readers only as that turns. */
const selectMacCommands = (state: AppStateSnapshot): MacCommandMode =>
  state.settings?.stored.macCommands ?? MAC_COMMAND_MODE.ASK;

/** The agent's `run_on_mac`, held for as long as the caller is drawn; `mine` says whether a Mac is the reader's own. */
export function useRunOnMac(agentId: string, mine: (userId: string) => boolean): RunOnMacRead {
  const standing = useQuery(workspaceToolsQuery(agentId)).data?.runOnMac;
  const onMac =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.MAC_COMMANDS) }).data ===
    true;
  const stored = useQuery({ ...appStateQuery, select: selectMacCommands }).data;
  const mode = onMac ? (stored ?? MAC_COMMAND_MODE.ASK) : undefined;
  return {
    standing,
    reason: runOnMacReason({
      settingsOff:
        mode === MAC_COMMAND_MODE.NEVER && standing !== undefined && mine(standing.owner.userId),
      standing,
    }),
    mode,
  };
}
