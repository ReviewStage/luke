/**
 * host-service-move.test.ts -- an account install's service moved over to `vespin-host` by the daemon a service of a release before the rename started: the unit or LaunchAgent that runs it read off what its service manager hands it; on Linux `luke-host.service` moved to `vespin-host.service` as the install script writes a unit, so that a move cut off at any step leaves a unit enabled that starts the host and the next start finishes it, one systemd refuses is said and leaves the old unit running, and one made already does nothing; on a Mac the plist rewritten in place as the install script writes one, never reloaded.
 *
 * systemd is faked behind `systemctl` (`scriptedSpawner`): it keeps which
 * units are enabled and which run, and enables or starts only a unit whose
 * file stands in the account's unit folder, which the move writes on the
 * real disk of a home of the test's own. What the install script writes is
 * read off the script itself (`apps/web/install/install.sh`), run by `sh` as
 * `host-install-script.test.ts` runs it, with the program's name set to each
 * side of the rename, so the move is held to the script whichever name the
 * script carries.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { DEVICE_PLATFORM } from "@luke/features/device-agent-wire";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { reporterLayer } from "../effect/seams.js";
import { type Script, scriptedSpawner } from "../testing/scripted-spawner.js";
import {
  HOST_SERVICE,
  HOST_SERVICE_MOVE,
  type HostService,
  hostServiceMoved,
  hostServiceOf,
} from "./host-service-move.js";

const INSTALL_SCRIPT = join(import.meta.dirname, "../../../../apps/web/install/install.sh");

const RELEASES = ".local/share/luke-host";
const UNIT_FOLDER = ".config/systemd/user";
const PLIST = `Library/LaunchAgents/${HOST_SERVICE.LAUNCH_AGENT}.plist`;

/** The program's two names, before the rename and after it. */
const NAME = { BEFORE: "luke-host", AFTER: "vespin-host" } as const;

type Name = (typeof NAME)[keyof typeof NAME];

/**
 * What the install script writes for the home given, by the statements
 * given, which write it to `$OUT` rather than into the home, with the program
 * and its log named as given rather than as the script names them.
 */
const installScriptWrites = (home: string, statements: string, name: Name) => {
  const out = join(mkdtempSync(join(tmpdir(), "vespin-host-script-")), "written");
  const answer = spawnSync(
    "sh",
    ["-c", `. "${INSTALL_SCRIPT}"; account_paths; ${statements}; cat "$OUT"; rm -rf "\${OUT%/*}"`],
    {
      env: { PATH: process.env.PATH, HOME: home, OUT: out, LUKE_HOST_INSTALL_LIBRARY: "1" },
      encoding: "utf8",
    },
  );
  expect(answer.status, answer.stderr).toBe(0);
  return answer.stdout
    .replaceAll(/current\/bin\/(?:luke|vespin)-host\b/gu, `current/bin/${name}`)
    .replaceAll(/(?:luke|vespin)-host\.log/gu, `${name}.log`);
};

/** The account's unit as the install script writes it, running the program named as given. */
const scriptUnit = (home: string, name: Name) =>
  installScriptWrites(home, 'UNIT_FILE="$OUT"; write_unit', name);

/** The account's LaunchAgent as the install script writes it, running the program named as given. */
const scriptLaunchAgent = (home: string, name: Name) =>
  installScriptWrites(home, 'write_launch_agent "$OUT" "$MAC_LOG"', name);

/**
 * A Linux account whose install of a release before the rename runs as
 * `luke-host.service`, as its install script wrote it, behind a faked
 * systemd: the units it holds enabled and running, every ask made of it, and
 * the ask given to cut off where one is named, which then never answers and
 * takes no effect, and the ask given to refuse.
 */
const linuxAccount = (home: string, options: { cutAt?: number; refuse?: string } = {}) =>
  Effect.gen(function* () {
    const fileOf = (unit: string) => join(home, UNIT_FOLDER, unit);
    mkdirSync(join(home, UNIT_FOLDER), { recursive: true });
    writeFileSync(fileOf(HOST_SERVICE.UNIT_BEFORE_RENAME), scriptUnit(home, NAME.BEFORE));
    const enabled = new Set<string>([HOST_SERVICE.UNIT_BEFORE_RENAME]);
    const running = new Set<string>([HOST_SERVICE.UNIT_BEFORE_RENAME]);
    const asked: string[] = [];
    const cut = yield* Deferred.make<void>();
    const answered = (args: readonly string[]): Script | undefined => {
      const [user, verb, ...rest] = args;
      const unit = rest.at(-1) ?? "";
      asked.push(args.join(" "));
      if (user !== "--user") return { exitCode: 1, stderr: "only the user manager is asked" };
      if (asked.length - 1 === options.cutAt) {
        return {
          exitCode: 0,
          until: Effect.andThen(Deferred.succeed(cut, undefined), Effect.never),
        };
      }
      if (args.join(" ") === options.refuse) return { exitCode: 1, stderr: "Access denied" };
      const stands = existsSync(fileOf(unit));
      switch (verb) {
        case "enable":
          if (!stands) return { exitCode: 1, stderr: `Unit ${unit} not found.` };
          enabled.add(unit);
          break;
        case "disable":
          enabled.delete(unit);
          break;
        case "start":
          if (!stands) return { exitCode: 1, stderr: `Unit ${unit} not found.` };
          running.add(unit);
          break;
        case "stop":
          running.delete(unit);
          break;
      }
      return { exitCode: 0 };
    };
    const spawner = scriptedSpawner((program, args) =>
      program === "systemctl" ? answered(args) : undefined,
    );
    const reports: string[] = [];
    const layer = Layer.mergeAll(
      NodeFileSystem.layer,
      NodePath.layer,
      spawner.layer,
      reporterLayer((line) => reports.push(line)),
    );
    /** The daemon of the unit given moving its service, on this account. */
    const moved = (service: HostService) =>
      hostServiceMoved({ service, home, releases: join(home, RELEASES) }).pipe(
        Effect.provide(layer),
      );
    /** The unit files standing in the account's unit folder. */
    const unitFiles = () => readdirSync(join(home, UNIT_FOLDER)).sort();
    return { enabled, running, asked, cut, reports, moved, unitFiles, fileOf };
  });

describe("an account install's service moved over to vespin-host", () => {
  it.each([
    {
      case: "a Linux daemon under the old unit, as cgroup v2 names it",
      platform: DEVICE_PLATFORM.LINUX,
      cgroup: "0::/user.slice/user-1000.slice/user@1000.service/app.slice/luke-host.service\n",
      label: undefined,
      service: HOST_SERVICE.UNIT_BEFORE_RENAME,
    },
    {
      case: "a Linux daemon under the new unit, as a cgroup v1 hierarchy names it",
      platform: DEVICE_PLATFORM.LINUX,
      cgroup:
        "12:pids:/user.slice/user-1000.slice\n1:name=systemd:/user.slice/user-1000.slice/user@1000.service/vespin-host.service\n",
      label: undefined,
      service: HOST_SERVICE.UNIT,
    },
    {
      case: "a Linux daemon run by hand in a login session",
      platform: DEVICE_PLATFORM.LINUX,
      cgroup: "0::/user.slice/user-1000.slice/session-4.scope\n",
      label: undefined,
      service: undefined,
    },
    {
      case: "a Mac daemon its LaunchAgent started",
      platform: DEVICE_PLATFORM.DARWIN,
      cgroup: "",
      label: HOST_SERVICE.LAUNCH_AGENT,
      service: HOST_SERVICE.LAUNCH_AGENT,
    },
    {
      case: "a Mac daemon run by hand in Terminal",
      platform: DEVICE_PLATFORM.DARWIN,
      cgroup: "",
      label: "0",
      service: undefined,
    },
  ])("reads what runs $case", ({ platform, cgroup, label, service }) => {
    expect(hostServiceOf({ platform, cgroup, launchdLabel: label })).toBe(service);
  });

  it.effect(
    "moves a Linux daemon of luke-host.service to vespin-host.service as the install script writes a unit, enabled and running, with the old unit disabled, stopped and removed and the host handed over, makes the command's new link, and a start under the new unit then does nothing",
    () =>
      Effect.gen(function* () {
        const home = yield* temporaryDirectoryScoped("vespin-host-move-");
        const account = yield* linuxAccount(home);

        expect(yield* account.moved(HOST_SERVICE.UNIT_BEFORE_RENAME)).toBe(
          HOST_SERVICE_MOVE.HANDED_OVER,
        );

        expect([...account.enabled]).toEqual([HOST_SERVICE.UNIT]);
        expect([...account.running]).toEqual([HOST_SERVICE.UNIT]);
        expect(account.unitFiles()).toEqual([HOST_SERVICE.UNIT]);
        expect(readFileSync(account.fileOf(HOST_SERVICE.UNIT), "utf8")).toBe(
          scriptUnit(home, NAME.AFTER),
        );
        expect(readlinkSync(join(home, ".local/bin/vespin-host"))).toBe(
          join(home, RELEASES, "current/bin/vespin-host"),
        );

        const asked = account.asked.length;
        expect(yield* account.moved(HOST_SERVICE.UNIT)).toBe(HOST_SERVICE_MOVE.STAYS);
        expect(account.asked.slice(asked)).toEqual([]);
        expect(account.unitFiles()).toEqual([HOST_SERVICE.UNIT]);
      }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
  );

  it.effect(
    "leaves a Linux account a unit enabled that starts the host and one running wherever its move is cut off, and the next start of each unit still running finishes the move",
    () =>
      Effect.gen(function* () {
        const whole = yield* linuxAccount(yield* temporaryDirectoryScoped("vespin-host-move-"));
        yield* whole.moved(HOST_SERVICE.UNIT_BEFORE_RENAME);
        expect(whole.asked.length).toBeGreaterThan(0);

        for (let cutAt = 0; cutAt < whole.asked.length; cutAt += 1) {
          const home = yield* temporaryDirectoryScoped("vespin-host-move-");
          const account = yield* linuxAccount(home, { cutAt });
          const moving = yield* Effect.forkChild(account.moved(HOST_SERVICE.UNIT_BEFORE_RENAME));
          yield* Deferred.await(account.cut);
          yield* Fiber.interrupt(moving);

          const starting = [...account.enabled].filter((unit) => existsSync(account.fileOf(unit)));
          expect(starting.length, `cut at ${account.asked.at(-1)}`).toBeGreaterThan(0);
          expect(account.running.size, `cut at ${account.asked.at(-1)}`).toBeGreaterThan(0);

          for (const unit of [HOST_SERVICE.UNIT_BEFORE_RENAME, HOST_SERVICE.UNIT] as const) {
            if (account.running.has(unit)) yield* account.moved(unit);
          }
          expect([...account.enabled], `cut at ${cutAt}`).toEqual([HOST_SERVICE.UNIT]);
          expect([...account.running], `cut at ${cutAt}`).toEqual([HOST_SERVICE.UNIT]);
          expect(account.unitFiles(), `cut at ${cutAt}`).toEqual([HOST_SERVICE.UNIT]);
        }
      }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
  );

  it.effect(
    "says on stderr why systemd refused a Linux move, and runs on as luke-host.service, still enabled and running",
    () =>
      Effect.gen(function* () {
        const home = yield* temporaryDirectoryScoped("vespin-host-move-");
        const account = yield* linuxAccount(home, {
          refuse: `--user enable ${HOST_SERVICE.UNIT}`,
        });

        expect(yield* account.moved(HOST_SERVICE.UNIT_BEFORE_RENAME)).toBe(HOST_SERVICE_MOVE.STAYS);

        expect(account.reports.join("\n")).toContain(
          `systemctl --user enable ${HOST_SERVICE.UNIT}: Access denied`,
        );
        expect(account.enabled.has(HOST_SERVICE.UNIT_BEFORE_RENAME)).toBe(true);
        expect(account.running.has(HOST_SERVICE.UNIT_BEFORE_RENAME)).toBe(true);
      }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
  );

  it.effect(
    "rewrites a Mac's plist in place as the install script writes one, running vespin-host and logging to vespin-host.log under the same label, asks launchd nothing, makes the command's new link, and leaves the old one",
    () =>
      Effect.gen(function* () {
        const home = yield* temporaryDirectoryScoped("vespin-host-move-");
        const plist = join(home, PLIST);
        const oldLink = join(home, ".local/bin/luke-host");
        mkdirSync(join(plist, ".."), { recursive: true });
        mkdirSync(join(oldLink, ".."), { recursive: true });
        writeFileSync(plist, scriptLaunchAgent(home, NAME.BEFORE));
        symlinkSync(join(home, RELEASES, "current/bin/luke-host"), oldLink);
        const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
        const moved = hostServiceMoved({
          service: HOST_SERVICE.LAUNCH_AGENT,
          home,
          releases: join(home, RELEASES),
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              NodeFileSystem.layer,
              NodePath.layer,
              spawner.layer,
              reporterLayer(() => undefined),
            ),
          ),
        );

        expect(yield* moved).toBe(HOST_SERVICE_MOVE.STAYS);
        const rewritten = readFileSync(plist, "utf8");
        expect(yield* moved).toBe(HOST_SERVICE_MOVE.STAYS);

        expect(rewritten).toBe(scriptLaunchAgent(home, NAME.AFTER));
        expect(readFileSync(plist, "utf8")).toBe(rewritten);
        expect(spawner.spawned).toEqual([]);
        expect(readlinkSync(join(home, ".local/bin/vespin-host"))).toBe(
          join(home, RELEASES, "current/bin/vespin-host"),
        );
        expect(readlinkSync(oldLink)).toBe(join(home, RELEASES, "current/bin/luke-host"));
      }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
  );
});
