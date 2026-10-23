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
];

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

export function packagedAppPath(repoRoot, architecture = PACKAGED_ARCHITECTURE) {
  return path.join(repoRoot, "artifacts", "release-builder", `mac-${architecture}`, "Luke.app");
}

export function packagedAppExecutable(repoRoot, architecture = PACKAGED_ARCHITECTURE) {
  return path.join(packagedAppPath(repoRoot, architecture), "Contents", "MacOS", "Luke");
}
