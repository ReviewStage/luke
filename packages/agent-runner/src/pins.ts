/**
 * pins.ts -- what a coding agent's sandbox pins of Claude Code and Codex: their versions and where the image puts them, read by the image, the sessions, and the protocol generator alike.
 *
 * The image (`@luke/service`'s `agent-runtime/sandbox-image.ts`) installs
 * exactly these, the sessions (`claude-code-sessions.ts`,
 * `codex-sessions.ts`) point the runner at the paths, the runner bundles
 * the same Agent SDK (this package's `package.json`), and Codex's
 * app-server protocol types are generated from the same Codex
 * (`scripts/generate-codex-protocol.mjs`). A bump moves them together. A
 * local agent runs in a VM booted from that same image (`SANDBOX_IMAGE`);
 * what a device fetches or carries of its own, smolvm and a host's Node, is
 * an `AgentToolPin` checked by size and digest before it is kept
 * (`@luke/host`'s `localAgentTool`). Erasable syntax alone, so Node runs the
 * generator over it as it stands.
 */

/** The unprivileged user the harness runs as, which the image creates. */
export const AGENT_USER = "agent";

/**
 * Where an agent saves a file Luke reads back, a screenshot it shows or a
 * page it posts: a folder each launch makes `agent`'s and world-readable,
 * which Claude Code's command sandbox may write, since Luke reads a file as
 * the sandbox's default user and the CLI's own temp folder
 * (`/tmp/claude-<uid>`) is private to `agent`.
 */
export const SHARED_FILES_DIRECTORY = "/tmp/luke";

/**
 * Playwright as the image installs it, where every user of every machine
 * reaches it: the package and its `playwright` command under `/usr/local`,
 * on every PATH and in `NODE_PATH`'s usual root, and its browsers in one
 * world-readable folder, the one Playwright's own image uses, rather than
 * the cache of the user who built the image, whose home neither the cloud's
 * `agent` nor a device's own uid in its VM reads. Playwright looks for its
 * browsers in its own user's cache unless `PLAYWRIGHT_BROWSERS_PATH` says
 * otherwise, so the runner hands both harnesses' commands that variable
 * (`SANDBOX_TOOL_ENV`).
 */
export const PLAYWRIGHT_PIN = {
  VERSION: "1.64.1",
  PREFIX: "/usr/local",
  BROWSERS: "/ms-playwright",
} as const;

/** What every command a harness runs is handed of the image's tools, in the cloud and in a device's VM alike. */
export const SANDBOX_TOOL_ENV = { PLAYWRIGHT_BROWSERS_PATH: PLAYWRIGHT_PIN.BROWSERS } as const;

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
   * The SHA-256 of each kept file that runs on the device, by its path under
   * the kept folder, read off the pinned release: the kept build is answered only while each still matches, since anything of
   * the developer's could have written it since its archive was checked.
   */
  readonly FILES?: Readonly<Record<string, string>>;
}

/**
 * smolvm on a Mac whose local agents run sandboxed, one VM each: the
 * release step 0 and the launcher's hand test passed on, as its GitHub
 * release keeps the macOS arm64 build. The whole folder is kept, since the
 * `smolvm` wrapper runs `smolvm-bin` beside it with the `lib/` it links, the
 * `agent-rootfs/` it boots, and the disk templates it copies. Its binary is
 * signed ad hoc with the hypervisor entitlement and no Developer ID team,
 * so its archive's digest decides, and the digests of what of it runs on the Mac, the
 * wrapper, the binary, and the libraries it loads, as the release's own
 * `checksums.txt` lists them, are checked again before every use. The same
 * release as a host's (`SMOLVM_LINUX_PIN`).
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
  FILES: {
    smolvm: "b67b25f363403e19deceb6897e5a4d94be30a079f8cb751372782f17fc99003a",
    "smolvm-bin": "f7540c75f4fe166a6932d84d0ddb7f94e2ebc4100d0994c9dca41084149e88d9",
    "lib/libMoltenVK.dylib": "945c9d86e886edc19a9cc3975336f4c67279d3ca884bf55638b041d8921fd16f",
    "lib/libepoxy.0.dylib": "4907b7a0cf4ef3515bde843dc187f22482d142898f6c44f2859b59c6298e3324",
    "lib/libkrun.dylib": "cdda50c3e92462f853cef0f4392ddbb957f7f6edd5c3632ae7d8c93c4dd58cd5",
    "lib/libkrunfw.5.dylib": "b83f38cceb26893d67d6d531550e3d3072e216d996b44cae9daa5507688889cd",
    "lib/libkrunfw.dylib": "b83f38cceb26893d67d6d531550e3d3072e216d996b44cae9daa5507688889cd",
    "lib/libvirglrenderer.1.dylib":
      "6ad956b217da875edd64a25f799f3d2036c611626053d39b2cc4e36577645205",
  },
};

/**
 * A tool's builds for a host (`apps/host`), one per architecture it runs on,
 * by Node's `process.arch` names (`@luke/features/device-agent-wire`'s
 * `DEVICE_ARCH`), each decided by its digest.
 */
export interface LinuxToolPins {
  readonly x64: AgentToolPin;
  readonly arm64: AgentToolPin;
}

/** The Node release a host's daemon runs on, the one the runner's bundle targets (`node24`). */
const NODE_VERSION = "24.22.1";

/**
 * The Node a host's daemon runs on, as nodejs.org keeps its Linux builds,
 * which the host's release carries (`apps/host/scripts/package.ts`) rather
 * than fetches.
 */
export const NODE_LINUX_PINS: LinuxToolPins = {
  x64: {
    NAME: "node",
    VERSION: NODE_VERSION,
    ARCHIVE: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz`,
    SHA256: "eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c",
    BYTES: 58_290_700,
    ROOT: `node-v${NODE_VERSION}-linux-x64`,
    MEMBERS: ["bin/node"],
    BINARY: "bin/node",
  },
  arm64: {
    NAME: "node",
    VERSION: NODE_VERSION,
    ARCHIVE: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.gz`,
    SHA256: "33c37be234ba8bee041961047b19160f4d7d0f164e8e246f78bdd10feff148b3",
    BYTES: 58_021_129,
    ROOT: `node-v${NODE_VERSION}-linux-arm64`,
    MEMBERS: ["bin/node"],
    BINARY: "bin/node",
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
