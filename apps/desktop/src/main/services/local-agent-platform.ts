import os from "node:os";
import path from "node:path";
import { SMOLVM_MAC_PIN } from "@luke/agent-runner/pins";
import { RUNNER_ENV, RUNNER_PLACE } from "@luke/agent-runner/protocol";
import {
  DEVICE_ARCH,
  DEVICE_CAPABILITY,
  DEVICE_ISOLATION,
  DEVICE_PLATFORM,
} from "@luke/features/device-agent-wire";
import type { LocalAgentPlatformSeam } from "@luke/host/effect";
import {
  agentUnsavedWorkScript,
  agentWorktreeScript,
  cloneFolder,
  macDeviceName,
  smolvmSandbox,
  worktreesRoot,
} from "@luke/host/node";
import { app } from "electron";
import { nativeHelperPath } from "../native/native-helper";

/**
 * local-agent-platform.ts -- what a local agent's runner is started with on this Mac (`@luke/host`'s `LocalAgentPlatform`): a smolvm VM per agent, started through the launcher, running the runner's bundle on the image's own Node, Claude Code, and Codex.
 *
 * Every agent runs in a VM of its own (`@luke/host/node`'s `smolvmSandbox`),
 * on the pinned smolvm fetched and checked under the app's state, with the
 * agent's folder and the runner's bundle mounted at their paths, and no
 * nested VMs, which a Mac's Hypervisor.framework never gives its guests.
 * Every `smolvm` command starts through `luke-agent-launcher`
 * (`native/macos/AgentLauncher.swift`), so the VM answers for its own
 * privacy decisions rather than taking Luke's microphone and Apple Events
 * grants. A packaged build mounts the bundle shipped in its resources
 * (`scripts/package-layout.mjs`'s `AGENT_RUNNER_RESOURCES`); a development
 * run mounts the one the start built. Nothing of the Mac's reaches a VM: it
 * runs on the sign-ins saved in Luke, GitHub through a token from Luke that
 * stays outside the VM, and a repository of its own rather than a worktree
 * of Luke's shared clone, whose Git folder no VM mounts. Agents ran directly
 * on the Mac before (`formerlyDirect`), whose folders may hold the only
 * copy of the developer's work, so a discard checks each folder first.
 */

const LAUNCHER = "luke-agent-launcher";

const RESOURCES = { DIRECTORY: "agent-runner", BUNDLE: "agent-runner.mjs" } as const;

/** The runner's package in the checkout a development run starts from. */
function runnerPackage(): string {
  return path.resolve(app.getAppPath(), "..", "..", "packages", "agent-runner");
}

export interface LocalAgentPlatformOptions {
  readonly packaged: boolean;
  /** Luke's state root, the host's own, under which the pinned smolvm and each agent's GitHub token are kept. */
  readonly stateRoot: string;
}

export function localAgentPlatform(options: LocalAgentPlatformOptions): LocalAgentPlatformSeam {
  const runnerBundle = options.packaged
    ? path.join(process.resourcesPath, RESOURCES.DIRECTORY, RESOURCES.BUNDLE)
    : path.join(runnerPackage(), "dist", RESOURCES.BUNDLE);
  const { uid, gid } = os.userInfo();
  const vm = smolvmSandbox({
    smolvm: SMOLVM_MAC_PIN,
    through: nativeHelperPath(LAUNCHER),
    stateRoot: options.stateRoot,
    runnerFolder: path.dirname(runnerBundle),
    // Note that every command in a VM runs as the developer, who owns the agent's folder it mounts.
    user: { uid, gid },
    nested: false,
  });
  return {
    launch: vm.launch,
    sandbox: vm.sandbox,
    runnerBundle,
    // Note that the harnesses run no sandbox of their own, since the VM is the boundary.
    runnerEnv: { [RUNNER_ENV.PLACE]: RUNNER_PLACE.HOST },
    deviceName: macDeviceName(),
    // Note that the app is built for Apple silicon alone (`package.json`'s `--mac --arm64`).
    devicePlatform: DEVICE_PLATFORM.DARWIN,
    deviceArch: DEVICE_ARCH.ARM64,
    deviceIsolation: DEVICE_ISOLATION.SANDBOX,
    deviceCapabilities: [DEVICE_CAPABILITY.DISCARD],
    worktreeScript: ({ home, repository, worktree, branch }) =>
      agentWorktreeScript({
        repository,
        clone: cloneFolder(worktreesRoot(home), repository),
        worktree,
        branch,
      }),
    // Note that only This Mac checks, since a folder of an agent that ran directly on it can hold the only copy of the developer's work.
    unsavedWorkScript: agentUnsavedWorkScript,
    formerlyDirect: true,
  };
}
