import path from "node:path";

export const PACKAGED_ARCHITECTURE = "arm64";

/**
 * The native helpers, named once. Each is a native source and the binary it
 * becomes: the build compiles this list and packaging ships it, so a helper
 * cannot be built without reaching the bundle or shipped without being built.
 * Each Swift source becomes a standalone executable the app spawns.
 */
export const NATIVE_HELPERS = [
  { source: "MediaDuck.swift", binary: "mac-media-duck", frameworks: ["AppKit"] },
  {
    source: "MicrophoneRoute.swift",
    binary: "mac-microphone-route",
    frameworks: ["CoreAudio", "IOKit"],
  },
  { source: "OutputVolume.swift", binary: "mac-output-volume", frameworks: ["CoreAudio"] },
  // A local agent's runner started so it answers for its own privacy decisions, not Luke's.
  { source: "AgentLauncher.swift", binary: "luke-agent-launcher", frameworks: [] },
];

/**
 * What a local agent's runner runs on in a packaged build, under one folder
 * of the app's resources (`src/main/services/local-agent-platform.ts`): the
 * runner's bundle (`packages/agent-runner`), the Claude Code CLI its Agent
 * SDK drives, pinned to the cloud's (`@luke/agent-runner/pins`), and a Node
 * of its own, since the packaged app burns off running itself as Node. Each
 * binary is signed beside the helpers.
 */
export const AGENT_RUNNER_RESOURCES = {
  directory: "agent-runner",
  bundle: "agent-runner.mjs",
  claude: "claude",
  node: "node",
};

/**
 * The Node the packaged runner runs on: the release the runner's bundle
 * targets (`node24`), its macOS arm64 archive from nodejs.org, and the
 * archive's SHA-256 from that release's `SHASUMS256.txt`, which a download is
 * checked against before anything in it is used. A bump moves all three.
 */
export const RUNNER_NODE = {
  version: "24.22.1",
  archive: "node-v24.22.1-darwin-arm64.tar.gz",
  sha256: "89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7",
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
