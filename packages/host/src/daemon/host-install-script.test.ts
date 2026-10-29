/**
 * host-install-script.test.ts -- the host's install script (`apps/web/install/install.sh`) as a shell runs it: the smolvm release, sandbox image and Mac paths it carries are the ones the daemon and the desktop app name, a computer it does not run on (an Intel Mac, an old macOS, WSL1, another kernel) is refused by name while an Apple silicon Mac and WSL2 are let through, a box without a usable `/dev/kvm` or systemd is refused with how to fix it, said for WSL under WSL alone, a download whose SHA-256 is not the one carried is refused, the boot check makes, starts, runs and always removes one throwaway VM, failing with smolvm's own words, and a Mac's install refuses a missing sudo user and a Mac the Luke app already runs agents on, writes its LaunchAgent, and starts it only where its user is logged in.
 *
 * The script is run by `sh` in a temporary folder; `LUKE_HOST_INSTALL_LIBRARY`
 * has it stop after it defines what it carries and its functions, which the
 * tests call, `LUKE_HOST_KVM_DEVICE` points its KVM check at a path the
 * test made, and `LUKE_HOST_SYSTEMD_RUN_DIR` its systemd check. A fake `uname`,
 * `sysctl`, `sw_vers` or `launchctl` put first on its PATH answers as the
 * computer a test means. The boot check runs a fake `smolvm` that writes down
 * what it was asked, through a fake `runuser`. It never gets as far as
 * touching the box or the network.
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { SANDBOX_IMAGE, SMOLVM_LINUX_PIN } from "@luke/agent-runner/pins";
import { DARWIN_HOST } from "./host-os.js";

const SCRIPT = join(import.meta.dirname, "../../../../apps/web/install/install.sh");
const UNINSTALL_SCRIPT = join(import.meta.dirname, "../../../../apps/host/scripts/luke-host.sh");

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

/**
 * A folder holding a `uname`, `sysctl` and `sw_vers` that answer as a Mac of
 * the machine given (`arm64` for Apple silicon) running the macOS given, put
 * first on the script's PATH.
 */
const macBin = (machine: string, macos: string) => {
  const bin = folder();
  writeFileSync(
    join(bin, "uname"),
    `#!/bin/sh\ncase "$1" in\n  -m) echo ${machine} ;;\n  *) echo Darwin ;;\nesac\n`,
    { mode: 0o755 },
  );
  writeFileSync(join(bin, "sysctl"), `#!/bin/sh\necho ${machine === "arm64" ? 1 : 0}\n`, {
    mode: 0o755,
  });
  writeFileSync(join(bin, "sw_vers"), `#!/bin/sh\necho ${macos}\n`, { mode: 0o755 });
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
  const work = folder();
  const tmp = folder();
  const answer = sh(
    [
      "-c",
      `. "${SCRIPT}"; HOST_HOME="${root}"; HOST_USER="$(id -un)"; SMOLVM="${join(bin, "smolvm")}"; UNIT_FILE="${unitFile}"; STOPPED_SERVICE=${service.stopped}; work="${work}"; require_vm_boots`,
    ],
    {
      LUKE_HOST_INSTALL_LIBRARY: "1",
      LUKE_HOST_KVM_DEVICE: kvm,
      PATH: `${bin}:${process.env.PATH}`,
      SMOLVM_LOG: log,
      SMOLVM_FAIL_AT: failAt,
      SYSTEMCTL_LOG: systemctlLog,
      TMPDIR: tmp,
    },
  );
  const ids = sh(["-c", 'printf "%s:%s" "$(id -u)" "$(id -g)"'], {});
  return {
    answer,
    user: ids.stdout,
    work,
    tmp,
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

  for (const [computer, machine, macos, refusal] of [
    ["an Apple silicon Mac on macOS 14.5", "arm64", "14.5", undefined],
    [
      "an Apple silicon Mac on macOS 12.2",
      "arm64",
      "12.2",
      "Luke host needs macOS 12.3 or later, and this Mac runs macOS 12.2.",
    ],
    ["an Intel Mac", "x86_64", "14.5", "Luke does not run agents on Intel Macs."],
  ] as const) {
    it(`${refusal === undefined ? "lets" : "refuses"} ${computer} ${refusal === undefined ? "through, past every check of the computer" : "by name"}, before anything is changed`, () => {
      const answer = sh([SCRIPT, "--token", "lkh_fixture"], {
        PATH: `${macBin(machine, macos)}:${process.env.PATH}`,
      });
      expect(answer.status).toBe(1);
      expect(answer.stdout).toBe("");
      if (refusal === undefined) {
        // Note that the next word is about who runs it: root, or with sudo from a Mac account.
        expect(answer.stderr).toContain("sudo sh -s -- --token <token>");
        expect(answer.stderr).not.toMatch(/Intel|macOS|kvm/u);
      } else {
        expect(answer.stderr).toContain(refusal);
      }
    });
  }

  it("refuses a Mac's install with no sudo user to install for", () => {
    const answer = sh(["-c", `. "${SCRIPT}"; require_mac_user`], {
      LUKE_HOST_INSTALL_LIBRARY: "1",
    });
    expect(answer.status).toBe(1);
    expect(answer.stderr).toContain("Run it with sudo from the Mac account");
  });

  it("writes a LaunchAgent that runs the release at login on its own state, again after a crash only, logging under the user's Logs", () => {
    const plist = join(folder(), "agent.plist");
    const app = "/Users/ada/Library/Application Support/Luke Host";
    const log = "/Users/ada/Library/Logs/Luke Host/luke-host.log";
    const answer = sh(
      [
        "-c",
        `. "${SCRIPT}"; write_launch_agent "$1" "$2/luke-host" "$2/state" "$3"`,
        "sh",
        plist,
        app,
        log,
      ],
      { LUKE_HOST_INSTALL_LIBRARY: "1" },
    );
    expect(answer.status).toBe(0);

    const written = readFileSync(plist, "utf8").replace(/>\s+</gu, "><");
    for (const entry of [
      "<key>Label</key><string>dev.reviewstage.luke.host.standalone</string>",
      `<key>ProgramArguments</key><array><string>${app}/luke-host/bin/luke-host</string><string>run</string></array>`,
      `<key>EnvironmentVariables</key><dict><key>LUKE_HOST_STATE_ROOT</key><string>${app}/state</string></dict>`,
      "<key>RunAtLoad</key><true/>",
      "<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>",
      `<key>StandardOutPath</key><string>${log}</string>`,
      `<key>StandardErrorPath</key><string>${log}</string>`,
    ]) {
      expect(written).toContain(entry);
    }
  });

  for (const [user, session, started] of [
    ["logged in", 0, true],
    ["logged out", 113, false],
  ] as const) {
    it(`starts the LaunchAgent in the session of a user who is ${user}${started ? "" : ", and says it starts at their next login"}`, () => {
      const bin = folder();
      const asked = join(bin, "asked");
      writeFileSync(
        join(bin, "launchctl"),
        `#!/bin/sh\nprintf '%s\\n' "$*" >>"${asked}"\n[ "$1" != print ] || exit ${session}\n`,
        { mode: 0o755 },
      );
      const answer = sh(["-c", `. "${SCRIPT}"; start_launch_agent 501 /fixture/agent.plist`], {
        LUKE_HOST_INSTALL_LIBRARY: "1",
        PATH: `${bin}:${process.env.PATH}`,
      });

      expect(answer.status).toBe(started ? 0 : 1);
      const bootstrapped = readFileSync(asked, "utf8").includes(
        "bootstrap gui/501 /fixture/agent.plist",
      );
      expect(bootstrapped).toBe(started);
      expect(answer.stdout).toContain(started ? "Started" : "starts at this account's next login");
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

  it("keeps the boot check's temporary files in its work folder, never in the system's", () => {
    const { answer, work, tmp } = bootCheck("start");
    expect(answer.status).toBe(1);
    expect(readdirSync(work).sort()).toEqual(["boot-removal", "boot-said"]);
    expect(readdirSync(tmp)).toEqual([]);
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "deletes the throwaway VM when %s interrupts the boot check, and ends the step in flight",
    async (signal) => {
      const bin = linuxUname();
      const root = folder();
      const log = join(root, "smolvm.log");
      const started = join(root, "started");
      execFileSync("mkfifo", [started]);
      const kvm = join(root, "kvm");
      writeFileSync(kvm, "");
      writeFileSync(join(bin, "runuser"), '#!/bin/sh\nshift 3\nexec "$@"\n', { mode: 0o755 });
      // Note that the fake VM's start hangs, as one that will not boot does, until the script ends it.
      writeFileSync(
        join(bin, "smolvm"),
        [
          "#!/bin/sh",
          'printf \'%s\\n\' "$*" >>"$SMOLVM_LOG"',
          'if [ "$2" = start ]; then',
          '  echo started >"$SMOLVM_STARTED"',
          "  exec sleep 30",
          "fi",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      const unitFile = join(root, "luke-host.service");
      writeFileSync(unitFile, "");
      const work = folder();
      const script = spawn(
        "sh",
        [
          "-c",
          `. "${SCRIPT}"; HOST_HOME="${root}"; HOST_USER="$(id -un)"; SMOLVM="${join(bin, "smolvm")}"; UNIT_FILE="${unitFile}"; STOPPED_SERVICE=false; work="${work}"; require_vm_boots`,
        ],
        {
          env: {
            PATH: `${bin}:${process.env.PATH}`,
            LUKE_HOST_INSTALL_LIBRARY: "1",
            LUKE_HOST_KVM_DEVICE: kvm,
            SMOLVM_LOG: log,
            SMOLVM_STARTED: started,
          },
          stdio: "ignore",
        },
      );
      const ended = new Promise<number | null>((resolve) => script.on("exit", resolve));
      try {
        // Note that the fake VM's start writes to a pipe only once the test reads it, so the signal is sent as the start is under way, with no waiting on the clock.
        await new Promise<void>((resolve, reject) => {
          const reader = createReadStream(started);
          reader.once("data", () => {
            reader.destroy();
            resolve();
          });
          reader.once("error", reject);
          script.once("exit", () => reject(new Error("the boot check ended before its start")));
        });

        script.kill(signal);
      } catch (failure) {
        // Note that a script a failed test left running is ended, so it holds nothing open.
        script.kill("SIGKILL");
        throw failure;
      }

      expect(await ended).toBe(1);
      expect(readFileSync(log, "utf8").trim().split("\n").slice(-2)).toEqual([
        "machine stop --name install-boot-check",
        "machine delete --name install-boot-check -f",
      ]);
    },
  );

  it.each([
    { appHost: false, loaded: false, kept: false, status: 0 },
    { appHost: true, loaded: false, kept: true, status: 0 },
    { appHost: false, loaded: true, kept: true, status: 1 },
  ])(
    "a Mac's uninstall removes the agents' machines and folders under the installing user's home, never root's, and leaves the clones the desktop app shares, unless the Luke app's state is there or the LaunchAgent will not stop (app state: $appHost, still loaded: $loaded)",
    ({ appHost, loaded, kept, status }) => {
      const bin = folder();
      const home = folder();
      const rootHome = folder();
      const script = join(folder(), "bin");
      const deletes = join(folder(), "deletes.log");
      mkdirSync(script);
      for (const [name, body] of Object.entries({
        uname: "echo Darwin",
        id: '[ "$1" = -u ] && { [ -n "$2" ] && echo 501 || echo 0; }',
        dscl: `echo "NFSHomeDirectory: ${home}"`,
        launchctl: `[ "$1" != print ] || exit ${loaded ? 0 : 1}`,
        sudo: 'shift 3; exec "$@"',
      })) {
        writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
      }
      // Note that one smolvm store holds the app's agents' machines and this install's alike.
      const smolvm = join(
        home,
        "Library/Application Support/Luke Host/state/agent-tools/smolvm/1/smolvm",
      );
      mkdirSync(join(smolvm, ".."), { recursive: true });
      writeFileSync(
        smolvm,
        `#!/bin/sh\ncase "$1 $2" in\n  "machine ls") printf 'luke-one\\nother\\n' ;;\n  "machine delete") echo "$4" >> "${deletes}" ;;\nesac\n`,
        { mode: 0o755 },
      );
      for (const place of [home, rootHome]) {
        for (const each of ["agents/one", "clones/acme", "keep"]) {
          mkdirSync(join(place, ".luke", each), { recursive: true });
        }
      }
      if (appHost) {
        const appState = DARWIN_HOST.stateRoot(home, { developerIdSigned: true });
        mkdirSync(appState, { recursive: true });
        writeFileSync(join(appState, "device.json"), "{}");
      }
      writeFileSync(join(script, "luke-host"), readFileSync(UNINSTALL_SCRIPT), { mode: 0o755 });

      const answer = spawnSync("sh", [join(script, "luke-host"), "uninstall"], {
        env: { PATH: `${bin}:${process.env.PATH}`, SUDO_USER: "mac", HOME: rootHome },
        encoding: "utf8",
      });

      expect(answer.status).toBe(status);
      expect(existsSync(join(home, ".luke/agents"))).toBe(kept);
      expect(existsSync(deletes) ? readFileSync(deletes, "utf8").trim().split("\n") : []).toEqual(
        kept ? [] : ["luke-one"],
      );
      expect(existsSync(join(home, ".luke/clones"))).toBe(true);
      expect(existsSync(join(home, ".luke/keep"))).toBe(true);
      expect(existsSync(join(rootHome, ".luke/agents"))).toBe(true);
      expect(existsSync(join(rootHome, ".luke/clones"))).toBe(true);
    },
  );

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
