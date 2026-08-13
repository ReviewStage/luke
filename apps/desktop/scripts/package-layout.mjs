import path from "node:path";

export const PACKAGED_ARCHITECTURE = "arm64";

/**
 * The native helpers, named once. Each is a Swift source and the binary it
 * becomes: the build compiles this list and the packager ships it, so a helper
 * cannot be built without reaching the bundle or shipped without being built.
 */
export const NATIVE_HELPERS = [
  { source: "ScreenGeometry.swift", binary: "mac-screen-geometry", frameworks: ["AppKit"] },
  {
    source: "TalkKey.swift",
    binary: "mac-talk-key",
    frameworks: ["AppKit", "Carbon"],
  },
];

export const packageIgnorePatterns = [
  /^\/(?:\.build|native|node_modules|out|scripts|src|tests)(?:$|\/)/,
  /^\/(?:\.gitignore|pnpm-lock\.yaml|tsconfig\.json)$/,
  /\.map$/,
];

export function packagedAppExecutable(repoRoot, architecture = PACKAGED_ARCHITECTURE) {
  return path.join(
    repoRoot,
    "apps",
    "desktop",
    "out",
    `Luke-darwin-${architecture}`,
    "Luke.app",
    "Contents",
    "MacOS",
    "Luke",
  );
}
