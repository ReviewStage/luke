/**
 * host-service.ts -- the service of ours that runs an account install's daemon, read off what its service manager hands it: its systemd user unit on Linux, or its LaunchAgent on a Mac.
 */

import { DEVICE_PLATFORM, type DevicePlatform } from "@repo/features/device-agent-wire";

/** What runs an account install's daemon: its systemd user unit on Linux, or its LaunchAgent on a Mac, by its label. */
export const HOST_SERVICE = {
  UNIT: "vespin-host.service",
  LAUNCH_AGENT: "dev.vespin.host.standalone",
} as const;

export type HostService = (typeof HOST_SERVICE)[keyof typeof HOST_SERVICE];

/**
 * The service of ours that runs the daemon, read off what its service
 * manager hands it: on Linux the unit its control group names, the last part
 * of a path in `/proc/self/cgroup`, and on a Mac the label launchd names its
 * job by (`XPC_SERVICE_NAME`); none for a run by hand, or by a service not
 * ours.
 */
export function hostServiceOf(input: {
  readonly platform: DevicePlatform;
  readonly cgroup: string;
  readonly launchdLabel: string | undefined;
}): HostService | undefined {
  if (input.platform === DEVICE_PLATFORM.DARWIN) {
    return input.launchdLabel === HOST_SERVICE.LAUNCH_AGENT ? HOST_SERVICE.LAUNCH_AGENT : undefined;
  }
  const units = input.cgroup.split("\n").map((line) => line.slice(line.lastIndexOf("/") + 1));
  return units.includes(HOST_SERVICE.UNIT) ? HOST_SERVICE.UNIT : undefined;
}
