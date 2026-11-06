import os from "node:os";
import path from "node:path";
import {
  CLAUDE_CODE_LINUX_PINS,
  CLAUDE_CODE_MAC_PIN,
  CODEX_LINUX_PINS,
  CODEX_MAC_PIN,
  GH_LINUX_PINS,
  GH_MAC_PIN,
} from "@repo/agent-runner/pins";
import {
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  type DeviceArch,
  type DeviceMachine,
  type DevicePlatform,
} from "@repo/features/device-agent-wire";
import type { AgentCliPins } from "../local-agent-setup.js";
import { macDeviceName } from "../node/mac-device-name.js";
import { linuxMachine, macMachine } from "../node/machine-identity.js";

export interface HostOs {
  readonly name: string;
  readonly platform: DevicePlatform;
  readonly arches: readonly DeviceArch[];
  readonly deviceName: () => string;
  readonly machine: () => DeviceMachine;
  readonly agentClis: (arch: DeviceArch) => AgentCliPins;
  readonly stateRoot: (home: string) => string;
}

export const LINUX_HOST: HostOs = {
  name: "Linux",
  platform: DEVICE_PLATFORM.LINUX,
  arches: [DEVICE_ARCH.X64, DEVICE_ARCH.ARM64],
  deviceName: () => os.hostname(),
  machine: linuxMachine,
  agentClis: (arch) => ({
    claude: CLAUDE_CODE_LINUX_PINS[arch],
    codex: CODEX_LINUX_PINS[arch],
    gh: GH_LINUX_PINS[arch],
  }),
  stateRoot: (home) => path.join(home, "state"),
};

export const DARWIN_HOST: HostOs = {
  name: "macOS",
  platform: DEVICE_PLATFORM.DARWIN,
  arches: [DEVICE_ARCH.ARM64],
  deviceName: macDeviceName,
  machine: macMachine,
  agentClis: () => ({ claude: CLAUDE_CODE_MAC_PIN, codex: CODEX_MAC_PIN, gh: GH_MAC_PIN }),
  stateRoot: (home) => path.join(home, ".local", "state", "vespin-host"),
};

export function hostArch(hostOs: HostOs, arch: string): DeviceArch | undefined {
  return hostOs.arches.find((each) => each === arch);
}

export interface HostRuntime {
  readonly os: HostOs;
  readonly stateRoot: string;
}

export function hostRuntime(input: {
  readonly platform: string;
  readonly home: string;
}): HostRuntime | undefined {
  const hostOs = [LINUX_HOST, DARWIN_HOST].find((each) => each.platform === input.platform);
  if (hostOs === undefined) return undefined;
  return { os: hostOs, stateRoot: hostOs.stateRoot(input.home) };
}
