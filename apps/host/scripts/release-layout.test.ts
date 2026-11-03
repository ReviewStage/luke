/**
 * release-layout.test.ts -- a release laid out and packed as `package.ts` packs one passes the checks a host through 0.6.0 makes before it switches to it: unpacked by the system's `tar`, its `luke-host/bin/luke-host` is a file it may run, and its `version` answers the release's.
 *
 * Those checks are `host-update.ts` as 0.6.0 shipped it, which every host
 * through 0.6.0 updates itself with and which no later release can change:
 * `tar -xf` into a staging folder, `stat` of `luke-host/bin/luke-host`,
 * which follows a link, as a file with an execute bit, and its `version` run
 * with nothing on stdin. The bundles are stand-ins, the daemon's one that
 * answers `version` as the built one does, on the Node running this test in
 * place of the pinned one `package.ts` fetches; the command is the real one.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { packedRelease, ROOT_FOLDER, stagedRelease } from "./release-layout.js";

const VERSION = "0.7.0";

const folders: string[] = [];

/** A folder of the test's own. */
const folder = () => {
  const made = mkdtempSync(join(tmpdir(), "vespin-host-release-"));
  folders.push(made);
  return made;
};

afterEach(() => {
  for (const made of folders.splice(0)) rmSync(made, { recursive: true, force: true });
});

it("packs a release whose bin/luke-host a host through 0.6.0 finds to run, and whose version it answers", () => {
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
  const command = join(unpacked, "luke-host", "bin", "luke-host");
  const found = statSync(command);
  const answered = execFileSync(command, ["version"], { stdio: ["ignore", "pipe", "ignore"] });

  expect(found.isFile()).toBe(true);
  expect(found.mode & 0o111).not.toBe(0);
  expect(answered.toString().trim()).toBe(VERSION);
});
