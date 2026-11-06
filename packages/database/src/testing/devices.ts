import { DEVICE_ARCH, DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import type { DeviceRegistration } from "../models/device-store.js";

export const DEVICE_LAYOUT: DeviceRegistration = {
  platform: DEVICE_PLATFORM.DARWIN,
  arch: DEVICE_ARCH.ARM64,
  home: "/Users/fixture",
  claudeExecutable: "/Applications/Vespin.app/Contents/Resources/claude-code/cli.js",
};
