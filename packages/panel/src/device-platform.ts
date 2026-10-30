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

/** When a Mac runs its agents, since its host runs in its user's login session: while the user named is logged in, or its user where the service named none. */
export function macSessionWords(loginName: string | undefined): string {
  return `Runs while ${loginName ?? "its user"} is logged in.`;
}

/** The device's platform; a Mac where the service said none, as one older than platforms on the wire did of every device but a Linux server. */
export function devicePlatformOf(device: {
  readonly platform?: DevicePlatform | undefined;
}): DevicePlatform {
  return device.platform ?? DEVICE_PLATFORM.DARWIN;
}
