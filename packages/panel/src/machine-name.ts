import { signedInAccountId } from "@repo/credentials/snapshot";
import type { AppThisMacHost } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { thisMacHostQuery } from "./live-reads.js";
import { appStateQuery, selectAccount } from "./use-app-state.js";

export const THIS_MAC = "This Mac";

export interface ListedMachine {
  readonly deviceId: string | undefined;
  readonly name: string;
  readonly machineId?: string | undefined;
  readonly model?: string | undefined;
}

export type ThisMac = AppThisMacHost | undefined;

export function isThisMac(machine: ListedMachine, thisMac: ThisMac): boolean {
  if (thisMac === undefined) return false;
  if (machine.machineId !== undefined && thisMac.machineId !== undefined) {
    return machine.machineId === thisMac.machineId;
  }
  return machine.deviceId !== undefined && machine.deviceId === thisMac.deviceId;
}

export function machineName(
  machine: ListedMachine,
  listed: readonly ListedMachine[],
  thisMac: ThisMac,
): string {
  if (isThisMac(machine, thisMac)) return THIS_MAC;
  const twinned = listed.some(
    (other) =>
      other.deviceId !== machine.deviceId &&
      other.name === machine.name &&
      !isThisMac(other, thisMac),
  );
  return twinned && machine.model !== undefined
    ? `${machine.name} · ${machine.model}`
    : machine.name;
}

export function useThisMac(): ThisMac {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  return useQuery(thisMacHostQuery(accountId)).data;
}
