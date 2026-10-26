/**
 * package.ts -- one host release tarball for the architecture given: the daemon's and the runner's bundles, the Node they run on, and the `luke-host` command, under one `luke-host/` folder, beside its SHA-256.
 *
 * Run by CI for each architecture (`.github/workflows/release-host.yml`) once
 * both bundles are built (`pnpm --filter @luke/host-daemon build`,
 * `pnpm --filter @luke/agent-runner build`):
 *
 *   tsx scripts/package.ts --arch x64
 *
 * Node is fetched as its pin names it (`@luke/agent-runner/pins`'
 * `NODE_LINUX_PINS`), refused unless it arrived at its pinned size and
 * digest, and only its pinned members are kept. Claude Code, Codex, and `gh`
 * are not carried: the daemon fetches each at its pin on the box
 * (`@luke/host/linux-host`). The tarball is written with every entry owned by
 * root and stamped at one time, in name order, so its digest is the
 * contents' alone. It lands in `dist/release/`, named as the release names
 * it (`@luke/features/host-release`), with a `.sha256` beside it in
 * `sha256sum`'s own format, which the install script's digest is read off.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { type AgentToolPin, NODE_LINUX_PINS } from "@luke/agent-runner/pins";
import { DEVICE_ARCH, type DeviceArch } from "@luke/features/device-agent-wire";
import { hostTarballName } from "@luke/features/host-release";

const APP = join(import.meta.dirname, "..");
const REPOSITORY = join(APP, "..", "..");
const RELEASE = join(APP, "dist", "release");
const ROOT_FOLDER = "luke-host";

/** One time every entry of the tarball is stamped with, so the same contents make the same bytes. */
const STAMP = "2026-01-01T00:00:00Z";

/** The release's files, by where each lands under the root folder, and where each comes from. */
const COPIED = [
  { from: join(APP, "dist", "luke-host.mjs"), to: "lib/luke-host.mjs", mode: 0o644 },
  {
    from: join(REPOSITORY, "packages", "agent-runner", "dist", "agent-runner.mjs"),
    to: "lib/agent-runner.mjs",
    mode: 0o644,
  },
  { from: join(APP, "scripts", "luke-host.sh"), to: "bin/luke-host", mode: 0o755 },
  { from: join(REPOSITORY, "LICENSE"), to: "LICENSE", mode: 0o644 },
  { from: join(REPOSITORY, "NOTICE"), to: "NOTICE", mode: 0o644 },
] as const;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The pin's archive fetched and checked, and its members kept under `folder` as the archive lays them out. */
async function fetchPinned(pin: AgentToolPin, folder: string, scratch: string): Promise<void> {
  const response = await fetch(pin.ARCHIVE);
  if (!response.ok) throw new Error(`${pin.ARCHIVE} answered ${response.status}`);
  const archive = new Uint8Array(await response.arrayBuffer());
  if (archive.length !== pin.BYTES) {
    throw new Error(`${pin.ARCHIVE} is ${archive.length} bytes, not the pinned ${pin.BYTES}`);
  }
  if (sha256(archive) !== pin.SHA256) throw new Error(`${pin.ARCHIVE} is not the pinned build`);
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

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { arch: { type: "string" } } });
  const arch = Object.values(DEVICE_ARCH).find((each): each is DeviceArch => each === values.arch);
  if (arch === undefined) throw new Error("usage: package.ts --arch x64|arm64");
  const { version } = JSON.parse(readFileSync(join(APP, "package.json"), "utf8")) as {
    version: string;
  };
  const staging = join(RELEASE, `${arch}`);
  const root = join(staging, ROOT_FOLDER);
  const scratch = join(staging, ".scratch");
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  for (const file of COPIED) {
    mkdirSync(dirname(join(root, file.to)), { recursive: true });
    copyFileSync(file.from, join(root, file.to));
    chmodSync(join(root, file.to), file.mode);
  }
  await fetchPinned(NODE_LINUX_PINS[arch], join(root, "node"), scratch);
  rmSync(scratch, { recursive: true, force: true });
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

await main();
