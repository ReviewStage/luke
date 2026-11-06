import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { packedRelease, ROOT_FOLDER, stagedRelease } from "./release-layout.js";

const VERSION = "0.8.0";

const folders: string[] = [];

const folder = () => {
  const made = mkdtempSync(join(tmpdir(), "vespin-host-release-"));
  folders.push(made);
  return made;
};

afterEach(() => {
  for (const made of folders.splice(0)) rmSync(made, { recursive: true, force: true });
});

it("packs a release whose bin/vespin-host a host finds to run, and whose version it answers", () => {
  const sources = folder();
  const daemon = join(sources, "daemon.mjs");
  writeFileSync(
    daemon,
    `if (process.argv[2] === "version") process.stdout.write("${VERSION}\\n");\n`,
  );
  for (const each of ["runner.mjs", "LICENSE", "NOTICE"]) writeFileSync(join(sources, each), "");
  const staging = folder();
  const root = join(staging, ROOT_FOLDER);
  stagedRelease(root, {
    daemon,
    runner: join(sources, "runner.mjs"),
    command: join(import.meta.dirname, "vespin-host.sh"),
    license: join(sources, "LICENSE"),
    notice: join(sources, "NOTICE"),
  });
  mkdirSync(join(root, "node", "bin"), { recursive: true });
  symlinkSync(process.execPath, join(root, "node", "bin", "node"));
  const tarball = join(folder(), "release.tar.gz");
  packedRelease(staging, tarball);

  const unpacked = folder();
  execFileSync("tar", ["-xf", tarball, "-C", unpacked]);
  const command = join(unpacked, "vespin-host", "bin", "vespin-host");
  const found = statSync(command);
  const answered = execFileSync(command, ["version"], { stdio: ["ignore", "pipe", "ignore"] });

  expect(found.isFile()).toBe(true);
  expect(found.mode & 0o111).not.toBe(0);
  expect(answered.toString().trim()).toBe(VERSION);
});
