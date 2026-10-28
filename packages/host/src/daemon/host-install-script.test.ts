/**
 * host-install-script.test.ts -- the host's install script (`apps/web/install/install.sh`) as a shell runs it: the smolvm release and sandbox image it carries are the ones the daemon pins, a computer it does not run on (a Mac, an Intel Mac, WSL, another kernel) is refused by name, a box without a usable `/dev/kvm` is refused with how to check it before anything is changed, and a download whose SHA-256 is not the one carried is refused.
 *
 * The script is run by `sh` in a temporary folder; `LUKE_HOST_INSTALL_LIBRARY`
 * has it stop after it defines what it carries and its functions, which the
 * tests call, and `LUKE_HOST_KVM_DEVICE` points its KVM check at a path the
 * test made. It never gets as far as touching the box or the network.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { SANDBOX_IMAGE, SMOLVM_LINUX_PIN } from "@luke/agent-runner/pins";

const SCRIPT = join(import.meta.dirname, "../../../../apps/web/install/install.sh");

/** The SHA-256 of the three bytes "abc", from FIPS 180-2's own examples. */
const ABC_SHA256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

const folders: string[] = [];

/** A folder of the test's own. */
const folder = () => {
  const made = mkdtempSync(join(tmpdir(), "luke-host-install-"));
  folders.push(made);
  return made;
};

afterEach(() => {
  for (const made of folders.splice(0)) rmSync(made, { recursive: true, force: true });
});

/** A shell run in a folder of its own, its script text and what it printed and exited with. */
const sh = (args: readonly string[], env: Readonly<Record<string, string>>) =>
  spawnSync("sh", [...args], {
    cwd: folder(),
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
  });

/**
 * A folder holding a `uname` that answers as an x64 Linux box, put first on
 * the script's PATH so its own refusal of other computers lets a test that
 * means to reach the KVM check through on a developer's Mac too.
 */
const linuxUname = () => {
  const bin = folder();
  writeFileSync(
    join(bin, "uname"),
    '#!/bin/sh\ncase "$1" in\n  -m) echo x86_64 ;;\n  *) echo Linux ;;\nesac\n',
    { mode: 0o755 },
  );
  return bin;
};

/** What the script carries after it is sourced as a library, by name. */
const carried = (name: string) => {
  const answer = sh(["-c", `. "${SCRIPT}"; printf '%s' "$${name}"`], {
    LUKE_HOST_INSTALL_LIBRARY: "1",
  });
  expect(answer.status).toBe(0);
  return answer.stdout;
};

describe("the host's install script", () => {
  it("carries the smolvm release and sandbox image the daemon pins", () => {
    expect(carried("SMOLVM_VERSION")).toBe(SMOLVM_LINUX_PIN.VERSION);
    expect(carried("SMOLVM_URL_X64")).toBe(SMOLVM_LINUX_PIN.ARCHIVE.x64);
    expect(carried("SMOLVM_URL_ARM64")).toBe(SMOLVM_LINUX_PIN.ARCHIVE.arm64);
    expect(carried("SMOLVM_SHA256_X64")).toBe(SMOLVM_LINUX_PIN.SHA256.x64);
    expect(carried("SMOLVM_SHA256_ARM64")).toBe(SMOLVM_LINUX_PIN.SHA256.arm64);
    expect(carried("SANDBOX_IMAGE")).toBe(SANDBOX_IMAGE);
  });

  for (const [found, make] of [
    ["is missing", (root: string) => join(root, "kvm")],
    [
      "exists but cannot be opened",
      (root: string) => {
        const directory = join(root, "kvm");
        mkdirSync(directory);
        return directory;
      },
    ],
  ] as const) {
    it(`refuses a box whose /dev/kvm ${found}, saying how to check it, before anything is changed`, () => {
      const root = folder();
      const answer = sh([SCRIPT, "--token", "lkh_fixture"], {
        LUKE_HOST_KVM_DEVICE: make(root),
        PATH: `${linuxUname()}:${process.env.PATH}`,
      });
      expect(answer.status).toBe(1);
      expect(answer.stdout).toBe("");
      expect(answer.stderr).toContain(found);
      expect(answer.stderr).toContain("hardware virtualization (KVM)");
      expect(answer.stderr).toContain("ls -l /dev/kvm");
      expect(answer.stderr).toContain("nested virtualization");
      expect(answer.stderr).toContain("no bare mode");
      expect(answer.stderr).toContain("nothing was installed");
    });
  }

  for (const [computer, kernel, machine, procVersion, words] of [
    [
      "an Apple silicon Mac",
      "Darwin",
      "arm64",
      "",
      "On a Mac, install the Luke app and sign in instead.",
    ],
    ["an Intel Mac", "Darwin", "x86_64", "", "Luke does not run agents on Intel Macs."],
    [
      "WSL",
      "Linux",
      "x86_64",
      "Linux version 6.6.87.2-microsoft-standard-WSL2",
      "Luke host does not run on Windows, including WSL.",
    ],
    ["another kernel", "FreeBSD", "amd64", "", "Luke host runs on Linux, not FreeBSD."],
  ] as const) {
    it(`refuses ${computer} by name`, () => {
      const answer = sh(
        ["-c", `. "${SCRIPT}"; require_supported_os "${kernel}" "${machine}" "${procVersion}"`],
        { LUKE_HOST_INSTALL_LIBRARY: "1" },
      );
      expect(answer.status).toBe(1);
      expect(answer.stderr).toContain(words);
    });
  }

  it("lets a Linux box that is not WSL through", () => {
    const answer = sh(
      [
        "-c",
        `. "${SCRIPT}"; require_supported_os Linux aarch64 "Linux version 6.8.0-45-generic (buildd@ubuntu)"`,
      ],
      { LUKE_HOST_INSTALL_LIBRARY: "1" },
    );
    expect(answer.status).toBe(0);
    expect(answer.stderr).toBe("");
  });

  it("refuses a download whose SHA-256 is not the one carried, and accepts the one that is", () => {
    const download = join(folder(), "download.tar.gz");
    writeFileSync(download, "abc");
    const check = (expected: string) =>
      sh(["-c", `. "${SCRIPT}"; check_sha256 "${download}" "${expected}"`], {
        LUKE_HOST_INSTALL_LIBRARY: "1",
      });

    expect(check(ABC_SHA256).status).toBe(0);
    const refused = check(SMOLVM_LINUX_PIN.SHA256.x64);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(
      `checksum is ${ABC_SHA256}, not ${SMOLVM_LINUX_PIN.SHA256.x64}`,
    );
    expect(refused.stderr).toContain("Nothing was installed");
  });
});
