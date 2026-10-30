import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type AgentToolPin, SMOLVM_MAC_PIN } from "@luke/agent-runner/pins";
import {
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  type DeviceArch,
  type DevicePlatform,
} from "@luke/features/device-agent-wire";
import { resolveAppName } from "../app-identity.js";
import type { LocalAgentPlatformSeam } from "../effect/seams.js";
import { macDeviceName } from "../node/mac-device-name.js";
import { agentUnsavedWorkScript } from "../node/open-on-mac.js";

/**
 * host-os.ts -- what a host's daemon does differently on each OS it runs on (`HostOs`): the platform it enrolls and registers as, the architectures it is built for, its default name, whether its agents' VMs may nest, where its `smolvm` comes from, whether agents ran directly on it before, and whether its agents' folders and VMs are its own alone.
 *
 * Everything else, the enroll, the follower, and the VM per agent, is the
 * same program on every OS (`hostPlatform`, `hostDaemon`). A description
 * reads the machine only when its daemon asks it to, as it starts. Which one
 * a daemon runs on, and where its state lives there, is `hostRuntime`'s.
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
  /** Whether the agents' folders and the smolvm store the daemon runs with are its own alone (`LocalAgentPlatformSeam.storesOwned`). */
  readonly storesOwned: boolean;
  readonly unsavedWorkScript?: LocalAgentPlatformSeam["unsavedWorkScript"];
  /** The folder the daemon's state lives in, for the home it runs with (`hostRuntime`). */
  readonly stateRoot: (home: string, app: HostApp) => string;
  /** The folder holding the runner's bundle, which every agent's VM mounts read-only, for the folder the release is installed in. */
  readonly runnerFolder: (installFolder: string) => string;
}

/** What a daemon knows of the app it shipped in, where it ships in one. */
export interface HostApp {
  /** Whether the app was signed for release (`buildCarriesDeveloperIdSigning`), which names its state folder. */
  readonly developerIdSigned: boolean;
}

/** A Linux box: its state, its agents' folders and its smolvm store under the `luke-host` user's home, that user's alone, its host name, `/dev/kvm` passed through where it has it, and the `smolvm` the install script put at the path its service names. */
export const LINUX_HOST: HostOs = {
  name: "Linux",
  platform: DEVICE_PLATFORM.LINUX,
  arches: [DEVICE_ARCH.X64, DEVICE_ARCH.ARM64],
  deviceName: () => os.hostname(),
  nested: () => existsSync(KVM),
  smolvm: { kind: HOST_SMOLVM.PATH, variable: "LUKE_HOST_SMOLVM" },
  formerlyDirect: false,
  storesOwned: true,
  stateRoot: (home) => path.join(home, "state"),
  runnerFolder: (installFolder) => path.join(installFolder, "lib"),
};

/**
 * A Mac: Apple silicon alone, its Computer Name, no nested VMs, which
 * Hypervisor.framework never gives its guests, and the pinned `smolvm`
 * fetched and checked in-process. Note that agents ran directly on This Mac
 * before, so a discard checks a folder for work that is nowhere else. Its
 * `luke-host` runs as the member and ships inside the desktop app, so its
 * state is the app's own folder, which Electron puts under Application
 * Support by the app's name (`resolveAppName`, a packaged build's), and the
 * app's device ids, agent folders, VMs and fetched `smolvm` are where it
 * looks. Those folders and VMs stand in the member's own `~/.luke/agents`
 * and smolvm store, which a standalone `luke-host` shares, so they are
 * never its own alone. Its runner is the app's own bundle, beside the
 * release in `Contents/Resources/agent-runner`, because every VM the app
 * made before mounts that folder and keeps the mounts it was made with.
 */
export const DARWIN_HOST: HostOs = {
  name: "macOS",
  platform: DEVICE_PLATFORM.DARWIN,
  arches: [DEVICE_ARCH.ARM64],
  deviceName: macDeviceName,
  nested: () => false,
  smolvm: { kind: HOST_SMOLVM.PIN, pin: SMOLVM_MAC_PIN },
  formerlyDirect: true,
  storesOwned: false,
  unsavedWorkScript: agentUnsavedWorkScript,
  stateRoot: (home, app) =>
    path.join(
      home,
      "Library",
      "Application Support",
      resolveAppName({ packaged: true, developerIdSigned: app.developerIdSigned }),
    ),
  runnerFolder: (installFolder) => path.join(installFolder, "..", "agent-runner"),
};

/** Node's `process.arch` as a device architecture a release for the OS given is built for, or none. */
export function hostArch(hostOs: HostOs, arch: string): DeviceArch | undefined {
  return hostOs.arches.find((each) => each === arch);
}

/** What a host's daemon runs as on the machine it started on: the OS's description and the folder its state lives in. */
export interface HostRuntime {
  readonly os: HostOs;
  readonly stateRoot: string;
}

/** The description and state folder of the OS given, as Node's `process.platform` names it, for a daemon run with the home given; none where Luke builds no host for it. */
export function hostRuntime(input: {
  readonly platform: string;
  readonly home: string;
  readonly app: HostApp;
}): HostRuntime | undefined {
  const hostOs = [LINUX_HOST, DARWIN_HOST].find((each) => each.platform === input.platform);
  if (hostOs === undefined) return undefined;
  return { os: hostOs, stateRoot: hostOs.stateRoot(input.home, input.app) };
}
