import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { LocalAgentPlatformSeam } from "@luke/host/effect";
import { agentWorktreeScript, cloneFolder, worktreesRoot } from "@luke/host/node";
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

export function localAgentPlatform(packaged: boolean): LocalAgentPlatformSeam {
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
  const shared = {
    launcher: nativeHelperPath(LAUNCHER),
    deviceName: deviceName(),
    worktreeScript,
  };
  return packaged
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
}
