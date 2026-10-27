import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import {
  CLAUDE_CODE_MAC_PIN,
  CODEX_MAC_PIN,
  NODE_MAC_PIN,
  SMOLVM_MAC_PIN,
} from "@luke/agent-runner/pins";
import { RUNNER_ENV, RUNNER_PLACE } from "@luke/agent-runner/protocol";
import {
  DEVICE_ARCH,
  DEVICE_CAPABILITY,
  DEVICE_ISOLATION,
  DEVICE_PLATFORM,
} from "@luke/features/device-agent-wire";
import type {
  LocalAgentCommand,
  LocalAgentPlatformSeam,
  LocalAgentRunner,
} from "@luke/host/effect";
import {
  agentUnsavedWorkScript,
  agentWorktreeScript,
  cloneFolder,
  smolvmSandbox,
  worktreesRoot,
} from "@luke/host/node";
import { app } from "electron";
import { nativeHelperPath } from "../native/native-helper";

/**
 * local-agent-platform.ts -- what a local agent's runner is started with on this Mac (`@luke/host`'s `LocalAgentPlatform`): the launcher, the runner's bundle, and the copies of Node and the Claude Code CLI a development run already has.
 *
 * Every runner starts through `luke-agent-launcher`
 * (`native/macos/AgentLauncher.swift`), so it answers for its own privacy
 * decisions rather than taking Luke's microphone and Apple Events grants.
 * A packaged build runs the bundle shipped in its resources
 * (`scripts/package-layout.mjs`'s `AGENT_RUNNER_RESOURCES`) on the pinned
 * Node and Claude Code the host fetches the first time local agents are
 * turned on (`@luke/host`'s `localAgentTool`), since its fuses burn off
 * running the app itself as Node and it ships neither. A development run,
 * which keeps Electron's fuses, runs the bundle the start built under
 * Electron's own Node, and the CLI the runner's Agent SDK installed for
 * this Mac, pinned to the cloud's, where it installed one.
 *
 * Beside it stands the platform the Mac runs its agents on while its
 * sandbox setting is on (`sandboxed`): each in a smolvm VM of its own
 * (`@luke/host/node`'s `smolvmSandbox`), the pinned smolvm fetched and
 * checked under the app's state, started through the same launcher, with
 * the agent's folder and the runner's bundle mounted at their paths, no
 * nested VMs, which a Mac's Hypervisor.framework never gives its guests, and
 * the runner on the image's own Node, Claude Code, and Codex. Nothing of the
 * Mac's reaches it: it runs on the sign-ins saved in Luke (`ownSignIns`),
 * GitHub through a token from Luke that stays outside the VM
 * (`githubFromLuke`), and a repository of its own rather than a worktree of
 * Luke's shared clone, whose Git folder no VM mounts. The check of its
 * folder for unsaved work still runs before a discard, in its VM.
 */

const LAUNCHER = "luke-agent-launcher";

const RESOURCES = {
  DIRECTORY: "agent-runner",
  BUNDLE: "agent-runner.mjs",
  CLAUDE: "claude",
} as const;

/** The runner's package in the checkout a development run starts from. */
function runnerPackage(): string {
  return path.resolve(app.getAppPath(), "..", "..", "packages", "agent-runner");
}

/**
 * The CLI the runner's Agent SDK installed for this Mac: its macOS package
 * is the SDK's own dependency, so it is found from the SDK rather than the
 * runner. None where the checkout has none, as off a Mac, and the host
 * fetches the pinned release instead.
 */
function installedClaude(): string | undefined {
  try {
    const sdk = createRequire(path.join(runnerPackage(), "package.json")).resolve(
      "@anthropic-ai/claude-agent-sdk",
    );
    return createRequire(sdk).resolve(
      `@anthropic-ai/claude-agent-sdk-darwin-arm64/${RESOURCES.CLAUDE}`,
    );
  } catch {
    return undefined;
  }
}

/** The Mac's name as Start offers it: its host name without the `.local` Bonjour adds. */
function deviceName(): string {
  const name = os.hostname().replace(/\.local$/u, "");
  return name.length > 0 ? name : "This Mac";
}

export interface LocalAgentPlatformOptions {
  readonly packaged: boolean;
  /** Luke's state root, the host's own, under which the pinned smolvm and each sandboxed agent's GitHub token are kept. */
  readonly stateRoot: string;
}

/**
 * The platform `base` runs its agents on in a VM each: the same runner's
 * bundle and the Mac's name, platform, and capabilities, and everything a
 * VM changes.
 */
function sandboxedPlatform(
  base: LocalAgentPlatformSeam,
  stateRoot: string,
  launcher: string,
): LocalAgentPlatformSeam {
  const { uid, gid } = os.userInfo();
  const vm = smolvmSandbox({
    smolvm: SMOLVM_MAC_PIN,
    through: launcher,
    stateRoot,
    runnerFolder: path.dirname(base.runnerBundle),
    // Note that every command in a VM runs as the developer, who owns the agent's folder it mounts.
    user: { uid, gid },
    nested: false,
  });
  return {
    ...base,
    launch: vm.launch,
    sandbox: vm.sandbox,
    // Note that the harnesses run no sandbox of their own, since the VM is the boundary.
    runnerEnv: { [RUNNER_ENV.PLACE]: RUNNER_PLACE.HOST },
    bundled: {},
    ownSignIns: false,
    githubFromLuke: true,
    deviceIsolation: DEVICE_ISOLATION.SANDBOX,
    worktreeScript: ({ home, repository, worktree, branch }) =>
      agentWorktreeScript({
        repository,
        clone: cloneFolder(worktreesRoot(home), repository),
        worktree,
        branch,
        own: true,
      }),
    sandboxed: undefined,
  };
}

export function localAgentPlatform(options: LocalAgentPlatformOptions): LocalAgentPlatformSeam {
  const worktreeScript: LocalAgentPlatformSeam["worktreeScript"] = ({
    home,
    repository,
    worktree,
    branch,
  }) =>
    agentWorktreeScript({
      repository,
      clone: cloneFolder(worktreesRoot(home), repository),
      worktree,
      branch,
    });
  const launcher = nativeHelperPath(LAUNCHER);
  const shared = {
    launch: ({ node, bundle, env }: LocalAgentRunner): LocalAgentCommand => ({
      command: launcher,
      args: [node, bundle],
      env,
    }),
    pins: { node: NODE_MAC_PIN, claude: CLAUDE_CODE_MAC_PIN, codex: CODEX_MAC_PIN },
    ownSignIns: true,
    deviceName: deviceName(),
    // Note that the app is built for Apple silicon alone (`package.json`'s `--mac --arm64`).
    devicePlatform: DEVICE_PLATFORM.DARWIN,
    deviceArch: DEVICE_ARCH.ARM64,
    // Note that every agent runs directly on the Mac here, since its launcher starts the runner there; `sandboxed` runs each in a VM.
    deviceIsolation: DEVICE_ISOLATION.BARE,
    deviceCapabilities: [DEVICE_CAPABILITY.DISCARD],
    worktreeScript,
    // Note that only This Mac checks, since its worktree can hold the only copy of the developer's work, which a host's VM never does.
    unsavedWorkScript: agentUnsavedWorkScript,
    // Note that an agent on This Mac pushes on the developer's own git login, as they would.
    githubFromLuke: false,
  };
  const bare: LocalAgentPlatformSeam = options.packaged
    ? {
        ...shared,
        runnerBundle: path.join(process.resourcesPath, RESOURCES.DIRECTORY, RESOURCES.BUNDLE),
        runnerEnv: {},
        bundled: {},
      }
    : {
        ...shared,
        runnerBundle: path.join(runnerPackage(), "dist", RESOURCES.BUNDLE),
        runnerEnv: { ELECTRON_RUN_AS_NODE: "1" },
        bundled: { node: process.execPath, claude: installedClaude() },
      };
  return { ...bare, sandboxed: sandboxedPlatform(bare, options.stateRoot, launcher) };
}
