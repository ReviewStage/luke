/**
 * package.ts -- the `vespin` command's release from its one bundle: the npm package `vespin`, and one tarball per target for the curl install, the bundle with the Node it runs on, each beside its SHA-256.
 *
 * Run by CI once the bundle is built (`pnpm --filter @repo/vespin-cli build`,
 * which writes `dist/vespin.mjs` and the `dist/meta.json` naming what it
 * bundled), from `.github/workflows/release-cli.yml`:
 *
 *   tsx scripts/package.ts
 *
 * Every channel ships the same bundle, with a hashbang so npm's `bin` runs
 * it, and the notices of what it bundled (`THIRD_PARTY_NOTICES`), read off
 * the bundle's own metafile. The npm package is staged in `dist/npm/` under a
 * manifest of its own, apart from this private workspace package, which `npm
 * pack` and `npm publish` read there. Each tarball holds one `vespin/` folder:
 * the bundle as `lib/vespin.mjs`, the `bin/vespin` launcher
 * (`scripts/vespin.sh`), and the host's pinned Node (`@repo/agent-runner/pins`),
 * refused unless it arrived at its pinned size and digest. It is written by
 * GNU tar with every entry owned by root and stamped at one time, in name
 * order, so its digest is the contents' alone, as the host's is
 * (`apps/host/scripts/release-layout.ts`), and lands in `dist/release/`, named
 * as the release names it (`@repo/features/cli-release`), with a `.sha256` in
 * `sha256sum`'s own format, which `CLI_RELEASE`'s digests are read off.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type AgentToolPin, NODE_LINUX_PINS, NODE_MAC_PIN } from "@repo/agent-runner/pins";
import { cliTarballName } from "@repo/features/cli-release";
import { DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import { HOST_TARGET, type HostTarget } from "@repo/features/host-release";
import { PRODUCT_NAME } from "@repo/features/product-name";

const APP = join(import.meta.dirname, "..");
const REPOSITORY = join(APP, "..", "..");
const DIST = join(APP, "dist");
const NPM = join(DIST, "npm");
const RELEASE = join(DIST, "release");

/** The npm package's name, unscoped so `npx vespin` and `npm i -g vespin` work. */
const NPM_NAME = "vespin";

/** The oldest Node the bundle runs on, which its build targets (`--target=node20`). */
const NODE_ENGINE = ">=20";

/** The tarball's one top folder, which the install script renames to `versions/<version>`. */
const ROOT_FOLDER = "vespin";

/** One time every entry of a tarball is stamped with, so the same contents make the same bytes. */
const STAMP = "2026-01-01T00:00:00Z";

/** GNU tar, whose flags a tarball is written with: a Mac's own `tar` is bsdtar, and GNU's is `gtar` there. */
const GNU_TAR = process.platform === DEVICE_PLATFORM.DARWIN ? "gtar" : "tar";

/** The Node each target's tarball carries. */
const TARGET_NODE: Readonly<Record<HostTarget, AgentToolPin>> = {
  [HOST_TARGET.LINUX_X64]: NODE_LINUX_PINS.x64,
  [HOST_TARGET.LINUX_ARM64]: NODE_LINUX_PINS.arm64,
  [HOST_TARGET.DARWIN_ARM64]: NODE_MAC_PIN,
};

/** A file the license names as its own, in a bundled package's folder. */
const LICENSE_FILE = /^(licen[cs]e|copying)([-.][a-z0-9]+)*$/iu;

/** The files every channel carries beside the bundle, by the name each is shipped as. */
const NOTICES = {
  LICENSE: join(REPOSITORY, "LICENSE"),
  NOTICE: join(REPOSITORY, "NOTICE"),
} as const;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** This workspace package's version, which the bundle was built to say and the release is tagged with. */
function version(): string {
  const manifest = JSON.parse(readFileSync(join(APP, "package.json"), "utf8")) as {
    version: string;
  };
  return manifest.version;
}

/** The bundle as every channel ships it: with a hashbang, so it runs as npm's `bin` does. */
function shippedBundle(): string {
  return `#!/usr/bin/env node\n${readFileSync(join(DIST, "vespin.mjs"), "utf8")}`;
}

/**
 * The notices of every package the bundle holds code of, as the metafile
 * names them: each package's name, version, and license, and its license's
 * own words where its folder carries them, in name order.
 */
function thirdPartyNotices(): string {
  const meta = JSON.parse(readFileSync(join(DIST, "meta.json"), "utf8")) as {
    inputs: Record<string, unknown>;
  };
  const folders = new Map<string, string>();
  for (const input of Object.keys(meta.inputs)) {
    const at = input.lastIndexOf("node_modules/");
    if (at < 0) continue;
    const parts = input.slice(at + "node_modules/".length).split("/");
    const name = parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
    if (name === undefined) continue;
    folders.set(name, join(APP, input.slice(0, at), "node_modules", name));
  }
  const sections = [...folders.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, folder]) => {
      const manifest = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as {
        version: string;
        license?: string;
      };
      const file = readdirSync(folder).find((each) => LICENSE_FILE.test(each));
      const words =
        file === undefined ? "" : `\n\n${readFileSync(join(folder, file), "utf8").trim()}`;
      const heading = `${name} ${manifest.version} (${manifest.license ?? "see its package"})`;
      return `${heading}\n${"-".repeat(heading.length)}${words}\n`;
    });
  return [
    "Third-party notices",
    "===================",
    "",
    "The vespin bundle includes the following third-party packages.",
    "",
    ...sections,
  ].join("\n");
}

/** The npm package's manifest: the unscoped `vespin`, its one `bin`, and only the files it ships, the agent skill among them. */
function npmManifest(release: string): string {
  const manifest = {
    name: NPM_NAME,
    version: release,
    description: `${PRODUCT_NAME} from your terminal: tasks, plans, and coding agents, for people and scripts`,
    license: "Apache-2.0",
    homepage: "https://vespin.dev",
    repository: {
      type: "git",
      url: "git+https://github.com/ReviewStage/vespin.git",
      directory: "apps/cli",
    },
    bugs: "https://github.com/ReviewStage/vespin/issues",
    type: "module",
    bin: { vespin: "vespin.mjs" },
    engines: { node: NODE_ENGINE },
    files: ["vespin.mjs", "README.md", "skills", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES"],
    keywords: ["vespin", "cli", "coding-agents"],
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** The files every channel ships beside its bundle, written under `folder`. */
function writeNotices(folder: string, notices: string): void {
  for (const [name, from] of Object.entries(NOTICES)) copyFileSync(from, join(folder, name));
  writeFileSync(join(folder, "THIRD_PARTY_NOTICES"), notices);
}

/** The npm package staged whole in `dist/npm/`. */
function stageNpm(release: string, bundle: string, notices: string): void {
  rmSync(NPM, { recursive: true, force: true });
  mkdirSync(NPM, { recursive: true });
  writeFileSync(join(NPM, "package.json"), npmManifest(release));
  writeFileSync(join(NPM, "vespin.mjs"), bundle, { mode: 0o755 });
  copyFileSync(join(APP, "README.md"), join(NPM, "README.md"));
  cpSync(join(APP, "skills"), join(NPM, "skills"), { recursive: true });
  writeNotices(NPM, notices);
  process.stdout.write(`${NPM_NAME}@${release} staged in ${NPM}\n`);
}

/** The pin's archive, fetched and refused unless it is exactly the pinned build. */
async function pinnedArchive(pin: AgentToolPin): Promise<Uint8Array> {
  const response = await fetch(pin.ARCHIVE);
  if (!response.ok) throw new Error(`${pin.ARCHIVE} answered ${response.status}`);
  const archive = new Uint8Array(await response.arrayBuffer());
  if (archive.length !== pin.BYTES || sha256(archive) !== pin.SHA256) {
    throw new Error(`${pin.ARCHIVE} is not the pinned build`);
  }
  return archive;
}

/** The pin's members kept under `folder` as its archive lays them out, fetched through `scratch`. */
async function keepPinned(pin: AgentToolPin, folder: string, scratch: string): Promise<void> {
  const saved = join(scratch, `${pin.NAME}.tgz`);
  writeFileSync(saved, await pinnedArchive(pin));
  const members = pin.MEMBERS.map((member) => `${pin.ROOT}/${member}`);
  execFileSync("tar", ["-xzf", saved, "-C", scratch, ...members]);
  for (const member of pin.MEMBERS) {
    mkdirSync(dirname(join(folder, member)), { recursive: true });
    copyFileSync(join(scratch, pin.ROOT, member), join(folder, member));
    chmodSync(join(folder, member), 0o755);
  }
}

/** The target's tarball in `dist/release/`, and its `.sha256` beside it. */
async function packageTarball(
  release: string,
  target: HostTarget,
  bundle: string,
  notices: string,
): Promise<void> {
  const staging = join(RELEASE, target);
  const root = join(staging, ROOT_FOLDER);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "lib"), { recursive: true });
  copyFileSync(join(APP, "scripts", "vespin.sh"), join(root, "bin", "vespin"));
  chmodSync(join(root, "bin", "vespin"), 0o755);
  writeFileSync(join(root, "lib", "vespin.mjs"), bundle, { mode: 0o644 });
  writeNotices(root, notices);
  const scratch = join(staging, ".scratch");
  mkdirSync(scratch);
  await keepPinned(TARGET_NODE[target], join(root, "node"), scratch);
  rmSync(scratch, { recursive: true, force: true });

  const name = cliTarballName(release, target);
  const tarball = join(RELEASE, name);
  execFileSync(GNU_TAR, [
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
  rmSync(staging, { recursive: true, force: true });
  const digest = sha256(readFileSync(tarball));
  writeFileSync(`${tarball}.sha256`, `${digest}  ${name}\n`);
  process.stdout.write(`${name} ${digest}\n`);
}

async function main(): Promise<void> {
  const release = version();
  const bundle = shippedBundle();
  const notices = thirdPartyNotices();
  stageNpm(release, bundle, notices);
  rmSync(RELEASE, { recursive: true, force: true });
  mkdirSync(RELEASE, { recursive: true });
  for (const target of Object.values(HOST_TARGET)) {
    await packageTarball(release, target, bundle, notices);
  }
}

await main();
