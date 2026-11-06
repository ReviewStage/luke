import { DEVICE_PLATFORM, type DevicePlatform } from "@repo/features/device-agent-wire";

export const HOST_SERVICE = {
  UNIT: "vespin-host.service",
  LAUNCH_AGENT: "dev.vespin.host.standalone",
} as const;

export type HostService = (typeof HOST_SERVICE)[keyof typeof HOST_SERVICE];

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
