import {
  DEVICE_KIND,
  DEVICE_PLATFORM,
  type DeviceKind,
  type DevicePlatform,
} from "@luke/features/device-agent-wire";

/**
 * device-platform.ts -- what a device is to the member, by its platform: the one reading every surface that names a device or draws its glyph takes.
 *
 * A device's words and glyph follow its platform, never its kind, since a
 * Mac and a Linux server join Luke the same way and both run the host
 * program. A service older than the platform on the wire said only the
 * kind, when every host was a Linux server and every desktop a Mac, so the
 * kind stands in for it there.
 */

/** What each platform's device is called. */
export const DEVICE_PLATFORM_NAME = {
  [DEVICE_PLATFORM.DARWIN]: "Mac",
  [DEVICE_PLATFORM.LINUX]: "Linux server",
} as const satisfies Record<DevicePlatform, string>;

/** The device's platform, or the one its kind stood for where a service older than platforms said none; a Mac where it said neither. */
export function devicePlatformOf(device: {
  readonly platform?: DevicePlatform | undefined;
  readonly kind?: DeviceKind | undefined;
}): DevicePlatform {
  if (device.platform !== undefined) return device.platform;
  return device.kind === DEVICE_KIND.HOST ? DEVICE_PLATFORM.LINUX : DEVICE_PLATFORM.DARWIN;
}
