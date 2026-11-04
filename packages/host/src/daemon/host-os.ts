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
import type { LocalAgentPlatformSeam } from "../effect/seams.js";
import type { AgentCliPins } from "../local-agent-setup.js";
import { macDeviceName } from "../node/mac-device-name.js";
import { linuxMachine, macMachine } from "../node/machine-identity.js";
import { agentUnsavedWorkScript } from "../node/open-on-mac.js";

/**
 * host-os.ts -- what a host's daemon does differently on each OS it runs on (`HostOs`): the platform it enrolls and registers as, the architectures it is built for, its default name, how it reads which machine it is, and which builds of the agent CLIs it keeps.
 *
 * Everything else, the connect, the follower, and each agent run straight
 * on the box, is the same program on every OS (`hostPlatform`,
 * `hostDaemon`), the check of an agent's folder for unsaved work before a
 * discard among it. A description
 * reads the machine only when its daemon asks it to, as it starts. Which one
 * a daemon runs on, and where its state lives there, is `hostRuntime`'s.
 */

export interface HostOs {
  /** The OS as a person at the machine reads it. */
  readonly name: string;
  readonly platform: DevicePlatform;
  /** The architectures a release is built for, in the order they are said. */
  readonly arches: readonly DeviceArch[];
  /** The machine's own name, which it enrolls and registers under where it is given none. */
  readonly deviceName: () => string;
  /** Which machine it is, as it pairs and registers (`node/machine-identity.ts`), each part absent where it could not be read. */
  readonly machine: () => DeviceMachine;
  /** The builds of the agent CLIs it fetches and keeps, for the architecture it runs on (`LocalAgentPlatformSeam.clis`). */
  readonly agentClis: (arch: DeviceArch) => AgentCliPins;
  /** What says a discard would lose work from an agent's worktree (`LocalAgentPlatformSeam.unsavedWorkScript`), run on the box. */
  readonly unsavedWorkScript: NonNullable<LocalAgentPlatformSeam["unsavedWorkScript"]>;
  /** The folder the daemon's state lives in, for the home it runs with (`hostRuntime`). */
  readonly stateRoot: (home: string) => string;
}

/** A Linux box: its state and its agents' folders under the daemon's user's home, that user's alone, its host name, and the glibc builds of the agent CLIs for its architecture. */
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
  unsavedWorkScript: agentUnsavedWorkScript,
  stateRoot: (home) => path.join(home, "state"),
};

/**
 * A Mac: Apple silicon alone, its Computer Name, and the macOS arm64
 * builds of the agent CLIs, each install keeping its own copy. Its
 * `vespin-host` is the account install, run as the member, so its state is
 * the account install's own, under the member's home (`ACCOUNT_STATE` in
 * `apps/host/scripts/vespin-host.sh`, which names it too), and its agents'
 * folders stand in the member's own `~/.vespin/agents`.
 */
export const DARWIN_HOST: HostOs = {
  name: "macOS",
  platform: DEVICE_PLATFORM.DARWIN,
  arches: [DEVICE_ARCH.ARM64],
  deviceName: macDeviceName,
  machine: macMachine,
  // Note that the arch is not read, since a Mac host is built for Apple silicon alone (`arches`).
  agentClis: () => ({ claude: CLAUDE_CODE_MAC_PIN, codex: CODEX_MAC_PIN, gh: GH_MAC_PIN }),
  unsavedWorkScript: agentUnsavedWorkScript,
  stateRoot: (home) => path.join(home, ".local", "state", "vespin-host"),
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

/** The description and state folder of the OS given, as Node's `process.platform` names it, for a daemon run with the home given; none where we build no host for it. */
export function hostRuntime(input: {
  readonly platform: string;
  readonly home: string;
}): HostRuntime | undefined {
  const hostOs = [LINUX_HOST, DARWIN_HOST].find((each) => each.platform === input.platform);
  if (hostOs === undefined) return undefined;
  return { os: hostOs, stateRoot: hostOs.stateRoot(input.home) };
}
