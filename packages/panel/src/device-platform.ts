import { DEVICE_PLATFORM, type DevicePlatform } from "@luke/features/device-agent-wire";

/**
 * device-platform.ts -- what a device is to the member, by its platform: the one reading every surface that names a device or draws its glyph takes.
 *
 * A device's words and glyph follow its platform, never its kind, since a
 * Mac and a Linux server join Luke the same way and both run the host
 * program.
 */

/** What each platform's device is called. */
export const DEVICE_PLATFORM_NAME = {
  [DEVICE_PLATFORM.DARWIN]: "Mac",
  [DEVICE_PLATFORM.LINUX]: "Linux server",
} as const satisfies Record<DevicePlatform, string>;

/** The device's platform; a Mac where the service said none, as one older than platforms on the wire did of every device but a Linux server. */
export function devicePlatformOf(device: {
  readonly platform?: DevicePlatform | undefined;
}): DevicePlatform {
  return device.platform ?? DEVICE_PLATFORM.DARWIN;
}
