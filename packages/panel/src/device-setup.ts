import { DEVICE_SETUP, type DeviceSetup } from "@repo/features/device-agent-wire";

export const DEVICE_SETUP_WORDS = {
  [DEVICE_SETUP.PREPARING]: "Getting ready…",
  [DEVICE_SETUP.FAILED]: "Couldn't set up",
} as const satisfies Record<DeviceSetup, string>;
