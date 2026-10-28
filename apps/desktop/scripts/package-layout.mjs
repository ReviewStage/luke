import path from "node:path";

export const PACKAGED_ARCHITECTURE = "arm64";

/** The folders of the app's `Contents` a native helper is shipped in. */
export const BUNDLE_FOLDER = {
  RESOURCES: "Resources",
  MAC_OS: "MacOS",
};

/**
 * The native helpers, named once. Each is a native source, the binary it
 * becomes, and the folder of the app's `Contents` it ships in: the build
 * compiles this list and packaging ships it, so a helper cannot be built
 * without reaching the bundle or shipped without being built. Each Swift
 * source becomes a standalone executable the app spawns.
 */
export const NATIVE_HELPERS = [
  {
    source: "MicrophoneRoute.swift",
    binary: "mac-microphone-route",
    frameworks: ["CoreAudio", "IOKit"],
    folder: BUNDLE_FOLDER.RESOURCES,
  },
  // This Mac's `luke-host` command and login item (`HOST_LOGIN_ITEM`), in
  // `MacOS`, where `Bundle.main` is the app `SMAppService` registers it for.
  {
    source: "HostLoginItem.swift",
    binary: "luke-host",
    frameworks: ["ServiceManagement"],
    folder: BUNDLE_FOLDER.MAC_OS,
  },
];

/**
 * Luke's host daemon as this Mac runs it (`apps/host`): its release folder,
 * staged by the host's own packaging (`scripts/build-host.mjs`) and shipped
 * whole in the app's resources, holding the daemon's and the runner's
 * bundles under `lib/` and the pinned Node they run on, which the app signs
 * as a binary of its own. The login item that runs it is a launchd job in
 * the app's `Contents/Library/LaunchAgents`, whose program is the
 * `luke-host` helper above.
 */
export const HOST_RESOURCES = {
  directory: "luke-host",
  node: path.join("node", "bin", "node"),
  bundle: path.join("lib", "luke-host.mjs"),
  runner: path.join("lib", "agent-runner.mjs"),
};

export const HOST_LOGIN_ITEM = {
  plist: "dev.reviewstage.luke.host.plist",
  folder: path.join("Library", "LaunchAgents"),
};

/**
 * The local agents' runner bundle (`packages/agent-runner`), shipped in the
 * app's resources, which This Mac's `luke-host` mounts into its agents' VMs
 * (`@luke/host/daemon`'s `host-os.ts`), as every VM the app made before it
 * does. The Node it runs on and the Claude Code CLI it drives are the
 * sandbox image's own.
 */
export const AGENT_RUNNER_RESOURCES = {
  directory: "agent-runner",
  bundle: "agent-runner.mjs",
};

/**
 * macOS 26's Liquid Glass, laid behind the panel window
 * (`src/main/native/liquid-glass.ts`): `electron-liquid-glass`'s prebuilt
 * N-API addon for the packaged architecture, copied beside the helpers by
 * the native build and shipped and signed as they are. The package's own
 * JavaScript is not bundled; the main process loads the addon itself.
 */
export const LIQUID_GLASS_ADDON = {
  packageName: "electron-liquid-glass",
  prebuild: path.join("prebuilds", "darwin-arm64", "node.napi.armv8.node"),
  binary: "liquid-glass.node",
  folder: BUNDLE_FOLDER.RESOURCES,
};

export function packagedAppPath(repoRoot) {
  return path.join(
    repoRoot,
    "artifacts",
    "release-builder",
    `mac-${PACKAGED_ARCHITECTURE}`,
    "Luke.app",
  );
}
