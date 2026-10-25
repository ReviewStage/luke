import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { LocalAgentPlatformSeam } from "@luke/host/effect";
import { agentWorktreeScript, cloneFolder, worktreesRoot } from "@luke/host/node";
import { app } from "electron";
import { nativeHelperPath } from "../native/native-helper";

/**
 * local-agent-platform.ts -- what a local agent's runner is started with on this Mac (`@luke/host`'s `LocalAgentPlatform`): the launcher, the Node, the runner's bundle, and the Claude Code CLI, packaged or from the checkout.
 *
 * Every runner starts through `luke-agent-launcher`
 * (`native/macos/AgentLauncher.swift`), so it answers for its own privacy
 * decisions rather than taking Luke's microphone and Apple Events grants.
 * A packaged build runs it on the Node, the bundle, and the CLI shipped in
 * its resources (`scripts/package-layout.mjs`'s `AGENT_RUNNER_RESOURCES`),
 * since its fuses burn off running the app itself as Node. A development
 * run, which keeps Electron's fuses, runs the bundle the start built under
 * Electron's own Node, and the CLI the runner's Agent SDK installed for
 * this Mac, pinned to the cloud's.
 */

const LAUNCHER = "luke-agent-launcher";

const RESOURCES = {
  DIRECTORY: "agent-runner",
  BUNDLE: "agent-runner.mjs",
  CLAUDE: "claude",
  NODE: "node",
} as const;

/** The runner's package in the checkout a development run starts from. */
function runnerPackage(): string {
  return path.resolve(app.getAppPath(), "..", "..", "packages", "agent-runner");
}

/**
 * The CLI the runner's Agent SDK installed for this Mac: its macOS package
 * is the SDK's own dependency, so it is found from the SDK rather than the
 * runner. A checkout that has none, as off a Mac, names where it would be,
 * and a launch there fails as the CLI's.
 */
function installedClaude(): string {
  const platformPackage = "@anthropic-ai/claude-agent-sdk-darwin-arm64";
  try {
    const sdk = createRequire(path.join(runnerPackage(), "package.json")).resolve(
      "@anthropic-ai/claude-agent-sdk",
    );
    return createRequire(sdk).resolve(`${platformPackage}/${RESOURCES.CLAUDE}`);
  } catch {
    return path.join(runnerPackage(), "node_modules", platformPackage, RESOURCES.CLAUDE);
  }
}

/** The Mac's name as Start offers it: its host name without the `.local` Bonjour adds. */
function deviceName(): string {
  const name = os.hostname().replace(/\.local$/u, "");
  return name.length > 0 ? name : "This Mac";
}

export function localAgentPlatform(packaged: boolean): LocalAgentPlatformSeam {
  const launcher = nativeHelperPath(LAUNCHER);
  const shipped = path.join(process.resourcesPath, RESOURCES.DIRECTORY);
  const runner = packaged
    ? {
        program: launcher,
        args: [path.join(shipped, RESOURCES.NODE), path.join(shipped, RESOURCES.BUNDLE)],
        env: {},
      }
    : {
        program: launcher,
        args: [process.execPath, path.join(runnerPackage(), "dist", RESOURCES.BUNDLE)],
        env: { ELECTRON_RUN_AS_NODE: "1" },
      };
  const claudeExecutable = packaged ? path.join(shipped, RESOURCES.CLAUDE) : installedClaude();
  return {
    runner,
    claudeExecutable,
    deviceName: deviceName(),
    worktreeScript: ({ home, repository, worktree, branch }) =>
      agentWorktreeScript({
        repository,
        clone: cloneFolder(worktreesRoot(home), repository),
        worktree,
        branch,
      }),
  };
}
