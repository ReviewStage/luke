import { CLAUDE_CODE_LINUX_PINS, CODEX_LINUX_PINS, NODE_LINUX_PINS } from "@luke/agent-runner/pins";
import { RUNNER_ENV, RUNNER_PLACE } from "@luke/agent-runner/protocol";
import {
  DEVICE_ARCH,
  DEVICE_CAPABILITY,
  DEVICE_ISOLATION,
  DEVICE_PLATFORM,
  type DeviceArch,
} from "@luke/features/device-agent-wire";
import type { LocalAgentPlatformSeam } from "../effect/seams.js";
import { agentWorktreeScript, cloneFolder, worktreesRoot } from "../node/open-on-mac.js";
import { smolvmSandbox } from "../node/smolvm-sandbox.js";

/**
 * linux-platform.ts -- what a host's local agent runners are started with (`LocalAgentPlatform`): each in a smolvm VM of its own, booted from Luke's sandbox image, running the runner bundle the host's release carries on the image's own Node, Claude Code and Codex.
 *
 * A host is sandbox-only: every runner starts in its agent's VM
 * (`@luke/host/node`'s `smolvmSandbox`), with the agent's folder mounted at
 * the path it has on the box and the release's `lib/` read-only beside it,
 * and nothing of an agent's runs on the box itself, a tool's command
 * included. Each agent gets a repository of its own in its folder
 * (`agentWorktreeScript`'s `own`), since a worktree's Git folder would stand
 * in the shared clone, outside its VM. Its harnesses run no sandbox of their
 * own (`RUNNER_PLACE.HOST`), since the VM is the boundary, and a host's own
 * harness logins never run its agents (`ownSignIns: false`); its agents'
 * GitHub token comes from Luke (`githubFromLuke`) and stays on the box,
 * outside every VM, which holds only a placeholder.
 */

/** The folder of the runner's bundle, under the folder the host's release is installed in, and the bundle in it. */
const RUNNER = { FOLDER: "lib", BUNDLE: "agent-runner.mjs" } as const;

/** Node's `process.arch` as a device architecture a host runs on, or none for one no release is built for. */
export function hostArch(arch: string): DeviceArch | undefined {
  return Object.values(DEVICE_ARCH).find((each) => each === arch);
}

export interface LinuxPlatformOptions {
  /** The folder the host's release is installed in (`/opt/luke-host`), whose `lib/` holds the runner's bundle. */
  readonly installFolder: string;
  /** The Node the daemon runs on, the release's own, which every runner runs on too. */
  readonly node: string;
  readonly arch: DeviceArch;
  /** The box's own name, which the device registers under. */
  readonly hostname: string;
  /** The daemon's state, under which each agent's GitHub token is kept, outside every VM. */
  readonly stateRoot: string;
  /** The `smolvm` the box runs its agents' VMs with. */
  readonly smolvm: string;
  /** The `luke-host` user, which every command in a VM runs as, so it writes the agent's folder as its owner. */
  readonly user: { readonly uid: number; readonly gid: number };
  /** Whether the box has `/dev/kvm`, which each VM is then handed so an agent can boot VMs of its own. */
  readonly kvm: boolean;
}

/** A host's local agent platform, for the release installed in the folder given. */
export function linuxPlatform(options: LinuxPlatformOptions): LocalAgentPlatformSeam {
  const runnerFolder = `${options.installFolder}/${RUNNER.FOLDER}`;
  const vm = smolvmSandbox({
    smolvm: options.smolvm,
    stateRoot: options.stateRoot,
    runnerFolder,
    user: options.user,
    nested: options.kvm,
  });
  return {
    launch: vm.launch,
    sandbox: vm.sandbox,
    runnerBundle: `${runnerFolder}/${RUNNER.BUNDLE}`,
    runnerEnv: { [RUNNER_ENV.PLACE]: RUNNER_PLACE.HOST },
    bundled: { node: options.node },
    pins: {
      node: NODE_LINUX_PINS[options.arch],
      claude: CLAUDE_CODE_LINUX_PINS[options.arch],
      codex: CODEX_LINUX_PINS[options.arch],
    },
    ownSignIns: false,
    // Note that a host has no git login of the developer's, so each agent's GitHub token comes from Luke, kept outside its VM.
    githubFromLuke: true,
    deviceName: options.hostname,
    devicePlatform: DEVICE_PLATFORM.LINUX,
    // Note that a host runs every agent in a sandbox and lets go of an archived agent's folder (`discard`).
    deviceIsolation: DEVICE_ISOLATION.SANDBOX,
    deviceCapabilities: [DEVICE_CAPABILITY.DISCARD],
    deviceArch: options.arch,
    worktreeScript: ({ home, repository, worktree, branch }) =>
      agentWorktreeScript({
        repository,
        clone: cloneFolder(worktreesRoot(home), repository),
        worktree,
        branch,
        own: true,
      }),
  };
}
