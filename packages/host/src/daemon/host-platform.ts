import type { AgentToolPin } from "@luke/agent-runner/pins";
import { RUNNER_ENV, RUNNER_PLACE } from "@luke/agent-runner/protocol";
import {
  DEVICE_CAPABILITY,
  DEVICE_ISOLATION,
  type DeviceArch,
} from "@luke/features/device-agent-wire";
import type { LocalAgentClis, LocalAgentPlatformSeam } from "../effect/seams.js";
import { agentOnBox } from "../local-agent-box.js";
import { localAgentClis } from "../local-agent-setup.js";
import { openAgentState, sealAgentState } from "../node/agent-state-seal.js";
import { diskFree } from "../node/disk-free.js";
import { agentWorktreeScript, cloneFolder, worktreesRoot } from "../node/open-on-mac.js";
import { smolvmSandbox } from "../node/smolvm-sandbox.js";
import type { HostOs } from "./host-os.js";

/**
 * host-platform.ts -- what a host's local agent runners are started with (`LocalAgentPlatform`): each straight on the box, as a child of the host's own process and as its own user, in the agent's own folder, running the runner bundle the host's release carries on the host's own Node, and the pinned Claude Code, Codex, and GitHub CLI the host keeps.
 *
 * A host runs every agent directly (`DEVICE_ISOLATION.DIRECT`), as This Mac
 * and a Linux box alike: the runner starts in the agent's folder with its
 * home and caches there (`local-agent-box.ts`'s `agentOnBox`), with full
 * access to whatever the host's user reaches. Each agent gets a repository
 * of its own in its folder (`agentWorktreeScript`), made from the box's
 * shared clone. Its harnesses run no sandbox of their own and ask no
 * approval (`RUNNER_PLACE.HOST`), and no login left on the box reaches
 * them, so they run on the sign-ins saved in Luke; its GitHub token comes
 * from Luke, in gh's config in its home. Claude Code refuses to skip its
 * permissions as root unless it is told the box is a sandbox of its own, so
 * a host running as root, as a dedicated box's may, tells it so
 * (`IS_SANDBOX`). What differs by OS, the platform it registers as, its
 * name, whether agents ran on the developer's own logins on it before,
 * whether its agents' folders are its own alone, and its check for unsaved
 * work, comes from its description (`HostOs`).
 *
 * Every host keeps its own Claude Code, Codex, and GitHub CLI, the pinned
 * builds for its OS and architecture (`HostOs.agentClis`), fetched under
 * the daemon's state before it registers ready (`clis`), which it registers
 * and its agents run on. Its `smolvm`, where it has one, is kept only to
 * delete the VMs its agents' runs left standing from before they ran on
 * the box (`sandbox`), and none where it has none.
 */

/** The runner's bundle, in the folder the host's OS names for it (`HostOs.runnerFolder`). */
const RUNNER_BUNDLE = "agent-runner.mjs";

/** The superuser's id, as which a dedicated box's host may run. */
const ROOT = 0;

/** What tells Claude Code it runs in a sandbox of its own, the one way it skips its permissions as root (its `isRootOutsideDeliberateSandbox`). */
const CLAUDE_CODE_SANDBOXED = "IS_SANDBOX";

export interface HostPlatformOptions {
  /** The OS the host runs on, which names its platform, its name, and its check for unsaved work. */
  readonly os: HostOs;
  /** The folder the host's release is installed in (`/opt/luke-host`), beside or under which the runner's bundle stands (`HostOs.runnerFolder`). */
  readonly installFolder: string;
  /** The runner's folder where something other than the OS names it: a development build's own. */
  readonly runnerFolder?: string | undefined;
  /** The Node the host itself runs on, which every runner runs on too. */
  readonly node: string;
  readonly arch: DeviceArch;
  /** The daemon's state, under which it keeps the agent CLIs. */
  readonly stateRoot: string;
  /** The `smolvm` the box ran its agents' VMs with before they ran on it, which deletes what they left standing: a path its service names, or the pinned release a Mac fetched; none where it names none. */
  readonly smolvm?: string | AgentToolPin | undefined;
  /** The user the host runs as, whose every agent runs as it too: root's tells Claude Code it may skip its permissions. */
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
  const clis =
    options.clis ?? localAgentClis(options.stateRoot, options.os.agentClis(options.arch));
  return {
    launch: (runner) =>
      agentOnBox(
        {
          folder: runner.folder,
          command: runner.node,
          args: [runner.bundle],
          env: runner.env,
        },
        clis.paths.gh,
      ),
    tools: { node: options.node, claude: clis.paths.claude, codex: clis.paths.codex },
    sandbox: vm.sandbox,
    clis,
    runnerBundle: `${runnerFolder}/${RUNNER_BUNDLE}`,
    runnerEnv: {
      [RUNNER_ENV.PLACE]: RUNNER_PLACE.HOST,
      ...(options.user.uid === ROOT ? { [CLAUDE_CODE_SANDBOXED]: "1" } : {}),
    },
    formerlyDirect: options.os.formerlyDirect,
    storesOwned: options.os.storesOwned,
    deviceName: options.os.deviceName(),
    devicePlatform: options.os.platform,
    // Note that a host runs every agent straight on the box and lets go of an archived agent's folder (`discard`); it saves no agent's state, whose folder stays for its life.
    deviceIsolation: DEVICE_ISOLATION.DIRECT,
    deviceCapabilities: [DEVICE_CAPABILITY.DISCARD],
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
