import { DEVICE_PLATFORM, type DevicePlatform } from "@repo/features/device-agent-wire";

export const DEVICE_PLATFORM_NAME = {
  [DEVICE_PLATFORM.DARWIN]: "Mac",
  [DEVICE_PLATFORM.LINUX]: "Linux server",
} as const satisfies Record<DevicePlatform, string>;

export function devicePlatformOf(device: {
  readonly platform?: DevicePlatform | undefined;
}): DevicePlatform {
  return device.platform ?? DEVICE_PLATFORM.DARWIN;
}
