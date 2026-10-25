import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { BRAND_ASSETS_DIRECTORY } from "@luke/brand/assets-directory";
import { DMG_WINDOW } from "@luke/brand/dmg-window";
import { buildAppIcon } from "./app-icon.mjs";
import { LICENSE_RESOURCE_NAME, NOTICE_RESOURCE_NAME } from "./package-config.mjs";
import {
  AGENT_RUNNER_RESOURCES,
  LIQUID_GLASS_ADDON,
  NATIVE_HELPERS,
  RUNNER_NODE,
} from "./package-layout.mjs";

export function packageAssetPaths({ appRoot }) {
  const helperPaths = [...NATIVE_HELPERS, LIQUID_GLASS_ADDON].map((helper) =>
    path.join(appRoot, ".build", "native", helper.binary),
  );
  const iconPath = path.join(appRoot, ".build", "Luke.icns");
  const licensePath = path.join(appRoot, ".build", LICENSE_RESOURCE_NAME);
  const noticePath = path.join(appRoot, ".build", NOTICE_RESOURCE_NAME);
  const entitlementsPath = path.join(appRoot, "native", "macos", "entitlements.plist");
  const agentRunnerPath = path.join(appRoot, ".build", AGENT_RUNNER_RESOURCES.directory);
  const dmgBackgroundPath = path.join(
    appRoot,
    ".build",
    "electron-builder",
    DMG_WINDOW.BACKGROUND.FILE_NAME,
  );
  return {
    appRoot,
    helperPaths,
    iconPath,
    licensePath,
    noticePath,
    entitlementsPath,
    dmgBackgroundPath,
    agentRunnerPath,
  };
}

export function preparePackageAssets({ repoRoot, paths }) {
  for (const helperPath of paths.helperPaths) {
    // A helper missing here is a feature missing at runtime with no other sign of
    // it, so the package fails rather than shipping without one.
    if (!fs.existsSync(helperPath)) {
      throw new Error(`macOS helper is missing: ${helperPath}`);
    }
  }

  prepareAgentRunnerAssets({ repoRoot, paths });
  fs.mkdirSync(path.dirname(paths.licensePath), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "LICENSE"), paths.licensePath);
  fs.copyFileSync(path.join(repoRoot, "NOTICE"), paths.noticePath);
  buildAppIcon(paths.appRoot);
}

export function prepareElectronBuilderDmgAssets({ paths }) {
  const dmgBackgroundDirectory = path.join(BRAND_ASSETS_DIRECTORY, "dmg");
  fs.mkdirSync(path.dirname(paths.dmgBackgroundPath), { recursive: true });
  execFileSync(
    "tiffutil",
    [
      "-cathidpicheck",
      path.join(dmgBackgroundDirectory, "luke-dmg-background.png"),
      path.join(dmgBackgroundDirectory, "luke-dmg-background@2x.png"),
      "-out",
      paths.dmgBackgroundPath,
    ],
    { stdio: "inherit" },
  );
}

/** The SHA-256 of a file, in hex. */
function sha256Of(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * What a local agent's runner runs on, gathered under the build's
 * `agent-runner` folder for packaging: the runner's bundle, which the package
 * script builds first; the Claude Code CLI from the Agent SDK's macOS package
 * the runner installed, which must be the very SDK the runner pins, so the
 * Mac runs the cloud's Claude Code; and Node, downloaded once into the
 * build's cache and used only where its archive matches `RUNNER_NODE`'s
 * checksum. Any of them missing or mismatched fails the package rather than
 * shipping a Mac that cannot run an agent.
 */
function prepareAgentRunnerAssets({ repoRoot, paths }) {
  const runnerRoot = path.join(repoRoot, "packages", "agent-runner");
  const bundle = path.join(runnerRoot, "dist", AGENT_RUNNER_RESOURCES.bundle);
  if (!fs.existsSync(bundle)) {
    throw new Error(`The agent runner's bundle is missing: ${bundle}`);
  }
  const runnerPackage = JSON.parse(fs.readFileSync(path.join(runnerRoot, "package.json"), "utf8"));
  const pinned = runnerPackage.dependencies["@anthropic-ai/claude-agent-sdk"];
  // Note that the macOS package is the SDK's own dependency, so it is found from the SDK.
  const sdk = createRequire(path.join(runnerRoot, "package.json")).resolve(
    "@anthropic-ai/claude-agent-sdk",
  );
  const platformPackage = createRequire(sdk).resolve(
    "@anthropic-ai/claude-agent-sdk-darwin-arm64/package.json",
  );
  const { version } = JSON.parse(fs.readFileSync(platformPackage, "utf8"));
  if (version !== pinned) {
    throw new Error(
      `Claude Code for macOS is ${version}, but the runner pins the SDK at ${pinned}`,
    );
  }
  const claude = path.join(path.dirname(platformPackage), "claude");

  const cache = path.join(path.dirname(paths.agentRunnerPath), "agent-runner-cache");
  const archive = path.join(cache, RUNNER_NODE.archive);
  fs.mkdirSync(cache, { recursive: true });
  if (!fs.existsSync(archive) || sha256Of(archive) !== RUNNER_NODE.sha256) {
    execFileSync(
      "curl",
      [
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--output",
        archive,
        `https://nodejs.org/dist/v${RUNNER_NODE.version}/${RUNNER_NODE.archive}`,
      ],
      { stdio: "inherit" },
    );
  }
  if (sha256Of(archive) !== RUNNER_NODE.sha256) {
    fs.rmSync(archive, { force: true });
    throw new Error(`The Node archive did not match its checksum: ${RUNNER_NODE.archive}`);
  }
  const member = `${RUNNER_NODE.archive.replace(/\.tar\.gz$/u, "")}/bin/node`;
  execFileSync("tar", ["-xzf", archive, "-C", cache, member], { stdio: "inherit" });

  fs.rmSync(paths.agentRunnerPath, { recursive: true, force: true });
  fs.mkdirSync(paths.agentRunnerPath, { recursive: true });
  fs.copyFileSync(bundle, path.join(paths.agentRunnerPath, AGENT_RUNNER_RESOURCES.bundle));
  for (const [from, name] of [
    [claude, AGENT_RUNNER_RESOURCES.claude],
    [path.join(cache, member), AGENT_RUNNER_RESOURCES.node],
  ]) {
    const to = path.join(paths.agentRunnerPath, name);
    fs.copyFileSync(from, to);
    fs.chmodSync(to, 0o755);
  }
}
