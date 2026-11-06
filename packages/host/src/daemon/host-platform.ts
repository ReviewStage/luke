import { RUNNER_ENV, RUNNER_PLACE } from "@repo/agent-runner/protocol";
import {
  DEVICE_CAPABILITY,
  DEVICE_PLATFORM,
  type DeviceArch,
} from "@repo/features/device-agent-wire";
import type { LocalAgentClis, LocalAgentPlatformSeam } from "../effect/seams.js";
import { agentOnBox } from "../local-agent-box.js";
import { localAgentClis } from "../local-agent-setup.js";
import {
  agentWorktreeScript,
  cloneFolder,
  repositoryReachedScript,
  worktreesRoot,
} from "../node/open-on-mac.js";
import type { HostOs } from "./host-os.js";

const RUNNER_BUNDLE = "lib/agent-runner.mjs";

const ROOT = 0;

const CLAUDE_CODE_SANDBOXED = "IS_SANDBOX";

interface HostPlatformOptions {
  readonly os: HostOs;
  readonly installFolder: string;
  readonly node: string;
  readonly arch: DeviceArch;
  readonly stateRoot: string;
  readonly user: { readonly uid: number; readonly gid: number };
  readonly clis?: LocalAgentClis | undefined;
}

export function hostPlatform(options: HostPlatformOptions): LocalAgentPlatformSeam {
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
    clis,
    runnerBundle: `${options.installFolder}/${RUNNER_BUNDLE}`,
    runnerEnv: {
      [RUNNER_ENV.PLACE]: RUNNER_PLACE.HOST,
      ...(options.user.uid === ROOT ? { [CLAUDE_CODE_SANDBOXED]: "1" } : {}),
    },
    deviceName: options.os.deviceName(),
    deviceMachine: options.os.machine(),
    devicePlatform: options.os.platform,
    deviceCapabilities: [
      DEVICE_CAPABILITY.DISCARD,
      ...(options.os.platform === DEVICE_PLATFORM.DARWIN ? [DEVICE_CAPABILITY.GITHUB_SIGN_IN] : []),
    ],
    deviceArch: options.arch,
    worktreeScript: ({ home, repository, worktree, branch }) =>
      agentWorktreeScript({
        repository,
        clone: cloneFolder(worktreesRoot(home), repository),
        worktree,
        branch,
      }),
    repositoryReachedScript: (repository) => repositoryReachedScript({ repository }),
  };
}
