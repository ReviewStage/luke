import { signedInAccountId } from "@repo/credentials/snapshot";
import type { AppThisMacHost } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { thisMacHostQuery } from "./live-reads.js";
import { APP_SLICE, useAppSlice } from "./use-app-state.js";

/**
 * machine-name.ts -- what every list of the member's machines calls each one: This Mac, or its name, with its model where another listed machine has that name too.
 *
 * Settings › Hosts, New task's Runs on, and an agent's row in its plan's
 * head all name a machine here (`machineName`), so they never disagree. The
 * machine the desktop app runs on reads "This Mac": the one whose host
 * reported the same keyed machine id the desktop reads of this Mac, or, for
 * one whose host reported none, the device this Mac's account host's record
 * names. Two machines listed under one name, as two Macs set up alike are,
 * each say their model after it. This Mac is the host's: it reads it as it
 * starts and every few seconds after, and lays it on app state where it
 * moved (`LIVE_READ.THIS_MAC_HOST`), so a surface draws it in its first
 * frame and asks nothing (`useThisMac`). A browser tab has no This Mac, so
 * its host lays none.
 */

/** What the machine the desktop app runs on is called. */
export const THIS_MAC = "This Mac";

/** A machine as a list holds it: its device, the name it registered, and which machine it is and its model, where its host reported them. */
export interface ListedMachine {
  readonly deviceId: string | undefined;
  readonly name: string;
  readonly machineId?: string | undefined;
  readonly model?: string | undefined;
}

/** This Mac as the desktop's host holds it (`AppThisMacHost`); none in a browser tab. */
export type ThisMac = AppThisMacHost | undefined;

/** Whether the machine given is the one the desktop app runs on: by machine id where both name one, else by the device this Mac's host's record names. */
export function isThisMac(machine: ListedMachine, thisMac: ThisMac): boolean {
  if (thisMac === undefined) return false;
  if (machine.machineId !== undefined && thisMac.machineId !== undefined) {
    return machine.machineId === thisMac.machineId;
  }
  return machine.deviceId !== undefined && machine.deviceId === thisMac.deviceId;
}

/** What the machine given is called among those listed: This Mac, or its name, and its model where another listed machine but This Mac has the same name. */
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

/** This Mac as the host holds it for the account signed in; none before the host first reads it, while nobody is signed in, and in a browser tab. */
export function useThisMac(): ThisMac {
  const accountId = signedInAccountId(useAppSlice(APP_SLICE.ACCOUNT));
  return useQuery(thisMacHostQuery(accountId)).data;
}
