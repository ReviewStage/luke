/**
 * host-install-script.test.ts -- the host's install script (`apps/web/install/install.sh`) as a shell runs it: a computer it does not run on (an Intel Mac, an old macOS, WSL1, another kernel) is refused by name while an Apple silicon Mac and WSL2 are let through, a box without systemd or whose user manager cannot be reached is refused with how to fix it, a run under sudo from another account and an install that came before are refused, lingering is turned on with sudo only where the account may not turn it on itself, a download whose SHA-256 is not the one carried is refused, a Mac's LaunchAgent is written and started only where its user is logged in, and a whole run installs the release into the account, starts its service only once the box is connected, in the layout `luke-host uninstall` removes, and keeps the pairing when run again. Beside it, the host's own `luke-host uninstall` (`apps/host/scripts/luke-host.sh`) as an account install and a Mac's earlier install run it.
 *
 * The script is run by `sh` in a temporary folder; `LUKE_HOST_INSTALL_LIBRARY`
 * has it stop after it defines what it carries and its functions, which the
 * tests call, and `LUKE_HOST_SYSTEMD_RUN_DIR` points its systemd check at a
 * folder the test made. A fake `uname`, `sysctl`, `sw_vers`, `systemctl`,
 * `loginctl`, `sudo`, `launchctl` or `curl` put first on its PATH answers as
 * the computer a test means, and writes down what it was asked. A whole run is
 * handed the script with a release written in, as the route that serves it
 * writes one, whose tarball the fake `curl` copies from the test's folder: the
 * host's real launcher over a fake Node that answers `connect`. It never gets
 * as far as touching the box or the network.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";

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

/**
 * The origin a run is handed, since the script as it stands here leaves its
 * own to the route that serves it (`@@ORIGIN@@`).
 */
const ORIGIN = "https://luke.test";
const ORIGIN_ARGS = ["--origin", ORIGIN] as const;

/** The SHA-256 of the three bytes "abc", from FIPS 180-2's own examples. */
const ABC_SHA256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

/** The SHA-256 of no bytes at all. */
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** A Mac's LaunchAgent, by its label. */
const LABEL = "dev.reviewstage.luke.host.standalone";

const OS = { LINUX: "Linux", DARWIN: "Darwin" } as const;

type Os = (typeof OS)[keyof typeof OS];

/**
 * The Node a release's launcher runs its bundle on, faked: it writes down
 * each command, and answers `connect` as the daemon does, at once where the
 * box's record stands, with the denial where `FAKE_CONNECT_EXIT` names a
 * code, and otherwise by writing `FAKE_PAIRING` as the record.
 */
const FAKE_NODE = [
  "#!/bin/sh",
  "shift",
  `printf 'luke-host %s\\n' "$*" >>"$FAKE_ASKED"`,
  '[ "$1" = connect ] || exit 0',
  'if [ -f "$LUKE_HOST_STATE_ROOT/device.json" ]; then echo "This box is already connected."; exit 0; fi',
  'if [ -n "$FAKE_CONNECT_EXIT" ]; then echo "The code was denied in Luke, so this box was not connected." >&2; exit "$FAKE_CONNECT_EXIT"; fi',
  'mkdir -p "$LUKE_HOST_STATE_ROOT"',
  `printf '%s' "$FAKE_PAIRING" >"$LUKE_HOST_STATE_ROOT/device.json"`,
  "echo 'Connected as box.'",
  "",
].join("\n");

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

/** A folder holding a command for each body given, by its name, to put first on a PATH. */
const bin = (commands: Readonly<Record<string, string>>) => {
  const made = folder();
  for (const [name, body] of Object.entries(commands)) {
    writeFileSync(join(made, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  return made;
};

/** A `uname` that answers as the OS given on the machine given. */
const uname = (os: Os, machine: string) =>
  `case "$1" in\n  -m) echo ${machine} ;;\n  *) echo ${os} ;;\nesac`;

/**
 * A folder holding a `uname`, `sysctl` and `sw_vers` that answer as a Mac of
 * the machine given (`arm64` for Apple silicon) running the macOS given, put
 * first on the script's PATH.
 */
const macBin = (machine: string, macos: string) =>
  bin({
    uname: uname(OS.DARWIN, machine),
    sysctl: `echo ${machine === "arm64" ? 1 : 0}`,
    sw_vers: `echo ${macos}`,
  });

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

/** Whether anything stands at the path given, a link to nothing among it. */
const stands = (place: string) => lstatSync(place, { throwIfNoEntry: false }) !== undefined;

/** The name of the account the tests run as. */
const accountName = () => spawnSync("id", ["-un"], { encoding: "utf8" }).stdout.trim();

/**
 * Packs a release of the version given into the folder given, as CI packs one
 * under a `luke-host` folder, with the host's real launcher over the fake
 * Node, and answers the script with that release written in, its tarball at
 * one address for every target, as the route that serves it writes one.
 */
function servedScript(served: string, version: string): string {
  const packed = folder();
  const top = join(packed, "luke-host");
  for (const each of ["bin", "node/bin", "lib"]) mkdirSync(join(top, each), { recursive: true });
  writeFileSync(join(top, "bin/luke-host"), readFileSync(UNINSTALL_SCRIPT), { mode: 0o755 });
  writeFileSync(join(top, "node/bin/node"), FAKE_NODE, { mode: 0o755 });
  writeFileSync(join(top, "lib/luke-host.mjs"), "");
  const tarball = join(served, `luke-host-${version}.tar.gz`);
  execFileSync("tar", ["-czf", tarball, "-C", packed, "luke-host"]);
  const sha256 = createHash("sha256").update(readFileSync(tarball)).digest("hex");
  const url = `https://releases.test/luke-host-${version}.tar.gz`;
  let script = readFileSync(SCRIPT, "utf8");
  for (const [placeholder, value] of Object.entries({
    "@@VERSION@@": version,
    "@@SHA256_X64@@": sha256,
    "@@SHA256_ARM64@@": sha256,
    "@@SHA256_DARWIN_ARM64@@": sha256,
    "@@URL_X64@@": url,
    "@@URL_ARM64@@": url,
    "@@URL_DARWIN_ARM64@@": url,
    "@@ORIGIN@@": ORIGIN,
  })) {
    script = script.replaceAll(placeholder, value);
  }
  const file = join(folder(), "install.sh");
  writeFileSync(file, script);
  return file;
}

/**
 * A computer of the OS given for whole runs of the script: a home of its own,
 * and fakes first on its PATH that answer as that OS, keep what they were
 * asked in one log, and serve a release's tarball from the folder the box
 * keeps them in. The account lingers unless asked otherwise; where it does
 * not, `loginctl` turns lingering on only where the account may itself, or
 * under `sudo`, which refuses where asked.
 */
const box = (
  os: Os,
  options: {
    readonly lingers?: boolean;
    readonly selfLinger?: boolean;
    readonly sudoRefused?: boolean;
  } = {},
) => {
  const home = folder();
  const root = folder();
  const served = folder();
  const asked = join(root, "asked.log");
  writeFileSync(asked, "");
  if (options.lingers ?? true) writeFileSync(join(root, "lingering"), "");
  const fakes = bin({
    uname: uname(os, os === OS.LINUX ? "x86_64" : "arm64"),
    sysctl: "echo 1",
    sw_vers: "echo 14.5",
    curl: 'while [ "$#" -gt 1 ]; do\n  [ "$1" != -o ] || out="$2"\n  shift\ndone\ncp "$FAKE_SERVED/$(basename "$1")" "$out"',
    systemctl: [
      `printf 'systemctl %s\\n' "$*" >>"$FAKE_ASKED"`,
      'case "$2" in',
      '  restart) echo active >"$FAKE_ROOT/unit" ;;',
      '  stop | disable) echo inactive >"$FAKE_ROOT/unit" ;;',
      '  is-active) cat "$FAKE_ROOT/unit" 2>/dev/null || echo inactive ;;',
      "esac",
    ].join("\n"),
    loginctl: [
      `printf 'loginctl %s\\n' "$*" >>"$FAKE_ASKED"`,
      'case "$*" in',
      '  show-user*) if [ -e "$FAKE_ROOT/lingering" ]; then echo yes; else echo no; fi ;;',
      '  *enable-linger*) [ -n "$FAKE_AS_ROOT" ] || [ -n "$FAKE_SELF_LINGER" ] || exit 1; touch "$FAKE_ROOT/lingering" ;;',
      "esac",
    ].join("\n"),
    sudo: `printf 'sudo %s\\n' "$*" >>"$FAKE_ASKED"\n[ -z "$FAKE_SUDO_REFUSED" ] || exit 1\nFAKE_AS_ROOT=1 exec "$@"`,
    launchctl: [
      `printf 'launchctl %s\\n' "$*" >>"$FAKE_ASKED"`,
      'case "$1" in',
      '  bootstrap) touch "$FAKE_ROOT/loaded" ;;',
      '  bootout) rm -f "$FAKE_ROOT/loaded" ;;',
      '  print) case "$2" in */*/*) [ -e "$FAKE_ROOT/loaded" ] ;; esac ;;',
      "esac",
    ].join("\n"),
  });
  const env: Record<string, string> = {
    PATH: `${fakes}:${process.env.PATH}`,
    HOME: home,
    LUKE_HOST_SYSTEMD_RUN_DIR: root,
    FAKE_ASKED: asked,
    FAKE_ROOT: root,
    FAKE_SERVED: served,
    FAKE_PAIRING: "paired",
    ...(options.selfLinger ? { FAKE_SELF_LINGER: "1" } : {}),
    ...(options.sudoRefused ? { FAKE_SUDO_REFUSED: "1" } : {}),
  };
  const run = (args: readonly string[], extra: Readonly<Record<string, string>> = {}) =>
    spawnSync("sh", [...args], { cwd: folder(), env: { ...env, ...extra }, encoding: "utf8" });
  return {
    home,
    releases: join(home, ".local/share/luke-host"),
    link: join(home, ".local/bin/luke-host"),
    state: join(home, ".local/state/luke-host"),
    service:
      os === OS.LINUX
        ? join(home, ".config/systemd/user/luke-host.service")
        : join(home, `Library/LaunchAgents/${LABEL}.plist`),
    run,
    /** Serves the release of the version given, and runs the script it is written into. */
    install: (version: string, extra: Readonly<Record<string, string>> = {}) =>
      run([servedScript(served, version)], extra),
    asked: () => readFileSync(asked, "utf8").trim().split("\n").filter(Boolean),
  };
};

describe("the host's install script", () => {
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
      const machine = shell.startsWith("a native") ? "arm64" : "x86_64";
      const fakes = bin({ uname: uname(OS.DARWIN, machine), sysctl: `echo ${arm64}` });
      const answer = sh(["-c", `. "${SCRIPT}"; hardware_machine`], {
        LUKE_HOST_INSTALL_LIBRARY: "1",
        PATH: `${fakes}:${process.env.PATH}`,
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
      // Note that the run is under sudo from another account, which the next check refuses, so a Mac let through goes no further.
      const answer = sh([SCRIPT, ...ORIGIN_ARGS], {
        PATH: `${macBin(machine, macos)}:${process.env.PATH}`,
        SUDO_USER: "someone-else",
      });
      expect(answer.status).toBe(1);
      expect(answer.stdout).toBe("");
      if (refusal === undefined) {
        expect(answer.stderr).toContain("Run it without sudo");
        expect(answer.stderr).not.toMatch(/Intel|macOS/u);
      } else {
        expect(answer.stderr).toContain(refusal);
      }
    });
  }

  it("refuses a run under sudo from another account, naming the command without sudo, before anything is changed", () => {
    const computer = box(OS.LINUX);
    const answer = computer.install("0.3.0", { SUDO_USER: "someone-else" });

    expect(answer.status).toBe(1);
    expect(answer.stdout).toBe("");
    expect(answer.stderr).toContain(
      `Run it without sudo, as the account whose agents Luke host should run: curl -fsSL ${ORIGIN}/install.sh | sh`,
    );
    expect(existsSync(computer.releases)).toBe(false);
  });

  it.each([
    { os: OS.LINUX, earlier: (root: string) => join(root, "opt/luke-host") },
    {
      os: OS.DARWIN,
      earlier: (home: string) => join(home, "Library/Application Support/Luke Host"),
    },
  ])(
    "refuses to install over an install that came before on $os, naming that install's own uninstall command",
    ({ os, earlier }) => {
      const home = folder();
      const made = earlier(home);
      mkdirSync(made, { recursive: true });
      const answer = sh(
        ["-c", `. "${SCRIPT}"; EARLIER_INSTALL_DIR="$1"; require_no_earlier_install`, "sh", made],
        {
          LUKE_HOST_INSTALL_LIBRARY: "1",
          HOME: home,
          PATH: `${bin({ uname: uname(os, "arm64") })}:${process.env.PATH}`,
        },
      );

      expect(answer.status).toBe(1);
      expect(answer.stderr).toContain(
        os === OS.LINUX
          ? `Remove it first with: sudo ${made}/bin/luke-host uninstall`
          : `Remove it first with: sudo '${made}/luke-host/bin/luke-host' uninstall`,
      );
    },
  );

  for (const [computer, procVersion] of [
    ["a Linux box that is not WSL", LINUX_PROC_VERSION],
    ["WSL2", WSL2_PROC_VERSION],
  ] as const) {
    it(`lets ${computer} through`, () => {
      const answer = onBox(procVersion, "true");
      expect(answer.status).toBe(0);
      expect(answer.stderr).toBe("");
    });
  }

  it("says how to turn systemd on under WSL, and only there", () => {
    const env = { LUKE_HOST_SYSTEMD_RUN_DIR: join(folder(), "missing") };
    const wsl = onBox(WSL2_PROC_VERSION, "require_user_manager", env);
    const linux = onBox(LINUX_PROC_VERSION, "require_user_manager", env);

    expect(wsl.status).toBe(1);
    expect(wsl.stderr).toContain("[boot] systemd=true in /etc/wsl.conf");
    expect(wsl.stderr).toContain("wsl --shutdown");
    expect(linux.status).toBe(1);
    expect(linux.stderr).toContain("Luke host needs systemd.");
    expect(linux.stderr).not.toContain("wsl");
  });

  it("refuses a box whose systemd user manager for the account cannot be reached, saying to run it from a login of that account", () => {
    const answer = onBox(LINUX_PROC_VERSION, "require_user_manager", {
      LUKE_HOST_SYSTEMD_RUN_DIR: folder(),
      PATH: `${bin({ systemctl: "exit 1" })}:${process.env.PATH}`,
    });

    expect(answer.status).toBe(1);
    expect(answer.stderr).toContain("Could not reach the systemd user manager");
    expect(answer.stderr).toContain("rather than through su or sudo");
  });

  it.each([
    { case: "lingers already", lingers: true, selfLinger: false, sudoRefused: false },
    { case: "may turn lingering on itself", lingers: false, selfLinger: true, sudoRefused: false },
    { case: "may not, through sudo", lingers: false, selfLinger: false, sudoRefused: false },
    { case: "may not, and sudo is refused", lingers: false, selfLinger: false, sudoRefused: true },
  ])(
    "a Linux account that $case asks sudo for nothing but lingering, only where it may not turn lingering on itself, and installs nothing without it",
    ({ lingers, selfLinger, sudoRefused }) => {
      const computer = box(OS.LINUX, { lingers, selfLinger, sudoRefused });
      const answer = computer.install("0.3.0");

      const needsSudo = !lingers && !selfLinger;
      expect(answer.status).toBe(sudoRefused ? 1 : 0);
      expect(computer.asked().filter((line) => line.startsWith("sudo "))).toEqual(
        needsSudo ? [`sudo loginctl enable-linger ${accountName()}`] : [],
      );
      expect(answer.stdout.includes("which this account may not turn on by itself")).toBe(
        needsSudo,
      );
      expect(existsSync(computer.releases)).toBe(!sudoRefused);
      if (sudoRefused) expect(answer.stderr).toContain("so nothing was installed");
    },
  );

  it.each([OS.LINUX, OS.DARWIN])(
    "a whole run on %s installs the release into the account, starts its service only once connect has connected the box, and leaves the layout luke-host uninstall removes",
    (os) => {
      const computer = box(os);
      const answer = computer.install("0.3.0");

      expect(answer.status, answer.stderr).toBe(0);
      expect(answer.stdout).toContain("Connected.");
      expect(readlinkSync(join(computer.releases, "current"))).toBe("versions/0.3.0");
      expect(readlinkSync(computer.link)).toBe(join(computer.releases, "current/bin/luke-host"));
      expect(readFileSync(computer.service, "utf8")).toContain(
        `${computer.releases}/current/bin/luke-host`,
      );
      expect(readFileSync(join(computer.state, "device.json"), "utf8")).toBe("paired");
      const asked = computer.asked();
      const connected = asked.indexOf(`luke-host connect --origin ${ORIGIN}`);
      const started = asked.findIndex(
        (line) =>
          line === "systemctl --user restart luke-host.service" ||
          line.startsWith(`launchctl bootstrap gui/`),
      );
      expect(connected).toBeGreaterThanOrEqual(0);
      expect(started).toBeGreaterThan(connected);

      const removed = computer.run([computer.link, "uninstall"]);
      expect(removed.status, removed.stderr).toBe(0);
      for (const place of [computer.releases, computer.state, computer.service, computer.link]) {
        expect(stands(place)).toBe(false);
      }
    },
  );

  it("ends a run whose code is denied with connect's words and how to try again, its service not started", () => {
    const computer = box(OS.LINUX);
    const answer = computer.install("0.3.0", { FAKE_CONNECT_EXIT: "2" });

    expect(answer.status).toBe(2);
    expect(answer.stderr).toContain("The code was denied in Luke");
    expect(answer.stderr).toContain(
      `Run the install command again for a new code: curl -fsSL ${ORIGIN}/install.sh | sh`,
    );
    expect(computer.asked().some((line) => /systemctl --user (enable|restart)/u.test(line))).toBe(
      false,
    );
    expect(existsSync(computer.service)).toBe(false);
  });

  it("run again on a connected box, upgrades in place: keeps its pairing, moves current to the new release, removes the old one, and restarts the service", () => {
    const computer = box(OS.LINUX);
    expect(computer.install("0.2.9").status).toBe(0);
    const before = computer.asked().length;

    // Note that a pairing made again would be written as this one, so a run that lost the box's would show.
    const answer = computer.install("0.3.0", { FAKE_PAIRING: "paired again" });

    expect(answer.status, answer.stderr).toBe(0);
    expect(answer.stdout).toContain("This box is already connected.");
    expect(readFileSync(join(computer.state, "device.json"), "utf8")).toBe("paired");
    expect(readlinkSync(join(computer.releases, "current"))).toBe("versions/0.3.0");
    expect(readdirSync(join(computer.releases, "versions"))).toEqual(["0.3.0"]);
    expect(readdirSync(computer.releases).sort()).toEqual(["current", "versions"]);
    expect(computer.asked().slice(before)).toContain("systemctl --user restart luke-host.service");
  });

  it("writes a LaunchAgent that runs the release through current at login, again after a crash only, logging where it is told", () => {
    const home = folder();
    const plist = join(folder(), "agent.plist");
    const log = join(home, "Library/Logs/Luke Host/luke-host.log");
    const answer = sh(
      ["-c", `. "${SCRIPT}"; account_paths; write_launch_agent "$1" "$2"`, "sh", plist, log],
      { LUKE_HOST_INSTALL_LIBRARY: "1", HOME: home },
    );
    expect(answer.status).toBe(0);

    const written = readFileSync(plist, "utf8").replace(/>\s+</gu, "><");
    for (const entry of [
      `<key>Label</key><string>${LABEL}</string>`,
      `<key>ProgramArguments</key><array><string>${home}/.local/share/luke-host/current/bin/luke-host</string><string>run</string></array>`,
      "<key>RunAtLoad</key><true/>",
      "<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>",
      `<key>StandardOutPath</key><string>${log}</string>`,
      `<key>StandardErrorPath</key><string>${log}</string>`,
    ]) {
      expect(written).toContain(entry);
    }
  });

  it("refuses a Mac's install, before it swaps anything, while the running LaunchAgent will not stop", () => {
    const answer = sh(["-c", `. "${SCRIPT}"; stop_launch_agent 501`], {
      LUKE_HOST_INSTALL_LIBRARY: "1",
      LUKE_HOST_MAC_STOP_WAIT_SECONDS: "0",
      PATH: `${bin({ launchctl: "exit 0" })}:${process.env.PATH}`,
    });

    expect(answer.status).toBe(1);
    expect(answer.stderr).toContain(
      "Could not stop Luke host for this account, so nothing was changed",
    );
  });

  for (const [user, session, bootstrap, words] of [
    ["logged in", 0, 0, "Started"],
    ["logged in, where launchd will not start it from here", 0, 5, "could not start"],
    ["logged out", 113, 0, "starts at this account's next login"],
  ] as const) {
    it(`starts the LaunchAgent in the session of a user who is ${user}, or says it starts at their next login`, () => {
      const fakes = folder();
      const asked = join(fakes, "asked");
      writeFileSync(
        join(fakes, "launchctl"),
        `#!/bin/sh\nprintf '%s\\n' "$*" >>"${asked}"\n[ "$1" != print ] || exit ${session}\n[ "$1" != bootstrap ] || exit ${bootstrap}\n`,
        { mode: 0o755 },
      );
      const answer = sh(["-c", `. "${SCRIPT}"; start_launch_agent 501 /fixture/agent.plist`], {
        LUKE_HOST_INSTALL_LIBRARY: "1",
        PATH: `${fakes}:${process.env.PATH}`,
      });

      expect(answer.status).toBe(session === 0 && bootstrap === 0 ? 0 : 1);
      expect(readFileSync(asked, "utf8").includes("bootstrap gui/501 /fixture/agent.plist")).toBe(
        session === 0,
      );
      expect(answer.stdout).toContain(words);
    });
  }

  it.each([
    { loaded: false, status: 0 },
    { loaded: true, status: 1 },
  ])(
    "a Mac's uninstall removes the machines and folders of the agents its daemon made, never another Luke install's or root's, and leaves the clones every install shares, unless the LaunchAgent will not stop (still loaded: $loaded)",
    ({ loaded, status }) => {
      const removed = status === 0;
      const fakes = folder();
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
        writeFileSync(join(fakes, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
      }
      const app = join(home, "Library/Application Support/Luke Host");
      // Note that one smolvm store holds every Luke install's agents' machines for the user, this one's among them.
      const smolvm = join(app, "state/agent-tools/smolvm/1/smolvm");
      mkdirSync(join(smolvm, ".."), { recursive: true });
      writeFileSync(
        smolvm,
        `#!/bin/sh\n[ "$1 $2" != "machine delete" ] || echo "$4" >> "${deletes}"\n`,
        { mode: 0o755 },
      );
      // Note that agent one is this install's, by its daemon's record, and agent two another Luke install's.
      mkdirSync(join(app, "state/owned-agents"), { recursive: true });
      writeFileSync(join(app, "state/owned-agents/one"), "");
      for (const place of [home, rootHome]) {
        for (const each of ["agents/one", "agents/two", "clones/acme", "keep"]) {
          mkdirSync(join(place, ".luke", each), { recursive: true });
        }
      }
      writeFileSync(join(script, "luke-host"), readFileSync(UNINSTALL_SCRIPT), { mode: 0o755 });

      const answer = spawnSync("sh", [join(script, "luke-host"), "uninstall"], {
        env: { PATH: `${fakes}:${process.env.PATH}`, SUDO_USER: "mac", HOME: rootHome },
        encoding: "utf8",
      });

      expect(answer.status).toBe(status);
      expect(existsSync(deletes) ? readFileSync(deletes, "utf8").trim().split("\n") : []).toEqual(
        removed ? ["luke-one"] : [],
      );
      expect(existsSync(join(home, ".luke/agents/one"))).toBe(!removed);
      expect(existsSync(join(home, ".luke/agents/two"))).toBe(true);
      expect(existsSync(join(home, ".luke/clones"))).toBe(true);
      expect(existsSync(join(home, ".luke/keep"))).toBe(true);
      expect(existsSync(join(rootHome, ".luke/agents/one"))).toBe(true);
      expect(existsSync(join(rootHome, ".luke/clones"))).toBe(true);
    },
  );

  it.each([
    { os: "Linux", stops: true },
    { os: "Linux", stops: false },
    { os: "Darwin", stops: true },
    { os: "Darwin", stops: false },
  ])(
    "the account install's uninstall, run with no sudo on $os, stops its service through the account's own manager, warns of unpushed work, and removes the folders of the agents its daemon made, its state, its releases and its link, in that order, leaving another install's agents, the clones and a Linux account's lingering, said, unless its service will not stop (stops: $stops)",
    ({ os, stops }) => {
      const fakes = folder();
      const home = folder();
      const asked = join(folder(), "asked.log");
      // Note that systemctl answers is-active as systemd does, launchctl print finds the agent while it is loaded, and loginctl says the account lingers.
      for (const [name, body] of Object.entries({
        uname: `echo ${os}`,
        systemctl: `printf '%s\\n' "$*" >>"${asked}"\n[ "$2" != is-active ] || echo ${stops ? "inactive" : "active"}`,
        launchctl: `printf '%s\\n' "$*" >>"${asked}"\n[ "$1" != print ] || exit ${stops ? 1 : 0}`,
        loginctl: "echo yes",
      })) {
        writeFileSync(join(fakes, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
      }
      const releases = join(home, ".local/share/luke-host");
      const release = join(releases, "versions/0.3.0");
      mkdirSync(join(release, "bin"), { recursive: true });
      writeFileSync(join(release, "bin/luke-host"), readFileSync(UNINSTALL_SCRIPT), {
        mode: 0o755,
      });
      symlinkSync(release, join(releases, "current"));
      const link = join(home, ".local/bin/luke-host");
      mkdirSync(join(link, ".."), { recursive: true });
      symlinkSync(join(releases, "current/bin/luke-host"), link);
      const state = join(home, ".local/state/luke-host");
      mkdirSync(join(state, "owned-agents"), { recursive: true });
      writeFileSync(join(state, "owned-agents/one"), "");
      writeFileSync(join(state, "device.json"), "{}");
      // Note that agent one is this install's, by its daemon's record, and agent two another Luke install's.
      for (const each of ["agents/one", "agents/two", "clones/acme"]) {
        mkdirSync(join(home, ".luke", each), { recursive: true });
      }
      const service =
        os === "Linux"
          ? join(home, ".config/systemd/user/luke-host.service")
          : join(home, "Library/LaunchAgents/dev.reviewstage.luke.host.standalone.plist");
      mkdirSync(join(service, ".."), { recursive: true });
      writeFileSync(service, `<string>${releases}/current/bin/luke-host</string>\n`);

      const answer = spawnSync("sh", [link, "uninstall"], {
        env: { PATH: `${fakes}:${process.env.PATH}`, HOME: home },
        encoding: "utf8",
      });

      expect(answer.status).toBe(stops ? 0 : 1);
      expect(answer.stderr).toContain("Work in them that was not pushed goes with them.");
      expect(answer.stdout.includes("Left lingering on")).toBe(stops && os === "Linux");
      const commands = readFileSync(asked, "utf8").trim().split("\n");
      const uid = spawnSync("id", ["-u"], { encoding: "utf8" }).stdout.trim();
      expect(commands).toContain(
        os === "Linux"
          ? "--user disable --now luke-host.service"
          : `bootout gui/${uid}/dev.reviewstage.luke.host.standalone`,
      );
      expect(answer.stdout.split("\n").filter((line) => line.startsWith("Removed "))).toEqual(
        stops
          ? [
              `Removed ${join(home, ".luke/agents/one")}.`,
              `Removed ${state}.`,
              `Removed ${releases}.`,
              `Removed ${link}.`,
            ]
          : [],
      );
      for (const [place, kept] of [
        [service, !stops],
        [join(home, ".luke/agents/one"), !stops],
        [state, !stops],
        [releases, !stops],
        [link, !stops],
        [join(home, ".luke/agents/two"), true],
        [join(home, ".luke/clones/acme"), true],
      ] as const) {
        expect(existsSync(place)).toBe(kept);
      }
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
    const refused = check(EMPTY_SHA256);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(`checksum is ${ABC_SHA256}, not ${EMPTY_SHA256}`);
    expect(refused.stderr).toContain("Nothing was installed");
  });
});
