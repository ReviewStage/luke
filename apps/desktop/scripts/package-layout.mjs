import path from "node:path";

export const PACKAGED_ARCHITECTURE = "arm64";

export const NATIVE_HELPERS = [
  {
    source: "MicrophoneRoute.swift",
    binary: "mac-microphone-route",
    frameworks: ["CoreAudio", "IOKit"],
  },
];

export const LIQUID_GLASS_ADDON = {
  packageName: "electron-liquid-glass",
  prebuild: path.join("prebuilds", "darwin-arm64", "node.napi.armv8.node"),
  binary: "liquid-glass.node",
};

export const NODE_PTY = {
  packageName: "node-pty",
  folder: "node-pty",
  prebuilds: path.join("prebuilds", `darwin-${PACKAGED_ARCHITECTURE}`),
  binaries: ["pty.node", "spawn-helper"],
};

export function packagedAppPath(repoRoot) {
  return path.join(
    repoRoot,
    "artifacts",
    "release-builder",
    `mac-${PACKAGED_ARCHITECTURE}`,
    "Vespin.app",
  );
}
