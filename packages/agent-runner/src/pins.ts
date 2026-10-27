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
 * smolvm on a Mac whose local agents run sandboxed, one VM each: the
 * release step 0 and the launcher's hand test passed on, as its GitHub
 * release keeps the macOS arm64 build. The whole folder is kept, since the
 * `smolvm` wrapper runs `smolvm-bin` beside it with the `lib/` it links, the
 * `agent-rootfs/` it boots, and the disk templates it copies. Its binary is
 * signed ad hoc with the hypervisor entitlement and no Developer ID team,
 * so its digest alone decides.
 */
export const SMOLVM_MAC_PIN: AgentToolPin = {
  NAME: "smolvm",
  VERSION: "1.32.3",
  ARCHIVE:
    "https://github.com/smol-machines/smolvm/releases/download/v1.32.3/smolvm-1.32.3-darwin-arm64.tar.gz",
  SHA256: "5d307f7df82886ccb48f3a3b3c77ff35dbeb00fc7dcdde8aa0d1d8b6fdb2d7f6",
  BYTES: 41_229_365,
  ROOT: "smolvm-1.32.3-darwin-arm64",
  MEMBERS: [
    "smolvm",
    "smolvm-bin",
    "lib",
    "agent-rootfs",
    "storage-template.ext4.zst",
    "overlay-template.ext4.zst",
  ],
  BINARY: "smolvm",
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
 * smolvm on a host (`apps/host`), which runs every agent in a VM of its own: the
 * release the install script fetches and checks, by the SHA-256 of each
 * architecture's tarball as smolvm's own release lists them
 * (`checksums.sha256`), and the version the daemon requires the box's
 * `smolvm` to answer `--version` with. `apps/web/install/install.sh` carries
 * the same version, addresses, and digests as literals, which a test holds
 * to these. A bump moves them together.
 */
export const SMOLVM_LINUX_PIN = {
  VERSION: "1.32.3",
  ARCHIVE: {
    x64: "https://github.com/smol-machines/smolvm/releases/download/v1.32.3/smolvm-1.32.3-linux-x86_64.tar.gz",
    arm64:
      "https://github.com/smol-machines/smolvm/releases/download/v1.32.3/smolvm-1.32.3-linux-arm64.tar.gz",
  },
  SHA256: {
    x64: "82b50f55b35828efbf02ec84c22274780be109c7f424a24646390abc44506afe",
    arm64: "baea200aea86c405e31afd3a6f278b3bcf6370ea252d35e66b90ba3e849b9721",
  },
} as const;

/** Luke's sandbox image, as CI publishes it from the cloud's own setup script, pinned by digest: what every host agent's VM boots, and what the install script fetches ahead of the first. */
export const SANDBOX_IMAGE =
  "ghcr.io/reviewstage/luke-sandbox:35c90fc1c0bee4e5@sha256:168aedd03509fa3bccb00b84059baea6d19ae7032a7f0ad0c46f43b6a8bf21e0";
