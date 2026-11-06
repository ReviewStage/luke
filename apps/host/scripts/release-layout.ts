import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEVICE_PLATFORM } from "@repo/features/device-agent-wire";

export const ROOT_FOLDER = "vespin-host";

const STAMP = "2026-01-01T00:00:00Z";

const GNU_TAR = process.platform === DEVICE_PLATFORM.DARWIN ? "gtar" : "tar";

export interface ReleaseSources {
  readonly daemon: string;
  readonly runner: string;
  readonly command: string;
  readonly license: string;
  readonly notice: string;
}

const RELEASE_FILES = [
  { from: "daemon", to: "lib/vespin-host.mjs", mode: 0o644 },
  { from: "runner", to: "lib/agent-runner.mjs", mode: 0o644 },
  { from: "command", to: "bin/vespin-host", mode: 0o755 },
  { from: "license", to: "LICENSE", mode: 0o644 },
  { from: "notice", to: "NOTICE", mode: 0o644 },
] as const satisfies readonly { from: keyof ReleaseSources; to: string; mode: number }[];

export function stagedRelease(root: string, sources: ReleaseSources): void {
  rmSync(root, { recursive: true, force: true });
  for (const file of RELEASE_FILES) {
    mkdirSync(dirname(join(root, file.to)), { recursive: true });
    copyFileSync(sources[file.from], join(root, file.to));
    chmodSync(join(root, file.to), file.mode);
  }
}

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
