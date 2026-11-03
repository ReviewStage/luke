/**
 * release-layout.ts -- one host release's folder laid out from the files it carries, and packed as its tarball: everything of a release but the Node it runs on, which `package.ts` fetches at its pin.
 *
 * The folder is the tarball's one top folder, `luke-host/`, which a host's
 * update and the install script both rename to `versions/<version>`, so no
 * person sees it. Its command is `bin/vespin-host`, and `bin/luke-host` is a
 * relative link to it: a host through 0.6.0 switches to a release only once
 * its `bin/luke-host` is a file it may run whose `version` answers the
 * release's (`host-update.ts` as 0.6.0 shipped it), and the service an older
 * install wrote starts it by that name. Anything that resolves the link's
 * path finds `vespin-host`. The tarball is written by GNU tar, a Mac's
 * `gtar`, with every entry owned by root and stamped at one time, in name
 * order, so its digest is the contents' alone.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEVICE_PLATFORM } from "@luke/features/device-agent-wire";

/** The tarball's one top folder. */
export const ROOT_FOLDER = "luke-host";

/** One time every entry of the tarball is stamped with, so the same contents make the same bytes. */
const STAMP = "2026-01-01T00:00:00Z";

/** GNU tar, whose flags the tarball is written with: a Mac's own `tar` is bsdtar, and GNU's is `gtar` there. */
const GNU_TAR = process.platform === DEVICE_PLATFORM.DARWIN ? "gtar" : "tar";

/** Where each file a release carries comes from. */
export interface ReleaseSources {
  /** The daemon's bundle (`pnpm --filter @luke/host-daemon build`). */
  readonly daemon: string;
  /** The runner's bundle (`pnpm --filter @luke/agent-runner build`). */
  readonly runner: string;
  /** The `vespin-host` command (`scripts/vespin-host.sh`). */
  readonly command: string;
  readonly license: string;
  readonly notice: string;
}

/** The files every release carries, by where each lands under the root folder, the source it comes from, and its mode. */
const RELEASE_FILES = [
  { from: "daemon", to: "lib/vespin-host.mjs", mode: 0o644 },
  { from: "runner", to: "lib/agent-runner.mjs", mode: 0o644 },
  { from: "command", to: "bin/vespin-host", mode: 0o755 },
  { from: "license", to: "LICENSE", mode: 0o644 },
  { from: "notice", to: "NOTICE", mode: 0o644 },
] as const satisfies readonly { from: keyof ReleaseSources; to: string; mode: number }[];

/** The links every release carries, by where each stands under the root folder and the path it names, relative to its own folder. */
const RELEASE_LINKS = [{ at: "bin/luke-host", to: "vespin-host" }] as const;

/** The release's files and links laid out under `root`, whatever stood there before removed. */
export function stagedRelease(root: string, sources: ReleaseSources): void {
  rmSync(root, { recursive: true, force: true });
  for (const file of RELEASE_FILES) {
    mkdirSync(dirname(join(root, file.to)), { recursive: true });
    copyFileSync(sources[file.from], join(root, file.to));
    chmodSync(join(root, file.to), file.mode);
  }
  for (const link of RELEASE_LINKS) symlinkSync(link.to, join(root, link.at));
}

/** The root folder under `staging` packed whole as the tarball given. */
export function packedRelease(staging: string, tarball: string): void {
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
}
