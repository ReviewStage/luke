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
import { type AgentToolPin, NODE_LINUX_PINS, NODE_MAC_PIN } from "@repo/agent-runner/pins";
import { DEVICE_ARCH, DEVICE_PLATFORM, type DeviceArch } from "@repo/features/device-agent-wire";
import { HOST_TARGET, type HostTarget, hostTarballName } from "@repo/features/host-release";
import {
  packedRelease,
  type ReleaseSources,
  ROOT_FOLDER,
  stagedRelease,
} from "./release-layout.js";

const APP = join(import.meta.dirname, "..");
const REPOSITORY = join(APP, "..", "..");
const KEPT_PINS = join(REPOSITORY, ".build", "pins");
const RELEASE = join(APP, "dist", "release");

const LINUX_TARGETS: Readonly<Record<DeviceArch, HostTarget>> = {
  [DEVICE_ARCH.X64]: HOST_TARGET.LINUX_X64,
  [DEVICE_ARCH.ARM64]: HOST_TARGET.LINUX_ARM64,
};

const USAGE = "usage: package.ts --arch x64|arm64 | --os darwin --arch arm64";

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

function isPinned(pin: AgentToolPin, archive: Uint8Array): boolean {
  return archive.length === pin.BYTES && sha256(archive) === pin.SHA256;
}

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

async function stage(root: string, node: AgentToolPin): Promise<void> {
  const scratch = join(dirname(root), ".scratch");
  stagedRelease(root, SOURCES);
  mkdirSync(scratch, { recursive: true });
  await fetchPinned(node, join(root, "node"), scratch);
  rmSync(scratch, { recursive: true, force: true });
}

async function packageTarball(target: HostTarget, node: AgentToolPin): Promise<void> {
  const { version } = JSON.parse(readFileSync(join(APP, "package.json"), "utf8")) as {
    version: string;
  };
  const name = hostTarballName(version, target);
  const staging = join(RELEASE, target);
  rmSync(staging, { recursive: true, force: true });
  await stage(join(staging, ROOT_FOLDER), node);
  const tarball = join(RELEASE, name);
  packedRelease(staging, tarball);
  rmSync(staging, { recursive: true, force: true });
  const digest = sha256(readFileSync(tarball));
  writeFileSync(`${tarball}.sha256`, `${digest}  ${name}\n`);
  process.stdout.write(`${name} ${digest}\n`);
}

async function main(): Promise<void> {
  const given = process.argv.slice(2);
  const { values } = parseArgs({
    args: given[0] === "--" ? given.slice(1) : given,
    options: { arch: { type: "string" }, os: { type: "string" } },
  });
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
