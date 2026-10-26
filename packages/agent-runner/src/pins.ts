/**
 * pins.ts -- what a coding agent's sandbox pins of Claude Code and Codex: their versions and where the image puts them, read by the image, the sessions, and the protocol generator alike.
 *
 * The image (`@luke/service`'s `agent-runtime/sandbox-image.ts`) installs
 * exactly these, the sessions (`claude-code-sessions.ts`,
 * `codex-sessions.ts`) point the runner at the paths, the runner bundles
 * the same Agent SDK (this package's `package.json`), and Codex's
 * app-server protocol types are generated from the same Codex
 * (`scripts/generate-codex-protocol.mjs`). A bump moves them together. A local
 * agent's Mac fetches its own builds of the same releases, each a
 * `MacToolPin` checked by size, digest, and signature before it is kept
 * (`@luke/host`'s `localAgentTool`). Erasable syntax
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
 * A binary a local agent's Mac fetches once and keeps (`@luke/host`'s
 * `localAgentTool`), checked before anything in it is kept: an archive at a
 * pinned address, its exact size and SHA-256, and what of it is kept. A bump
 * moves every field together, its digest and size read off the release
 * itself.
 */
export interface MacToolPin {
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
export const NODE_MAC_PIN: MacToolPin = {
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
export const CLAUDE_CODE_MAC_PIN: MacToolPin = {
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
