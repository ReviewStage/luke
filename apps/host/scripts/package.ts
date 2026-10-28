/**
 * package.ts -- one host release for the OS and architecture given: the daemon's and the runner's bundles and the Node they run on, under one `luke-host/` folder; on Linux with the `luke-host` command, as a tarball beside its SHA-256, and on a Mac as the folder the desktop app carries.
 *
 * Run by CI for each Linux architecture (`.github/workflows/release-host.yml`)
 * once both bundles are built (`pnpm --filter @luke/host-daemon build`,
 * `pnpm --filter @luke/agent-runner build`):
 *
 *   tsx scripts/package.ts --arch x64
 *
 * and by the desktop's package script for the folder its app ships in its
 * resources (`apps/desktop/scripts/build-host.mjs`), where the app's own
 * `luke-host` command and login item run it:
 *
 *   tsx scripts/package.ts --os darwin --into <folder>
 *
 * Node is fetched as its pin names it (`@luke/agent-runner/pins`'
 * `NODE_LINUX_PINS`, `NODE_MAC_PIN`), refused unless it arrived at its
 * pinned size and digest, and only its pinned members are kept. Claude Code and Codex are
 * not carried: the daemon fetches each at its pin on the box
 * (`@luke/host/daemon`). The tarball is written with every entry owned by
 * root and stamped at one time, in name order, so its digest is the
 * contents' alone. It lands in `dist/release/`, named as the release names
 * it (`@luke/features/host-release`), with a `.sha256` beside it in
 * `sha256sum`'s own format, which the install script's digest is read off.
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
import { hostTarballName } from "@luke/features/host-release";

const APP = join(import.meta.dirname, "..");
const REPOSITORY = join(APP, "..", "..");
/** Where a checked pinned archive is kept between runs: the repository's own scratch, which git ignores. */
const KEPT_PINS = join(REPOSITORY, ".build", "pins");
const RELEASE = join(APP, "dist", "release");
const ROOT_FOLDER = "luke-host";

/** One time every entry of the tarball is stamped with, so the same contents make the same bytes. */
const STAMP = "2026-01-01T00:00:00Z";

/** The files every release carries, by where each lands under the root folder, and where each comes from. */
const BUNDLES = [
  { from: join(APP, "dist", "luke-host.mjs"), to: "lib/luke-host.mjs", mode: 0o644 },
  {
    from: join(REPOSITORY, "packages", "agent-runner", "dist", "agent-runner.mjs"),
    to: "lib/agent-runner.mjs",
    mode: 0o644,
  },
] as const;

/**
 * What a Linux release carries beside them: its `luke-host` command and the
 * license. A Mac's command is the app's own (`HostLoginItem.swift`), and the
 * app carries the license.
 */
const LINUX_ONLY = [
  { from: join(APP, "scripts", "luke-host.sh"), to: "bin/luke-host", mode: 0o755 },
  { from: join(REPOSITORY, "LICENSE"), to: "LICENSE", mode: 0o644 },
  { from: join(REPOSITORY, "NOTICE"), to: "NOTICE", mode: 0o644 },
] as const;

type Copied = (typeof BUNDLES)[number] | (typeof LINUX_ONLY)[number];

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Whether `archive` is exactly the pinned build: its size and its SHA-256. */
function isPinned(pin: AgentToolPin, archive: Uint8Array): boolean {
  return archive.length === pin.BYTES && sha256(archive) === pin.SHA256;
}

/**
 * The pin's archive: the copy kept in the repository's scratch from an
 * earlier run where it still checks out, so a development start stages the
 * host offline, and fetched and checked otherwise, then kept for the next.
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
async function stage(root: string, copied: readonly Copied[], node: AgentToolPin): Promise<void> {
  const scratch = join(dirname(root), ".scratch");
  rmSync(root, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  for (const file of copied) {
    mkdirSync(dirname(join(root, file.to)), { recursive: true });
    copyFileSync(file.from, join(root, file.to));
    chmodSync(join(root, file.to), file.mode);
  }
  await fetchPinned(node, join(root, "node"), scratch);
  rmSync(scratch, { recursive: true, force: true });
}

/** The Linux tarball for the architecture given, and its `.sha256`, in `dist/release/`. */
async function packageLinux(arch: DeviceArch, version: string): Promise<void> {
  const staging = join(RELEASE, `${arch}`);
  rmSync(staging, { recursive: true, force: true });
  await stage(join(staging, ROOT_FOLDER), [...BUNDLES, ...LINUX_ONLY], NODE_LINUX_PINS[arch]);
  const tarball = join(RELEASE, hostTarballName(version, arch));
  execFileSync("tar", [
    "--create",
    "--gzip",
    "--file",
    tarball,
    "--directory",
    staging,
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "--mode=go-w,a-s",
    "--sort=name",
    `--mtime=${STAMP}`,
    ROOT_FOLDER,
  ]);
  const digest = sha256(readFileSync(tarball));
  writeFileSync(`${tarball}.sha256`, `${digest}  ${hostTarballName(version, arch)}\n`);
  rmSync(staging, { recursive: true, force: true });
  process.stdout.write(`${hostTarballName(version, arch)} ${digest}\n`);
}

async function main(): Promise<void> {
  // Note that `pnpm <script> -- --arch x64`, as the release workflow runs it, hands the `--` on, which parseArgs would read as the end of the options.
  const given = process.argv.slice(2);
  const { values } = parseArgs({
    args: given[0] === "--" ? given.slice(1) : given,
    options: { arch: { type: "string" }, os: { type: "string" }, into: { type: "string" } },
  });
  if (values.os === DEVICE_PLATFORM.DARWIN) {
    if (values.into === undefined) throw new Error("usage: package.ts --os darwin --into <folder>");
    await stage(values.into, BUNDLES, NODE_MAC_PIN);
    process.stdout.write(`Staged Luke host for macOS in ${values.into}\n`);
    return;
  }
  const arch = Object.values(DEVICE_ARCH).find((each): each is DeviceArch => each === values.arch);
  if (arch === undefined) throw new Error("usage: package.ts --arch x64|arm64");
  const { version } = JSON.parse(readFileSync(join(APP, "package.json"), "utf8")) as {
    version: string;
  };
  await packageLinux(arch, version);
}

await main();
