import { existsSync } from "node:fs";
import os from "node:os";
import { type AgentToolPin, SMOLVM_MAC_PIN } from "@luke/agent-runner/pins";
import {
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  type DeviceArch,
  type DevicePlatform,
} from "@luke/features/device-agent-wire";
import type { LocalAgentPlatformSeam } from "../effect/seams.js";
import { macDeviceName } from "../node/mac-device-name.js";
import { agentUnsavedWorkScript } from "../node/open-on-mac.js";

/**
 * host-os.ts -- what a host's daemon does differently on each OS it runs on (`HostOs`): the platform it enrolls and registers as, the architectures it is built for, its default name, whether its agents' VMs may nest, where its `smolvm` comes from, and whether agents ran directly on it before.
 *
 * Everything else, the enroll, the follower, and the VM per agent, is the
 * same program on every OS (`hostPlatform`, `hostDaemon`). A description
 * reads the machine only when its daemon asks it to, as it starts.
 */

/** Where a host's `smolvm` comes from. */
export const HOST_SMOLVM = {
  /** A path its service names in a variable, which the daemon checks answers the pinned release. */
  PATH: "path",
  /** The pinned release, fetched and checked under the daemon's state. */
  PIN: "pin",
} as const;

export type HostSmolvmSource =
  | { readonly kind: typeof HOST_SMOLVM.PATH; readonly variable: string }
  | { readonly kind: typeof HOST_SMOLVM.PIN; readonly pin: AgentToolPin };

/** The device a Linux box hands each agent's VM so it can boot VMs of its own, where the box has it. */
const KVM = "/dev/kvm";

export interface HostOs {
  /** The OS as a person at the machine reads it. */
  readonly name: string;
  readonly platform: DevicePlatform;
  /** The architectures a release is built for, in the order they are said. */
  readonly arches: readonly DeviceArch[];
  /** The machine's own name, which it enrolls and registers under where it is given none. */
  readonly deviceName: () => string;
  /** Whether each agent's VM may run VMs of its own. */
  readonly nested: () => boolean;
  readonly smolvm: HostSmolvmSource;
  /** Whether agents may have run directly on the machine before every agent ran in a VM (`LocalAgentPlatformSeam.formerlyDirect`). */
  readonly formerlyDirect: boolean;
  readonly unsavedWorkScript?: LocalAgentPlatformSeam["unsavedWorkScript"];
}

/** A Linux box: its host name, `/dev/kvm` passed through where it has it, and the `smolvm` the install script put at the path its service names. */
export const LINUX_HOST: HostOs = {
  name: "Linux",
  platform: DEVICE_PLATFORM.LINUX,
  arches: [DEVICE_ARCH.X64, DEVICE_ARCH.ARM64],
  deviceName: () => os.hostname(),
  nested: () => existsSync(KVM),
  smolvm: { kind: HOST_SMOLVM.PATH, variable: "LUKE_HOST_SMOLVM" },
  formerlyDirect: false,
};

/**
 * A Mac: Apple silicon alone, its Computer Name, no nested VMs, which
 * Hypervisor.framework never gives its guests, and the pinned `smolvm`
 * fetched and checked in-process. Note that agents ran directly on This Mac
 * before, so a discard checks a folder for work that is nowhere else.
 */
export const DARWIN_HOST: HostOs = {
  name: "macOS",
  platform: DEVICE_PLATFORM.DARWIN,
  arches: [DEVICE_ARCH.ARM64],
  deviceName: macDeviceName,
  nested: () => false,
  smolvm: { kind: HOST_SMOLVM.PIN, pin: SMOLVM_MAC_PIN },
  formerlyDirect: true,
  unsavedWorkScript: agentUnsavedWorkScript,
};

/** Node's `process.arch` as a device architecture a release for the OS given is built for, or none. */
export function hostArch(hostOs: HostOs, arch: string): DeviceArch | undefined {
  return hostOs.arches.find((each) => each === arch);
}
