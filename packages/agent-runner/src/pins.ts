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
 * what a device fetches or carries of its own, smolvm, a host's Node, and
 * the Claude Code, Codex, and GitHub CLI every host keeps for its agents to
 * run on the box itself, is an `AgentToolPin` checked by size, digest, and
 * signature where it has one before it is kept (`@luke/host`'s
 * `localAgentTool`). Erasable syntax alone, so Node runs the generator over
 * it as it stands.
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
 * on every PATH and in `NODE_PATH`'s usual root, and its browsers inside its
 * own playwright-core, Playwright's hermetic install, rather than in the
 * cache of the user who built the image, whose home neither the cloud's
 * `agent` nor a device's own uid in its VM reads. Each Playwright looks in
 * its own package for its browsers only where `PLAYWRIGHT_BROWSERS_PATH` is
 * `0`, so the runner hands both harnesses' commands that (`SANDBOX_TOOL_ENV`),
 * which also has a repository's own Playwright install its browsers in its
 * own `node_modules`, which the agent writes, rather than in a shared folder
 * it may not. `BROWSERS` is where npm's global install puts them, which the
 * image checks and Luke's own browser reads.
 */
export const PLAYWRIGHT_PIN = {
  VERSION: "1.64.1",
  PREFIX: "/usr/local",
  BROWSERS: "/usr/local/lib/node_modules/playwright/node_modules/playwright-core/.local-browsers",
} as const;

/** What every command a harness runs is handed of the image's tools, in the cloud and in a device's VM alike: each Playwright's browsers in its own package (`PLAYWRIGHT_PIN`). */
export const SANDBOX_TOOL_ENV = { PLAYWRIGHT_BROWSERS_PATH: "0" } as const;

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
  /**
   * The archive by its https address: a gzipped tar, or a zip where only a
   * Mac fetches it, which macOS's own tar reads alike.
   */
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
   * release, which macOS's own `codesign` must verify and name before the
   * build is kept; none where the release is not signed so, and its digests
   * alone decide.
   */
  readonly TEAM?: string;
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
 * The Node a Mac's `luke-host` runs on, the same release as a Linux host's,
 * which the desktop app carries inside its bundle, signed with it
 * (`apps/host/scripts/package.ts --os darwin`), since the app's own
 * Electron may not run as Node.
 */
export const NODE_MAC_PIN: AgentToolPin = {
  NAME: "node",
  VERSION: NODE_VERSION,
  ARCHIVE: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
  SHA256: "89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7",
  BYTES: 53_062_778,
  ROOT: `node-v${NODE_VERSION}-darwin-arm64`,
  MEMBERS: ["bin/node"],
  BINARY: "bin/node",
};

/**
 * The Agent SDK release every host's own Claude Code is, and the Codex and
 * GitHub CLI releases beside it, each written out in its pins below rather
 * than read off `CLAUDE_CODE_PIN` and `CODEX_PIN`, so a bump fails the
 * repository check (`tools/anti-slop/guards/agent-pins.ts`) until each
 * pin's address, size, and digests are read off the new release too.
 */
const HOST_CLI_VERSION = { CLAUDE_CODE: "0.3.304", CODEX: "0.163.0", GH: "2.103.3" } as const;

/**
 * Claude Code on a Mac host, This Mac's among them: the macOS arm64 build of
 * the very Agent SDK the runner pins (`CLAUDE_CODE_PIN.SDK_VERSION`), as npm
 * keeps it, signed by Anthropic.
 */
export const CLAUDE_CODE_MAC_PIN: AgentToolPin = {
  NAME: "claude",
  VERSION: HOST_CLI_VERSION.CLAUDE_CODE,
  ARCHIVE: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-arm64/-/claude-agent-sdk-darwin-arm64-${HOST_CLI_VERSION.CLAUDE_CODE}.tgz`,
  SHA256: "cdca064e1bbe6001c5d8bbefd636205379c79b8d05bf41a3a37fc1fde096a93d",
  BYTES: 120_586_636,
  ROOT: "package",
  MEMBERS: ["claude"],
  BINARY: "claude",
  TEAM: "Q6L2SF6YDW",
  FILES: { claude: "b9ac5374839f14abf3f1f45610637c332b5daee5ce0d1634726cef87aab78e6a" },
};

/**
 * Codex on a Mac host: the sandbox's release (`CODEX_PIN.VERSION`), as npm
 * keeps its macOS arm64 package, signed by OpenAI, its build's folder kept
 * whole, so the binary finds its `codex-path` tools and its resources beside
 * it.
 */
export const CODEX_MAC_PIN: AgentToolPin = {
  NAME: "codex",
  VERSION: HOST_CLI_VERSION.CODEX,
  ARCHIVE: `https://registry.npmjs.org/@openai/codex/-/codex-${HOST_CLI_VERSION.CODEX}-darwin-arm64.tgz`,
  SHA256: "1193ff4ce72387a5d6c34820b54a9dc57d007c67a958e8acb4715924facd3c31",
  BYTES: 137_871_195,
  ROOT: "package/vendor/aarch64-apple-darwin",
  MEMBERS: ["bin", "codex-path", "codex-resources", "codex-package.json"],
  BINARY: "bin/codex",
  TEAM: "2DC432GLL2",
  FILES: {
    "bin/codex": "8813367285524ac798dd96d1b071aea30d58708c7226fd236cd275cf1cfdee31",
    "bin/codex-code-mode-host": "79f123a85dbc61e8f5d0f0c050dfc3f4b81a8305d33a32b41e008b7f6e035698",
    "codex-path/rg": "27d09e29c478fddbfc750a2cb5fd06965bad0ea223e776f8667160a0de63c6e4",
  },
};

/** GitHub's CLI on a Mac host, as cli/cli's release keeps its macOS arm64 build, a zip, signed by GitHub. */
export const GH_MAC_PIN: AgentToolPin = {
  NAME: "gh",
  VERSION: HOST_CLI_VERSION.GH,
  ARCHIVE: `https://github.com/cli/cli/releases/download/v${HOST_CLI_VERSION.GH}/gh_${HOST_CLI_VERSION.GH}_macOS_arm64.zip`,
  SHA256: "d700207eae9ae98fe2b89535c2c087c07823d4628c56364695a5a07ef311c062",
  BYTES: 14_106_091,
  ROOT: `gh_${HOST_CLI_VERSION.GH}_macOS_arm64`,
  MEMBERS: ["bin/gh"],
  BINARY: "bin/gh",
  TEAM: "VEKTX9H2N7",
  FILES: { "bin/gh": "5f8d7527e2bdf584249b030cdd1550c91d75e8afb40aa3c11573d416817a1260" },
};

/** Claude Code on a Linux host: the glibc Linux builds of the very Agent SDK the runner pins, as npm keeps them. */
export const CLAUDE_CODE_LINUX_PINS: LinuxToolPins = {
  x64: {
    NAME: "claude",
    VERSION: HOST_CLI_VERSION.CLAUDE_CODE,
    ARCHIVE: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-x64/-/claude-agent-sdk-linux-x64-${HOST_CLI_VERSION.CLAUDE_CODE}.tgz`,
    SHA256: "214fcde96f46b9b76f4acc9efbd65b843c90ae9a689da224c33f09a77e069395",
    BYTES: 130_438_422,
    ROOT: "package",
    MEMBERS: ["claude"],
    BINARY: "claude",
    FILES: { claude: "ea0f135784631619a7a409d07322ecec964f9cc4fd377508ed1ba3f141f27912" },
  },
  arm64: {
    NAME: "claude",
    VERSION: HOST_CLI_VERSION.CLAUDE_CODE,
    ARCHIVE: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-arm64/-/claude-agent-sdk-linux-arm64-${HOST_CLI_VERSION.CLAUDE_CODE}.tgz`,
    SHA256: "429cfc8eca03f6e26bc5ca698994b7089c5d1fa345899d5beb96cc88173b544c",
    BYTES: 130_978_746,
    ROOT: "package",
    MEMBERS: ["claude"],
    BINARY: "claude",
    FILES: { claude: "c487117526509ab6d2ee6013e14f181faf68d6d6afe6bb0d4b2b4a9feca5ecb3" },
  },
};

/**
 * Codex on a Linux host: the sandbox's release, as npm keeps its Linux
 * packages, static musl builds, each build's folder kept whole, so the
 * binary finds its `codex-path` tools and its own bubblewrap beside it.
 */
export const CODEX_LINUX_PINS: LinuxToolPins = {
  x64: {
    NAME: "codex",
    VERSION: HOST_CLI_VERSION.CODEX,
    ARCHIVE: `https://registry.npmjs.org/@openai/codex/-/codex-${HOST_CLI_VERSION.CODEX}-linux-x64.tgz`,
    SHA256: "30efc97738b975940d78b59a9bea115fa34040b732807d54ec35ae6b7528de94",
    BYTES: 162_055_867,
    ROOT: "package/vendor/x86_64-unknown-linux-musl",
    MEMBERS: ["bin", "codex-path", "codex-resources", "codex-package.json"],
    BINARY: "bin/codex",
    FILES: {
      "bin/codex": "399ff69c431c066e40de318fba45c2b07f45a76b19939d247ee4828fc70c4215",
      "bin/codex-code-mode-host":
        "8724d73ec190536233ab4628d24a071bfbcf27e5124f08fe35129f26fe48b916",
      "codex-path/rg": "e62198eb19b136b88c330af83647b5a962cb99b6b1f066758568f12de1974849",
      "codex-resources/bwrap": "77360cb751ccedc5971391444ac86a8a33c15b04d6b4a6fe45f5d25496e62c4c",
    },
  },
  arm64: {
    NAME: "codex",
    VERSION: HOST_CLI_VERSION.CODEX,
    ARCHIVE: `https://registry.npmjs.org/@openai/codex/-/codex-${HOST_CLI_VERSION.CODEX}-linux-arm64.tgz`,
    SHA256: "dc6e7c4d6de71c23a0f60d05e2577ff7eef615b76f22630d58ad384b84763522",
    BYTES: 154_715_729,
    ROOT: "package/vendor/aarch64-unknown-linux-musl",
    MEMBERS: ["bin", "codex-path", "codex-resources", "codex-package.json"],
    BINARY: "bin/codex",
    FILES: {
      "bin/codex": "8a96f66d059d653e68bfd5f3c79337e6f1d7d170d80bf705eb7d0249b34c0ece",
      "bin/codex-code-mode-host":
        "255eccc8a5c1d267dc0acbc815cc83aaa1f50955bd99943b29f00cafcdcab771",
      "codex-path/rg": "e36d0eb52e70696bdf1781392722e05a21bb91d3b7b762ef5ec20e5df2ec687b",
      "codex-resources/bwrap": "c547cbdc762a70ed216789ffaa4c6c0e7d2beabe32245a498f8e365a9fc8dab4",
    },
  },
};

/** GitHub's CLI on a Linux host, as cli/cli's release keeps its static Linux builds. */
export const GH_LINUX_PINS: LinuxToolPins = {
  x64: {
    NAME: "gh",
    VERSION: HOST_CLI_VERSION.GH,
    ARCHIVE: `https://github.com/cli/cli/releases/download/v${HOST_CLI_VERSION.GH}/gh_${HOST_CLI_VERSION.GH}_linux_amd64.tar.gz`,
    SHA256: "4c806978ffce1cec70853302a56d70ac6da4f19bae7adca4e1a8ab00633dd91d",
    BYTES: 15_031_972,
    ROOT: `gh_${HOST_CLI_VERSION.GH}_linux_amd64`,
    MEMBERS: ["bin/gh"],
    BINARY: "bin/gh",
    FILES: { "bin/gh": "b768184570b12536be4ac1528893f6340d1c6a7b40b56ad45bca9cd0e87ad34d" },
  },
  arm64: {
    NAME: "gh",
    VERSION: HOST_CLI_VERSION.GH,
    ARCHIVE: `https://github.com/cli/cli/releases/download/v${HOST_CLI_VERSION.GH}/gh_${HOST_CLI_VERSION.GH}_linux_arm64.tar.gz`,
    SHA256: "ee32df2323c8847f5fac6cb6b4b69ca75828e9329a8f22f677021f7b3306ce63",
    BYTES: 13_661_485,
    ROOT: `gh_${HOST_CLI_VERSION.GH}_linux_arm64`,
    MEMBERS: ["bin/gh"],
    BINARY: "bin/gh",
    FILES: { "bin/gh": "a82a52e1bbe05bcd485f8cbbd5aa67e11a76fce6bdad394a2d179e1c24cfe367" },
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

/**
 * The most smolvm's seed folder (`image-seeds/`) may hold, handed to every
 * `smolvm` Luke runs, on a Mac and a host alike, under smolvm's own
 * variable: about three seeds of the sandbox image (2.8 GB each), the pin,
 * the one before it, and a second install's sharing the user's store. smolvm
 * holds it only right after it builds a seed, which is when the pin moves,
 * by evicting the least recently used seeds no machine's disk backs onto
 * until the folder fits. It caps the whole folder, not Luke's image alone:
 * a seed of another image the user ran can go, and is pulled again on its
 * next use. `apps/web/install/install.sh` carries the bytes as a literal,
 * which a test holds to this.
 */
export const SMOLVM_SEED_CAP = {
  VARIABLE: "SMOLVM_IMAGE_SEED_MAX_BYTES",
  BYTES: 9 * 1024 ** 3,
} as const;

/** Luke's sandbox image, as CI publishes it from the cloud's own setup script, pinned by digest: what every host agent's VM boots, and what the install script fetches ahead of the first. */
export const SANDBOX_IMAGE =
  "ghcr.io/reviewstage/luke-sandbox:ea78580d96ce7256@sha256:f6ff07bdc663c9173a856a713e4caa02a725eedd3da4aed0029c662e3b0b33a5";
