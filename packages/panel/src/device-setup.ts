import { DEVICE_SETUP, type DeviceSetup } from "@luke/features/device-agent-wire";

/**
 * device-setup.ts -- what a device still setting itself up is called: getting ready, or couldn't set up and why, the one wording every surface that says where a device's setup stands takes.
 *
 * This Mac's row and every other host's row in Settings › Hosts, and a
 * task's Runs on, say a device's setup in these words, so a host reads the
 * same wherever it is named.
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
