import { DEVICE_SETUP, type DeviceSetup } from "@luke/features/device-agent-wire";

/**
 * device-setup.ts -- what a device still setting itself up is called, getting ready or couldn't set up, which a task's Runs on says of a device that takes no agent yet.
 */

/** What each setup is called. */
export const DEVICE_SETUP_WORDS = {
  [DEVICE_SETUP.PREPARING]: "Getting ready…",
  [DEVICE_SETUP.FAILED]: "Couldn't set up",
} as const satisfies Record<DeviceSetup, string>;
