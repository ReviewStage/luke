/**
 * host-install-script.test.ts -- the host's install script (`apps/web/install/install.sh`) as a shell runs it: the smolvm release and sandbox image it carries are the ones the daemon pins, a computer it does not run on (a Mac, an Intel Mac, WSL1, another kernel) is refused by name while WSL2 is let through, a box without a usable `/dev/kvm` or systemd is refused with how to fix it, said for WSL under WSL alone, a download whose SHA-256 is not the one carried is refused, and the boot check makes, starts, runs and always removes one throwaway VM, failing with smolvm's own words.
 *
 * The script is run by `sh` in a temporary folder; `LUKE_HOST_INSTALL_LIBRARY`
 * has it stop after it defines what it carries and its functions, which the
 * tests call, `LUKE_HOST_KVM_DEVICE` points its KVM check at a path the
 * test made, and `LUKE_HOST_SYSTEMD_RUN_DIR` its systemd check. The boot check
 * runs a fake `smolvm` that writes down what it was asked, through a fake
 * `runuser`. It never gets as far as touching the box or the network.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { SANDBOX_IMAGE, SMOLVM_LINUX_PIN } from "@luke/agent-runner/pins";

const SCRIPT = join(import.meta.dirname, "../../../../apps/web/install/install.sh");

/** /proc/version as WSL2's own kernel writes it. */
const WSL2_PROC_VERSION =
  "Linux version 6.6.87.2-microsoft-standard-WSL2 (root@439a258ad544) (gcc (GCC) 11.2.0) #1 SMP PREEMPT_DYNAMIC";

/** /proc/version as WSL1 writes it, naming Windows' own build. */
const WSL1_PROC_VERSION =
  "Linux version 4.4.0-22621-Microsoft (Microsoft@Microsoft.com) (gcc version 5.4.0 (GCC) ) #2215-Microsoft";

/** /proc/version as a Linux box that is not WSL writes it. */
const LINUX_PROC_VERSION = "Linux version 6.8.0-45-generic (buildd@ubuntu)";

/** The last line smolvm prints where a VM will not boot, as the fake smolvm prints it. */
const SMOLVM_FAILURE = "Error: failed to start machine: KVM_CREATE_VM: Operation not permitted";

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

/** The script sourced as a library on a box whose /proc/version is the one given, then the statements given. */
const onBox = (
  procVersion: string,
  statements: string,
  env: Readonly<Record<string, string>> = {},
) =>
  sh(["-c", `. "${SCRIPT}"; require_supported_os Linux x86_64 "${procVersion}"; ${statements}`], {
    LUKE_HOST_INSTALL_LIBRARY: "1",
    ...env,
  });

/**
 * The boot check run against a fake `smolvm` that writes each command it is
 * given to a file and fails the subcommand named, saying why on its last line
 * after a line of progress, through a fake `runuser` that runs what it is
 * handed as the test's own user, on a box enrolled before. Where asked, the
 * run stopped a running service first, whose unit and fake `systemctl` (failing where asked) stand
 * in the test's folder. Answers what the shell printed and exited with, the
 * commands smolvm was given, and those systemctl was.
 */
const bootCheck = (
  failAt: string,
  service: { readonly stopped: boolean; readonly restartFails?: boolean } = { stopped: false },
) => {
  const bin = linuxUname();
  const root = folder();
  const log = join(root, "smolvm.log");
  const kvm = join(root, "kvm");
  writeFileSync(kvm, "");
  const systemctlLog = join(root, "systemctl.log");
  writeFileSync(systemctlLog, "");
  writeFileSync(join(bin, "runuser"), '#!/bin/sh\nshift 3\nexec "$@"\n', { mode: 0o755 });
  writeFileSync(
    join(bin, "systemctl"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >>"$SYSTEMCTL_LOG"\n${service.restartFails ? '[ "$1" != restart ]\n' : ""}`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "smolvm"),
    [
      "#!/bin/sh",
      'printf \'%s\\n\' "$*" >>"$SMOLVM_LOG"',
      'if [ "$2" = "$SMOLVM_FAIL_AT" ]; then',
      "  echo 'Pulling layers...' >&2",
      `  echo '${SMOLVM_FAILURE}' >&2`,
      "  exit 1",
      "fi",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  // Note that the box is enrolled, its unit written, whether or not its service ran.
  const unitFile = join(root, "luke-host.service");
  writeFileSync(unitFile, "");
  mkdirSync(join(root, "state"));
  writeFileSync(join(root, "state", "device.json"), "{}");
  const answer = sh(
    [
      "-c",
      `. "${SCRIPT}"; HOST_HOME="${root}"; HOST_USER="$(id -un)"; SMOLVM="${join(bin, "smolvm")}"; UNIT_FILE="${unitFile}"; STOPPED_SERVICE=${service.stopped}; require_vm_boots`,
    ],
    {
      LUKE_HOST_INSTALL_LIBRARY: "1",
      LUKE_HOST_KVM_DEVICE: kvm,
      PATH: `${bin}:${process.env.PATH}`,
      SMOLVM_LOG: log,
      SMOLVM_FAIL_AT: failAt,
      SYSTEMCTL_LOG: systemctlLog,
      TMPDIR: folder(),
    },
  );
  const ids = sh(["-c", 'printf "%s:%s" "$(id -u)" "$(id -g)"'], {});
  return {
    answer,
    user: ids.stdout,
    asked: readFileSync(log, "utf8").trim().split("\n"),
    systemctl: readFileSync(systemctlLog, "utf8").trim().split("\n").filter(Boolean),
  };
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
      "WSL1, saying how to upgrade it",
      "Linux",
      "x86_64",
      WSL1_PROC_VERSION,
      "Upgrade it with: wsl --set-version <distro> 2",
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

  for (const [shell, arm64, expected] of [
    ["a native shell on Apple silicon", "1", "arm64"],
    ["a Rosetta shell on Apple silicon", "1", "arm64"],
    ["an Intel Mac", "0", "x86_64"],
  ] as const) {
    it(`reads ${shell} as ${expected}`, () => {
      const bin = folder();
      const machine = shell.startsWith("a native") ? "arm64" : "x86_64";
      writeFileSync(
        join(bin, "uname"),
        `#!/bin/sh\ncase "$1" in\n  -m) echo ${machine} ;;\n  *) echo Darwin ;;\nesac\n`,
        { mode: 0o755 },
      );
      writeFileSync(join(bin, "sysctl"), `#!/bin/sh\necho ${arm64}\n`, { mode: 0o755 });
      const answer = sh(["-c", `. "${SCRIPT}"; hardware_machine`], {
        LUKE_HOST_INSTALL_LIBRARY: "1",
        PATH: `${bin}:${process.env.PATH}`,
      });
      expect(answer.status).toBe(0);
      expect(answer.stdout.trim()).toBe(expected);
    });
  }

  for (const [box, procVersion] of [
    ["a Linux box that is not WSL", LINUX_PROC_VERSION],
    ["WSL2", WSL2_PROC_VERSION],
  ] as const) {
    it(`lets ${box} through`, () => {
      const answer = onBox(procVersion, "true");
      expect(answer.status).toBe(0);
      expect(answer.stderr).toBe("");
    });
  }

  it("says how to turn systemd on under WSL, and only there", () => {
    const env = { LUKE_HOST_SYSTEMD_RUN_DIR: join(folder(), "missing") };
    const wsl = onBox(WSL2_PROC_VERSION, "require_systemd", env);
    const linux = onBox(LINUX_PROC_VERSION, "require_systemd", env);

    expect(wsl.status).toBe(1);
    expect(wsl.stderr).toContain("[boot] systemd=true in /etc/wsl.conf");
    expect(wsl.stderr).toContain("wsl --shutdown");
    expect(linux.status).toBe(1);
    expect(linux.stderr).toContain("Luke host needs systemd.");
    expect(linux.stderr).not.toContain("wsl");
  });

  it("says how to turn nested virtualization on under WSL when /dev/kvm is missing, and only there", () => {
    const env = { LUKE_HOST_KVM_DEVICE: join(folder(), "kvm") };
    const wsl = onBox(WSL2_PROC_VERSION, "require_kvm", env);
    const linux = onBox(LINUX_PROC_VERSION, "require_kvm", env);

    expect(wsl.status).toBe(1);
    expect(wsl.stderr).toContain("[wsl2] nestedVirtualization=true in %UserProfile%\\.wslconfig");
    expect(wsl.stderr).not.toContain("BIOS");
    expect(linux.status).toBe(1);
    expect(linux.stderr).toContain("BIOS or UEFI");
    expect(linux.stderr).not.toContain("wslconfig");
  });

  it("boots one throwaway VM as the daemon makes an agent's, runs true in it, and removes it", () => {
    const { answer, user, asked } = bootCheck("");
    expect(answer.status).toBe(0);
    expect(answer.stdout).toContain("Booted a VM from the sandbox image");
    expect(asked).toEqual([
      "machine stop --name install-boot-check",
      "machine delete --name install-boot-check -f",
      `machine create --name install-boot-check --image ${SANDBOX_IMAGE} --net --user 0:0 --nested -- sh -c while true; do sleep 3600; done`,
      "machine start --name install-boot-check",
      `machine exec --name install-boot-check --user ${user} -- true`,
      "machine stop --name install-boot-check",
      "machine delete --name install-boot-check -f",
    ]);
  });

  it("fails a VM that will not boot with smolvm's last line, leaving a service it did not stop stopped", () => {
    const { answer, systemctl } = bootCheck("start");
    expect(answer.status).toBe(1);
    expect(answer.stdout).not.toContain("Booted");
    expect(answer.stderr).toContain(`smolvm machine start: ${SMOLVM_FAILURE}`);
    expect(answer.stderr).toContain("Luke host was not started");
    expect(systemctl).toEqual([]);
  });

  it("starts again the service this run stopped when its VM will not boot", () => {
    const { answer, systemctl } = bootCheck("start", { stopped: true });
    expect(answer.status).toBe(1);
    expect(answer.stderr).toContain(`smolvm machine start: ${SMOLVM_FAILURE}`);
    expect(answer.stderr).toContain(
      "luke-host.service was restarted on this box's existing enrollment",
    );
    expect(systemctl).toContain("restart luke-host.service");
  });

  it("says so when the service it stopped will not start again", () => {
    const { answer } = bootCheck("start", { stopped: true, restartFails: true });
    expect(answer.status).toBe(1);
    expect(answer.stderr).toContain(`smolvm machine start: ${SMOLVM_FAILURE}`);
    expect(answer.stderr).toContain("luke-host.service could not be started again either");
    expect(answer.stderr).not.toContain("was restarted");
  });

  it("fails a VM that booted but could not be deleted, rather than leave it behind", () => {
    const { answer } = bootCheck("delete");
    expect(answer.status).toBe(1);
    expect(answer.stdout).not.toContain("Booted");
    expect(answer.stderr).toContain(`could not delete it`);
    expect(answer.stderr).toContain(SMOLVM_FAILURE);
  });

  it("removes the throwaway VM when a command in it fails", () => {
    const { answer, asked } = bootCheck("exec");
    expect(answer.status).toBe(1);
    expect(asked.slice(-2)).toEqual([
      "machine stop --name install-boot-check",
      "machine delete --name install-boot-check -f",
    ]);
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
