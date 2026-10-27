/**
 * pins.ts -- what a coding agent's sandbox pins of Claude Code and Codex: their versions and where the image puts them, read by the image, the sessions, and the protocol generator alike.
 *
 * The image (`@luke/service`'s `agent-runtime/sandbox-image.ts`) installs
 * exactly these, the sessions (`claude-code-sessions.ts`,
 * `codex-sessions.ts`) point the runner at the paths, the runner bundles
 * the same Agent SDK (this package's `package.json`), and Codex's
 * app-server protocol types are generated from the same Codex
 * (`scripts/generate-codex-protocol.mjs`). A bump moves them together. A local
 * agent's Mac, and a host, fetches its own builds of the same releases, each
 * an `AgentToolPin` checked by size, digest, and signature where it has one
 * before it is kept (`@luke/host`'s `localAgentTool`). Erasable syntax
 * alone, so Node runs the generator over it as it stands.
 */

/** The unprivileged user the harness runs as, which the image creates. */
export const AGENT_USER = "agent";

/** Where each launch installs the runner's bundle: a directory the image makes root-owned, so no Terminal's shell, the default user's, can swap what runs as `agent`. */
export const RUNNER_DIRECTORY = "/opt/luke/agent-runner";

/**
 * The Claude Agent SDK, pinned exactly, and the `claude` binary its
 * platform package carries (the SDK's own `claudeCodeVersion`), so
 * installing the one installs the other. Installed as root in a directory
 * only root writes; the binary is the Linux x86-64 build, the Vercel
 * sandbox's architecture.
 */
export const CLAUDE_CODE_PIN = {
  SDK_VERSION: "0.3.304",
  VERSION: "2.1.304",
  DIRECTORY: "/opt/luke/claude-agent-sdk",
  /** The binary, under `DIRECTORY`. */
  BINARY: "node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude",
  /** The Linux arm64 build's binary, under `DIRECTORY`, which the OCI image built for arm64 links as `claude` instead. */
  ARM64_BINARY: "node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64/claude",
  /** Where the image links the binary as `claude`. */
  LINK: "/usr/local/bin/claude",
} as const;

/** The binary's whole path, which the runner hands the SDK, since the bundled SDK cannot find it on its own. */
export const CLAUDE_EXECUTABLE = `${CLAUDE_CODE_PIN.DIRECTORY}/${CLAUDE_CODE_PIN.BINARY}`;

/**
 * Codex, pinned exactly, installed as root under a prefix only root writes.
 * Its `CODEX_HOME` is in `agent`'s home, on the sandbox's persisted disk, so
 * the threads it keeps there outlive a stop.
 */
export const CODEX_PIN = {
  VERSION: "0.163.0",
  DIRECTORY: "/opt/luke/codex",
  /** Where the image links the binary as `codex`. */
  LINK: "/usr/local/bin/codex",
  HOME: `/home/${AGENT_USER}/.codex`,
} as const;

/**
 * A binary a local agent's Mac or host fetches once and keeps (`@luke/host`'s
 * `localAgentTool`), checked before anything in it is kept: an archive at a
 * pinned address, its exact size and SHA-256, and what of it is kept. A bump
 * moves every field together, its digest and size read off the release
 * itself.
 */
export interface AgentToolPin {
  /** The folder it is kept under, beside the other tools. */
  readonly NAME: string;
  /** The folder under `NAME` this release is kept in. */
  readonly VERSION: string;
  /** The archive, a gzipped tar, by its https address. */
  readonly ARCHIVE: string;
  /** The archive's SHA-256, in hex: what decides whether anything of it is kept. */
  readonly SHA256: string;
  /** The archive's exact size; an answer past it is refused as it arrives. */
  readonly BYTES: number;
  /** The archive's folder the kept build is. */
  readonly ROOT: string;
  /** The paths under `ROOT` kept, their layout kept. */
  readonly MEMBERS: readonly string[];
  /** The executable, under the kept folder. */
  readonly BINARY: string;
  /**
   * The Developer ID team the binary is signed by, as read off the pinned
   * release, which macOS's own check must name before it is first run; none
   * where the release is not signed, and its digest alone decides.
   */
  readonly TEAM?: string;
}

/** The Node a local agent's runner runs on, on a Mac: the release the runner's bundle targets (`node24`), signed by the Node.js Foundation. */
export const NODE_MAC_PIN: AgentToolPin = {
  NAME: "node",
  VERSION: "24.22.1",
  ARCHIVE: "https://nodejs.org/dist/v24.22.1/node-v24.22.1-darwin-arm64.tar.gz",
  SHA256: "89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7",
  BYTES: 53_062_778,
  ROOT: "node-v24.22.1-darwin-arm64",
  MEMBERS: ["bin/node"],
  BINARY: "bin/node",
  TEAM: "HX7739G8FX",
};

/**
 * Claude Code on a Mac: the macOS arm64 build of the very Agent SDK the
 * runner pins (`CLAUDE_CODE_PIN.SDK_VERSION`), as npm keeps it, signed by
 * Anthropic.
 */
export const CLAUDE_CODE_MAC_PIN: AgentToolPin = {
  NAME: "claude",
  VERSION: CLAUDE_CODE_PIN.SDK_VERSION,
  ARCHIVE: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-arm64/-/claude-agent-sdk-darwin-arm64-${CLAUDE_CODE_PIN.SDK_VERSION}.tgz`,
  SHA256: "cdca064e1bbe6001c5d8bbefd636205379c79b8d05bf41a3a37fc1fde096a93d",
  BYTES: 120_586_636,
  ROOT: "package",
  MEMBERS: ["claude"],
  BINARY: "claude",
  TEAM: "Q6L2SF6YDW",
};

/**
 * Codex on a Mac: the same release as the sandbox's (`CODEX_PIN.VERSION`),
 * as npm keeps its macOS arm64 package, signed by OpenAI, the members of the
 * build under `ROOT` kept as the archive lays them out, so the binary finds
 * its `codex-path` tools beside it.
 */
export const CODEX_MAC_PIN: AgentToolPin = {
  NAME: "codex",
  VERSION: CODEX_PIN.VERSION,
  ARCHIVE: `https://registry.npmjs.org/@openai/codex/-/codex-${CODEX_PIN.VERSION}-darwin-arm64.tgz`,
  SHA256: "1193ff4ce72387a5d6c34820b54a9dc57d007c67a958e8acb4715924facd3c31",
  BYTES: 137_871_195,
  ROOT: "package/vendor/aarch64-apple-darwin",
  MEMBERS: ["bin/codex", "bin/codex-code-mode-host", "codex-path/rg", "codex-package.json"],
  BINARY: "bin/codex",
  TEAM: "2DC432GLL2",
};

/**
 * A tool's builds for a host (`apps/host`), one per architecture it runs on,
 * by Node's `process.arch` names (`@luke/features/device-agent-wire`'s
 * `DEVICE_ARCH`). None is signed, so each digest alone decides.
 */
export interface LinuxToolPins {
  readonly x64: AgentToolPin;
  readonly arm64: AgentToolPin;
}

/**
 * The Node a host's daemon and its runners run on: the Mac's release
 * (`NODE_MAC_PIN`), as nodejs.org keeps its Linux builds, which the host's
 * release carries (`apps/host/scripts/package.ts`) rather than fetches.
 */
export const NODE_LINUX_PINS: LinuxToolPins = {
  x64: {
    NAME: "node",
    VERSION: NODE_MAC_PIN.VERSION,
    ARCHIVE: `https://nodejs.org/dist/v${NODE_MAC_PIN.VERSION}/node-v${NODE_MAC_PIN.VERSION}-linux-x64.tar.gz`,
    SHA256: "eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c",
    BYTES: 58_290_700,
    ROOT: `node-v${NODE_MAC_PIN.VERSION}-linux-x64`,
    MEMBERS: ["bin/node"],
    BINARY: "bin/node",
  },
  arm64: {
    NAME: "node",
    VERSION: NODE_MAC_PIN.VERSION,
    ARCHIVE: `https://nodejs.org/dist/v${NODE_MAC_PIN.VERSION}/node-v${NODE_MAC_PIN.VERSION}-linux-arm64.tar.gz`,
    SHA256: "33c37be234ba8bee041961047b19160f4d7d0f164e8e246f78bdd10feff148b3",
    BYTES: 58_021_129,
    ROOT: `node-v${NODE_MAC_PIN.VERSION}-linux-arm64`,
    MEMBERS: ["bin/node"],
    BINARY: "bin/node",
  },
};

/** Claude Code on a host: the glibc Linux builds of the very Agent SDK the runner pins, as npm keeps them. */
export const CLAUDE_CODE_LINUX_PINS: LinuxToolPins = {
  x64: {
    NAME: "claude",
    VERSION: CLAUDE_CODE_PIN.SDK_VERSION,
    ARCHIVE: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-x64/-/claude-agent-sdk-linux-x64-${CLAUDE_CODE_PIN.SDK_VERSION}.tgz`,
    SHA256: "214fcde96f46b9b76f4acc9efbd65b843c90ae9a689da224c33f09a77e069395",
    BYTES: 130_438_422,
    ROOT: "package",
    MEMBERS: ["claude"],
    BINARY: "claude",
  },
  arm64: {
    NAME: "claude",
    VERSION: CLAUDE_CODE_PIN.SDK_VERSION,
    ARCHIVE: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-arm64/-/claude-agent-sdk-linux-arm64-${CLAUDE_CODE_PIN.SDK_VERSION}.tgz`,
    SHA256: "429cfc8eca03f6e26bc5ca698994b7089c5d1fa345899d5beb96cc88173b544c",
    BYTES: 130_978_746,
    ROOT: "package",
    MEMBERS: ["claude"],
    BINARY: "claude",
  },
};

/**
 * Codex on a host: the sandbox's release, as npm keeps its Linux packages,
 * static musl builds, the members under `ROOT` kept as the archive lays them
 * out, so the binary finds its `codex-path` tools and its own bubblewrap
 * beside it.
 */
export const CODEX_LINUX_PINS: LinuxToolPins = {
  x64: {
    NAME: "codex",
    VERSION: CODEX_PIN.VERSION,
    ARCHIVE: `https://registry.npmjs.org/@openai/codex/-/codex-${CODEX_PIN.VERSION}-linux-x64.tgz`,
    SHA256: "30efc97738b975940d78b59a9bea115fa34040b732807d54ec35ae6b7528de94",
    BYTES: 162_055_867,
    ROOT: "package/vendor/x86_64-unknown-linux-musl",
    MEMBERS: [
      "bin/codex",
      "bin/codex-code-mode-host",
      "codex-path/rg",
      "codex-package.json",
      "codex-resources/bwrap",
    ],
    BINARY: "bin/codex",
  },
  arm64: {
    NAME: "codex",
    VERSION: CODEX_PIN.VERSION,
    ARCHIVE: `https://registry.npmjs.org/@openai/codex/-/codex-${CODEX_PIN.VERSION}-linux-arm64.tgz`,
    SHA256: "dc6e7c4d6de71c23a0f60d05e2577ff7eef615b76f22630d58ad384b84763522",
    BYTES: 154_715_729,
    ROOT: "package/vendor/aarch64-unknown-linux-musl",
    MEMBERS: [
      "bin/codex",
      "bin/codex-code-mode-host",
      "codex-path/rg",
      "codex-package.json",
      "codex-resources/bwrap",
    ],
    BINARY: "bin/codex",
  },
};

/**
 * GitHub's CLI on a host, which each agent's `gh` and git's credential
 * helper are, as cli/cli's release keeps its static Linux builds; the host's
 * release carries it (`apps/host/scripts/package.ts`).
 */
export const GH_LINUX_PINS: LinuxToolPins = {
  x64: {
    NAME: "gh",
    VERSION: "2.103.3",
    ARCHIVE: "https://github.com/cli/cli/releases/download/v2.103.3/gh_2.103.3_linux_amd64.tar.gz",
    SHA256: "4c806978ffce1cec70853302a56d70ac6da4f19bae7adca4e1a8ab00633dd91d",
    BYTES: 15_031_972,
    ROOT: "gh_2.103.3_linux_amd64",
    MEMBERS: ["bin/gh"],
    BINARY: "bin/gh",
  },
  arm64: {
    NAME: "gh",
    VERSION: "2.103.3",
    ARCHIVE: "https://github.com/cli/cli/releases/download/v2.103.3/gh_2.103.3_linux_arm64.tar.gz",
    SHA256: "ee32df2323c8847f5fac6cb6b4b69ca75828e9329a8f22f677021f7b3306ce63",
    BYTES: 13_661_485,
    ROOT: "gh_2.103.3_linux_arm64",
    MEMBERS: ["bin/gh"],
    BINARY: "bin/gh",
  },
};
