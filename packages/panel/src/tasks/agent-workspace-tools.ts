import { type RunOnMacReason, runOnMacReason } from "@repo/features/workspace-tools-model";
import type { WorkspaceToolsAnswer } from "@repo/features/workspace-tools-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { HOST_CAPABILITY, MAC_COMMAND_MODE } from "@repo/settings";
import { useQuery } from "@tanstack/react-query";
import { workspaceToolsQuery } from "../live-reads.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";

export interface WorkspaceToolsDoor {
  readonly agentId: string;
  readonly starterReading: boolean;
}

export interface WorkspaceToolsRead {
  readonly answer: WorkspaceToolsAnswer | undefined;
  readonly failed: boolean;
  readonly reason: RunOnMacReason | undefined;
}

const selectMacCommandsNever = (state: AppStateSnapshot): boolean =>
  state.settings?.stored.macCommands === MAC_COMMAND_MODE.NEVER;

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
