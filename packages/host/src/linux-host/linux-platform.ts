import { CLAUDE_CODE_LINUX_PINS, CODEX_LINUX_PINS, NODE_LINUX_PINS } from "@luke/agent-runner/pins";
import { RUNNER_ENV, RUNNER_PLACE } from "@luke/agent-runner/protocol";
import {
  DEVICE_ARCH,
  DEVICE_CAPABILITY,
  DEVICE_ISOLATION,
  DEVICE_PLATFORM,
  type DeviceArch,
} from "@luke/features/device-agent-wire";
import type {
  LocalAgentCommand,
  LocalAgentPlatformSeam,
  LocalAgentRunner,
} from "../effect/seams.js";
import { agentWorktreeScript, cloneFolder, worktreesRoot } from "../node/open-on-mac.js";

/**
 * linux-platform.ts -- what a host's local agent runners are started with (`LocalAgentPlatform`): on the daemon's own Node with the runner bundle the host's release carries, the Linux pins of Claude Code and Codex, and the launcher the daemon hands it.
 *
 * A host is sandbox-only: every runner starts in a VM of its own, through
 * the launcher the daemon is built with (`LinuxPlatformOptions.launch`), the
 * one door that takes the agent (`LocalAgentPlatformSeam.launch`). Until
 * that launcher lands, the daemon hands `refusingLaunch`, so a launch is
 * settled as not started and nothing runs on the box itself. Its harnesses
 * run no sandbox of their own (`RUNNER_PLACE.HOST`), since the VM is the
 * boundary, and a host's own harness logins never run its agents
 * (`ownSignIns: false`); its agents' `gh` is signed in from Luke
 * (`githubFromLuke`).
 */

/** The runner's bundle, under the folder the host's release is installed in. */
const RUNNER_BUNDLE = "lib/agent-runner.mjs";

/** What `refusingLaunch` runs: a program that exits at once with a failure, so the follower settles the launch as not started. */
const REFUSED = "/bin/false";

/**
 * The launcher a host has before its sandbox launcher: it runs nothing of
 * the agent's, so every launch is settled as not started.
 */
export function refusingLaunch(runner: LocalAgentRunner): LocalAgentCommand {
  return { command: REFUSED, args: [], env: runner.env };
}

/** Node's `process.arch` as a device architecture a host runs on, or none for one no release is built for. */
export function hostArch(arch: string): DeviceArch | undefined {
  return Object.values(DEVICE_ARCH).find((each) => each === arch);
}

export interface LinuxPlatformOptions {
  /** The folder the host's release is installed in (`/opt/luke-host`), whose `lib/` holds the runner's bundle. */
  readonly installFolder: string;
  /** The Node the daemon runs on, the release's own, which every runner runs on too. */
  readonly node: string;
  /** The `gh` the daemon fetched for its agents (`GH_LINUX_PINS`); none where it could not be had. */
  readonly gh: string | undefined;
  readonly arch: DeviceArch;
  /** The box's own name, which the device registers under. */
  readonly hostname: string;
  /** How every runner starts: the sandbox launcher, or `refusingLaunch` until there is one. */
  readonly launch: (runner: LocalAgentRunner) => LocalAgentCommand;
}

/** A host's local agent platform, for the release installed in the folder given. */
export function linuxPlatform(options: LinuxPlatformOptions): LocalAgentPlatformSeam {
  return {
    launch: options.launch,
    runnerBundle: `${options.installFolder}/${RUNNER_BUNDLE}`,
    runnerEnv: { [RUNNER_ENV.PLACE]: RUNNER_PLACE.HOST },
    bundled: { node: options.node, gh: options.gh },
    pins: {
      node: NODE_LINUX_PINS[options.arch],
      claude: CLAUDE_CODE_LINUX_PINS[options.arch],
      codex: CODEX_LINUX_PINS[options.arch],
    },
    ownSignIns: false,
    // Note that a host has no git login of the developer's, so each agent's gh is signed in from Luke.
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
      }),
  };
}
