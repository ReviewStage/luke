/**
 * package.ts -- one host release for the OS and architecture given: the daemon's and the runner's bundles, the `vespin-host` command, and the Node they run on, under one `luke-host/` folder, as a tarball beside its SHA-256.
 *
 * Run by CI for each Linux architecture and for an Apple silicon Mac
 * (`.github/workflows/release-host.yml`) once both bundles are built
 * (`pnpm --filter @luke/host-daemon build`,
 * `pnpm --filter @luke/agent-runner build`):
 *
 *   tsx scripts/package.ts --arch x64
 *   tsx scripts/package.ts --os darwin --arch arm64
 *
 * Node is fetched as its pin names it (`@luke/agent-runner/pins`'
 * `NODE_LINUX_PINS`, `NODE_MAC_PIN`), refused unless it arrived at its
 * pinned size and digest, and only its pinned members are kept. Claude Code and Codex are
 * not carried: the daemon fetches each at its pin on the box
 * (`@luke/host/daemon`). The release is laid out and packed as
 * `release-layout.ts` says. It lands in `dist/release/`, named as the release
 * names it (`@luke/features/host-release`), and from the rename on again
 * under the name a host through 0.6.0 fetches it by, the same bytes, each
 * with a `.sha256` beside it in `sha256sum`'s own format, which the install
 * script's digest is read off.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { type AgentToolPin, NODE_LINUX_PINS, NODE_MAC_PIN } from "@luke/agent-runner/pins";
import { DEVICE_ARCH, DEVICE_PLATFORM, type DeviceArch } from "@luke/features/device-agent-wire";
import { HOST_TARGET, type HostTarget, hostTarballNames } from "@luke/features/host-release";
import {
  packedRelease,
  type ReleaseSources,
  ROOT_FOLDER,
  stagedRelease,
} from "./release-layout.js";

const APP = join(import.meta.dirname, "..");
const REPOSITORY = join(APP, "..", "..");
/** Where a checked pinned archive is kept between runs: the repository's own scratch, which git ignores. */
const KEPT_PINS = join(REPOSITORY, ".build", "pins");
const RELEASE = join(APP, "dist", "release");

/** Each Linux architecture's release target. */
const LINUX_TARGETS: Readonly<Record<DeviceArch, HostTarget>> = {
  [DEVICE_ARCH.X64]: HOST_TARGET.LINUX_X64,
  [DEVICE_ARCH.ARM64]: HOST_TARGET.LINUX_ARM64,
};

const USAGE = "usage: package.ts --arch x64|arm64 | --os darwin --arch arm64";

/** Where each file a release carries comes from: both bundles, its `vespin-host` command, and the license. */
const SOURCES: ReleaseSources = {
  daemon: join(APP, "dist", "vespin-host.mjs"),
  runner: join(REPOSITORY, "packages", "agent-runner", "dist", "agent-runner.mjs"),
  command: join(APP, "scripts", "vespin-host.sh"),
  license: join(REPOSITORY, "LICENSE"),
  notice: join(REPOSITORY, "NOTICE"),
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Whether `archive` is exactly the pinned build: its size and its SHA-256. */
function isPinned(pin: AgentToolPin, archive: Uint8Array): boolean {
  return archive.length === pin.BYTES && sha256(archive) === pin.SHA256;
}

/**
 * The pin's archive: the copy kept in the repository's scratch from an
 * earlier run where it still checks out, so a release packaged again needs
 * no network, and fetched and checked otherwise, then kept for the next.
 */
async function pinnedArchive(pin: AgentToolPin): Promise<Uint8Array> {
  const kept = join(KEPT_PINS, `${pin.NAME}-${pin.SHA256}.tgz`);
  if (existsSync(kept)) {
    const archive = new Uint8Array(readFileSync(kept));
    if (isPinned(pin, archive)) return archive;
  }
  const response = await fetch(pin.ARCHIVE);
  if (!response.ok) throw new Error(`${pin.ARCHIVE} answered ${response.status}`);
  const archive = new Uint8Array(await response.arrayBuffer());
  if (archive.length !== pin.BYTES) {
    throw new Error(`${pin.ARCHIVE} is ${archive.length} bytes, not the pinned ${pin.BYTES}`);
  }
  if (!isPinned(pin, archive)) throw new Error(`${pin.ARCHIVE} is not the pinned build`);
  mkdirSync(KEPT_PINS, { recursive: true });
  writeFileSync(kept, archive);
  return archive;
}

/** The pin's archive, kept or fetched and checked, and its members kept under `folder` as the archive lays them out. */
async function fetchPinned(pin: AgentToolPin, folder: string, scratch: string): Promise<void> {
  const archive = await pinnedArchive(pin);
  const saved = join(scratch, `${pin.NAME}.tgz`);
  writeFileSync(saved, archive);
  const members = pin.MEMBERS.map((member) => `${pin.ROOT}/${member}`);
  execFileSync("tar", ["-xzf", saved, "-C", scratch, ...members]);
  for (const member of pin.MEMBERS) {
    mkdirSync(dirname(join(folder, member)), { recursive: true });
    copyFileSync(join(scratch, pin.ROOT, member), join(folder, member));
    chmodSync(join(folder, member), 0o755);
  }
}

/** The release's files and its pinned Node laid out under `root`, fetched through `scratch`, which is removed after. */
async function stage(root: string, node: AgentToolPin): Promise<void> {
  const scratch = join(dirname(root), ".scratch");
  stagedRelease(root, SOURCES);
  mkdirSync(scratch, { recursive: true });
  await fetchPinned(node, join(root, "node"), scratch);
  rmSync(scratch, { recursive: true, force: true });
}

/** The target's tarball, on the Node given, under every name it is published by, each with its `.sha256`, in `dist/release/`. */
async function packageTarball(target: HostTarget, node: AgentToolPin): Promise<void> {
  const { version } = JSON.parse(readFileSync(join(APP, "package.json"), "utf8")) as {
    version: string;
  };
  const [name, ...copies] = hostTarballNames(version, target);
  const staging = join(RELEASE, target);
  rmSync(staging, { recursive: true, force: true });
  await stage(join(staging, ROOT_FOLDER), node);
  const tarball = join(RELEASE, name);
  packedRelease(staging, tarball);
  rmSync(staging, { recursive: true, force: true });
  const digest = sha256(readFileSync(tarball));
  for (const copy of copies) copyFileSync(tarball, join(RELEASE, copy));
  for (const each of [name, ...copies]) {
    writeFileSync(join(RELEASE, `${each}.sha256`), `${digest}  ${each}\n`);
    process.stdout.write(`${each} ${digest}\n`);
  }
}

async function main(): Promise<void> {
  // Note that `pnpm <script> -- --arch x64`, as the release workflow runs it, hands the `--` on, which parseArgs would read as the end of the options.
  const given = process.argv.slice(2);
  const { values } = parseArgs({
    args: given[0] === "--" ? given.slice(1) : given,
    options: { arch: { type: "string" }, os: { type: "string" } },
  });
  // Note that a Mac release is Apple silicon's alone, since NODE_MAC_PIN is its Node.
  if (values.os === DEVICE_PLATFORM.DARWIN) {
    if (values.arch !== DEVICE_ARCH.ARM64) throw new Error(USAGE);
    await packageTarball(HOST_TARGET.DARWIN_ARM64, NODE_MAC_PIN);
    return;
  }
  const arch = Object.values(DEVICE_ARCH).find((each): each is DeviceArch => each === values.arch);
  if (arch === undefined || (values.os !== undefined && values.os !== DEVICE_PLATFORM.LINUX)) {
    throw new Error(USAGE);
  }
  await packageTarball(LINUX_TARGETS[arch], NODE_LINUX_PINS[arch]);
}

await main();
