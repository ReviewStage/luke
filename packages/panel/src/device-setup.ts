import {
  DEVICE_SETUP,
  type DeviceSetup,
  HOST_UPDATE,
  type HostUpdate,
} from "@luke/features/device-agent-wire";

/**
 * device-setup.ts -- what a device still setting itself up is called, getting ready or couldn't set up and why, and what a host updating itself is called, the one wording every surface that says where either stands takes.
 *
 * This Mac's row and every other host's row in Settings › Hosts, and a
 * task's Runs on, say a device's setup in these words, so a host reads the
 * same wherever it is named. A host's row says its update to a newer
 * release in the words beside them.
 */

/** What each setup is called. */
export const DEVICE_SETUP_WORDS = {
  [DEVICE_SETUP.PREPARING]: "Getting ready…",
  [DEVICE_SETUP.FAILED]: "Couldn't set up",
} as const satisfies Record<DeviceSetup, string>;

/** Where a device's setup stands, in a line: getting ready, or couldn't set up with why where the device said. */
export function deviceSetupWords(setup: DeviceSetup, failure: string | undefined): string {
  const named = DEVICE_SETUP_WORDS[setup];
  return setup === DEVICE_SETUP.FAILED && failure !== undefined ? `${named}: ${failure}` : named;
}

/** What each stage of a host's update is called. */
export const HOST_UPDATE_WORDS = {
  [HOST_UPDATE.WAITING]: "Update ready, waiting for agents to finish",
  [HOST_UPDATE.UPDATING]: "Updating…",
  [HOST_UPDATE.FAILED]: "Couldn't update",
} as const satisfies Record<HostUpdate, string>;

/** Where a host's update stands, in a line: waiting, updating, or couldn't update with why where the host said. */
export function hostUpdateWords(update: HostUpdate, failure: string | undefined): string {
  const named = HOST_UPDATE_WORDS[update];
  return update === HOST_UPDATE.FAILED && failure !== undefined ? `${named}: ${failure}` : named;
}
