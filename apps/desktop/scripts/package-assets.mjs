import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BRAND_ASSETS_DIRECTORY } from "@luke/brand/assets-directory";
import { DMG_WINDOW } from "@luke/brand/dmg-window";
import { buildAppIcon } from "./app-icon.mjs";
import { LICENSE_RESOURCE_NAME, NOTICE_RESOURCE_NAME } from "./package-config.mjs";
import {
  AGENT_RUNNER_RESOURCES,
  HOST_LOGIN_ITEM,
  HOST_RESOURCES,
  LIQUID_GLASS_ADDON,
  NATIVE_HELPERS,
} from "./package-layout.mjs";

export function packageAssetPaths({ appRoot }) {
  const helpers = [...NATIVE_HELPERS, LIQUID_GLASS_ADDON].map((helper) => ({
    path: path.join(appRoot, ".build", "native", helper.binary),
    binary: helper.binary,
    folder: helper.folder,
  }));
  const iconPath = path.join(appRoot, ".build", "Luke.icns");
  const licensePath = path.join(appRoot, ".build", LICENSE_RESOURCE_NAME);
  const noticePath = path.join(appRoot, ".build", NOTICE_RESOURCE_NAME);
  const entitlementsPath = path.join(appRoot, "native", "macos", "entitlements.plist");
  const agentRunnerPath = path.join(appRoot, ".build", AGENT_RUNNER_RESOURCES.directory);
  const hostPath = path.join(appRoot, ".build", HOST_RESOURCES.directory);
  const hostLoginItemPath = path.join(appRoot, "native", "macos", HOST_LOGIN_ITEM.plist);
  const dmgBackgroundPath = path.join(
    appRoot,
    ".build",
    "electron-builder",
    DMG_WINDOW.BACKGROUND.FILE_NAME,
  );
  return {
    appRoot,
    helpers,
    iconPath,
    licensePath,
    noticePath,
    entitlementsPath,
    dmgBackgroundPath,
    agentRunnerPath,
    hostPath,
    hostLoginItemPath,
  };
}

export function preparePackageAssets({ repoRoot, paths }) {
  for (const helper of paths.helpers) {
    // A helper missing here is a feature missing at runtime with no other sign of
    // it, so the package fails rather than shipping without one.
    if (!fs.existsSync(helper.path)) {
      throw new Error(`macOS helper is missing: ${helper.path}`);
    }
  }

  prepareAgentRunnerAssets({ repoRoot, paths });
  checkHostAssets({ paths });
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

/**
 * The local agents' runner bundle, which the package script builds first,
 * gathered under the build's `agent-runner` folder for packaging; one
 * missing fails the package rather than shipping a Mac that cannot run an
 * agent.
 */
function prepareAgentRunnerAssets({ repoRoot, paths }) {
  const bundle = path.join(
    repoRoot,
    "packages",
    "agent-runner",
    "dist",
    AGENT_RUNNER_RESOURCES.bundle,
  );
  if (!fs.existsSync(bundle)) {
    throw new Error(`The agent runner's bundle is missing: ${bundle}`);
  }
  fs.rmSync(paths.agentRunnerPath, { recursive: true, force: true });
  fs.mkdirSync(paths.agentRunnerPath, { recursive: true });
  fs.copyFileSync(bundle, path.join(paths.agentRunnerPath, AGENT_RUNNER_RESOURCES.bundle));
}

/**
 * The host daemon's release folder, which the package script stages first
 * (`build-host.mjs`); a file of it missing fails the package rather than
 * shipping a login item with nothing to run.
 */
function checkHostAssets({ paths }) {
  for (const file of [HOST_RESOURCES.node, HOST_RESOURCES.bundle, HOST_RESOURCES.runner]) {
    const staged = path.join(paths.hostPath, file);
    if (!fs.existsSync(staged)) throw new Error(`The host daemon's release is missing ${staged}`);
  }
}
