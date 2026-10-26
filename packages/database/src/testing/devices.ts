/**
 * devices.ts -- a synthetic Mac's layout, as a test registers a device with one.
 */

import { DEVICE_ARCH, DEVICE_PLATFORM } from "@luke/features/device-agent-wire";
import type { DeviceRegistration } from "../models/device-store.js";

/** A Mac's platform, home folder, and bundled CLI, synthetic. */
export const DEVICE_LAYOUT: DeviceRegistration = {
  platform: DEVICE_PLATFORM.DARWIN,
  arch: DEVICE_ARCH.ARM64,
  home: "/Users/fixture",
  claudeExecutable: "/Applications/Luke.app/Contents/Resources/claude-code/cli.js",
};
