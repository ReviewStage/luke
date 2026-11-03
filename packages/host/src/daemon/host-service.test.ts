/**
 * host-service.test.ts -- the unit or LaunchAgent that runs an account install's daemon, read off what its service manager hands it.
 */

import { describe, expect, it } from "@effect/vitest";
import { DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import { HOST_SERVICE, hostServiceOf } from "./host-service.js";

describe("the service that runs an account install's daemon", () => {
  it.each([
    {
      case: "a Linux daemon under its unit, as cgroup v2 names it",
      platform: DEVICE_PLATFORM.LINUX,
      cgroup: "0::/user.slice/user-1000.slice/user@1000.service/app.slice/vespin-host.service\n",
      label: undefined,
      service: HOST_SERVICE.UNIT,
    },
    {
      case: "a Linux daemon under its unit, as a cgroup v1 hierarchy names it",
      platform: DEVICE_PLATFORM.LINUX,
      cgroup:
        "12:pids:/user.slice/user-1000.slice\n1:name=systemd:/user.slice/user-1000.slice/user@1000.service/vespin-host.service\n",
      label: undefined,
      service: HOST_SERVICE.UNIT,
    },
    {
      case: "a Linux daemon run by hand in a login session",
      platform: DEVICE_PLATFORM.LINUX,
      cgroup: "0::/user.slice/user-1000.slice/session-4.scope\n",
      label: undefined,
      service: undefined,
    },
    {
      case: "a Mac daemon its LaunchAgent started",
      platform: DEVICE_PLATFORM.DARWIN,
      cgroup: "",
      label: HOST_SERVICE.LAUNCH_AGENT,
      service: HOST_SERVICE.LAUNCH_AGENT,
    },
    {
      case: "a Mac daemon run by hand in Terminal",
      platform: DEVICE_PLATFORM.DARWIN,
      cgroup: "",
      label: "0",
      service: undefined,
    },
  ])("reads what runs $case", ({ platform, cgroup, label, service }) => {
    expect(hostServiceOf({ platform, cgroup, launchdLabel: label })).toBe(service);
  });
});
