import type { AgentToolPin } from "@luke/agent-runner/pins";
import { RUNNER_ENV, RUNNER_PLACE } from "@luke/agent-runner/protocol";
import {
  DEVICE_CAPABILITY,
  DEVICE_ISOLATION,
  type DeviceArch,
} from "@luke/features/device-agent-wire";
import type { LocalAgentClis, LocalAgentPlatformSeam } from "../effect/seams.js";
import { localAgentClis } from "../local-agent-setup.js";
import { openAgentState, sealAgentState } from "../node/agent-state-seal.js";
import { diskFree } from "../node/disk-free.js";
import { agentWorktreeScript, cloneFolder, worktreesRoot } from "../node/open-on-mac.js";
import { smolvmSandbox } from "../node/smolvm-sandbox.js";
import type { HostOs } from "./host-os.js";

/**
 * host-platform.ts -- what a host's local agent runners are started with (`LocalAgentPlatform`): each in a smolvm VM of its own, booted from Luke's sandbox image, running the runner bundle the host's release carries on the image's own Node, Claude Code and Codex.
 *
 * A host is sandbox-only: every runner starts in its agent's VM
 * (`@luke/host/node`'s `smolvmSandbox`), with the agent's folder mounted at
 * the path it has on the box and the runner's folder read-only beside it,
 * and nothing of an agent's runs on the box itself, a tool's command
 * included. Each agent gets a repository of its own in its folder
 * (`agentWorktreeScript`), since a worktree's Git folder would stand in the
 * shared clone, outside its VM. Its harnesses run no sandbox of their own
 * (`RUNNER_PLACE.HOST`), since the VM is the boundary, and no login left on
 * the box reaches them, so they run on the sign-ins saved in Luke; its
 * agents' GitHub token comes from Luke and stays on the box, outside every
 * VM, which holds only a placeholder. What differs by OS, the platform it
 * registers as, its name, nesting, whether agents ran directly on it
 * before, and whether its agents' folders and VMs are its own alone, comes
 * from its description (`HostOs`).
 *
 * Every host also keeps its own Claude Code, Codex, and GitHub CLI, the
 * pinned builds for its OS and architecture (`HostOs.agentClis`), fetched
 * under the daemon's state before it registers ready (`clis`). Its agents
 * still run on the image's own in their VMs, so the device registers the
 * VM's paths (`LocalAgentSandbox.tools`); `clis.paths` is where the kept
 * builds stand for the device to register once its agents run on the box.
 */

/** The runner's bundle, in the folder the host's OS names for it (`HostOs.runnerFolder`). */
const RUNNER_BUNDLE = "agent-runner.mjs";

export interface HostPlatformOptions {
  /** The OS the host runs on, which names its platform, its name and whether its VMs nest. */
  readonly os: HostOs;
  /** The folder the host's release is installed in (`/opt/luke-host`), beside or under which the runner's bundle stands (`HostOs.runnerFolder`). */
  readonly installFolder: string;
  /** The runner's folder where something other than the OS names it: a development build's own, which its VMs mount. */
  readonly runnerFolder?: string | undefined;
  readonly arch: DeviceArch;
  /** The daemon's state, under which each agent's GitHub token is kept, outside every VM. */
  readonly stateRoot: string;
  /** The `smolvm` the box runs its agents' VMs with: a path it checked, or the pinned release it fetches. */
  readonly smolvm: string | AgentToolPin;
  /** The user every command in a VM runs as, so it writes the agent's folder as its owner. */
  readonly user: { readonly uid: number; readonly gid: number };
  /** The agent CLIs where something other than the OS's pins names them: a suite's own, which fetches nothing. */
  readonly clis?: LocalAgentClis | undefined;
}

/** A host's local agent platform, for the release installed in the folder given. */
export function hostPlatform(options: HostPlatformOptions): LocalAgentPlatformSeam {
  const runnerFolder = options.runnerFolder ?? options.os.runnerFolder(options.installFolder);
  const vm = smolvmSandbox({
    smolvm: options.smolvm,
    stateRoot: options.stateRoot,
    runnerFolder,
    user: options.user,
    nested: options.os.nested(),
  });
  return {
    launch: vm.launch,
    sandbox: vm.sandbox,
    clis: options.clis ?? localAgentClis(options.stateRoot, options.os.agentClis(options.arch)),
    runnerBundle: `${vm.runnerFolder}/${RUNNER_BUNDLE}`,
    runnerEnv: { [RUNNER_ENV.PLACE]: RUNNER_PLACE.HOST },
    formerlyDirect: options.os.formerlyDirect,
    storesOwned: options.os.storesOwned,
    deviceName: options.os.deviceName(),
    devicePlatform: options.os.platform,
    // Note that a host runs every agent in a sandbox, lets go of an archived agent's folder (`discard`), and saves each agent's state at its turn's end (`agent-state`).
    deviceIsolation: DEVICE_ISOLATION.SANDBOX,
    deviceCapabilities: [DEVICE_CAPABILITY.DISCARD, DEVICE_CAPABILITY.AGENT_STATE],
    deviceArch: options.arch,
    worktreeScript: ({ home, repository, worktree, branch, base }) =>
      agentWorktreeScript({
        repository,
        clone: cloneFolder(worktreesRoot(home), repository),
        worktree,
        branch,
        base,
      }),
    unsavedWorkScript: options.os.unsavedWorkScript,
    stateSealed: sealAgentState,
    stateOpened: openAgentState,
    diskFree,
  };
}
