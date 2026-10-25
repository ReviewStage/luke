/**
 * mac-devices.ts -- a synthetic Mac's layout, as a test registers a device with one.
 */

import type { MacDeviceLayout } from "../models/mac-device-store.js";

/** A Mac's home folder and bundled CLI, synthetic. */
export const MAC_DEVICE_LAYOUT: MacDeviceLayout = {
  home: "/Users/fixture",
  claudeExecutable: "/Applications/Luke.app/Contents/Resources/claude-code/cli.js",
};
