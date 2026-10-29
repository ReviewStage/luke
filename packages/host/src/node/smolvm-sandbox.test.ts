/**
 * smolvm-sandbox.test.ts -- a sandboxed device's agents as the operating system sees the follower run them through `smolvm`: a VM made fresh for each turn with the agent's folder at its own path and GitHub's credential fed from files outside it, the runner run in it, the token renewed in those files, the runner signalled before its command is ended, the VM and its credential deleted and the folder's `tmp` emptied once the runner ends, a machine a run before left deleted before a launch makes one, every machine of this device's agents deleted as its gate opens, and a discard's check of the folder run in a VM of its own, deleted before the agent's folder.
 *
 * The follower runs over a scripted spawner standing in for `smolvm`, which
 * holds the machines made and deleted through it, a real temporary folder
 * for the device's home and state, and a fake service that hands the lines
 * each test names and a new GitHub token at each ask, on the test's clock.
 * Synthetic ids and tokens throughout.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import type { AgentToolPin } from "@luke/agent-runner/pins";
import type { DeviceAgentClaimedLine, DeviceAgentDevice } from "@luke/features";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_ARCH,
  DEVICE_ISOLATION,
  DEVICE_PLATFORM,
  type DeviceAgentLine,
  deviceAgentLayout,
} from "@luke/features/device-agent-wire";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { ConfigProvider, Duration, Effect, Layer, Result } from "effect";
import { TestClock } from "effect/testing";
import { composeLocalAgents } from "../compose-local-agents.js";
import { LINUX_HOST } from "../daemon/host-os.js";
import { hostPlatform } from "../daemon/host-platform.js";
import { Environment, LocalAgentPlatform, Reporter } from "../effect/seams.js";
import { type ScriptedSpawner, scriptedSpawner } from "../testing/scripted-spawner.js";
import { smolvmSandbox } from "./smolvm-sandbox.js";

const SMOLVM = "/usr/local/bin/smolvm";
/** The image the rollout pinned, by its digest, as CI published it. */
const IMAGE =
  "ghcr.io/reviewstage/luke-sandbox:ea78580d96ce7256@sha256:f6ff07bdc663c9173a856a713e4caa02a725eedd3da4aed0029c662e3b0b33a5";
const AGENT_ID = "6f1c2a4e-0b7d-4c55-9a3e-2d8f61b0c9a1";
const MACHINE = `luke-${AGENT_ID}`;
const RUNNER_FOLDER = "/opt/luke-host/lib";
const RUNNER_BUNDLE = `${RUNNER_FOLDER}/agent-runner.mjs`;
const USER = { uid: 990, gid: 991 };
const SECRET_ENV = { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-fixture-not-a-real-token" };
const FIFTY_MINUTES = Duration.minutes(50);

/** The platform's check of an agent's folder for unsaved work, named so a spawn of it can be told. */
const UNSAVED_WORK_SCRIPT = "check-for-unsaved-work";

type Spawned = ScriptedSpawner["spawned"][number];

/** Whether a spawn is `smolvm machine <verb>`. */
const isSmolvm = (verb: string) => (each: Pick<Spawned, "program" | "args">) =>
  each.program === SMOLVM && each.args[0] === "machine" && each.args[1] === verb;

/** Whether a spawn is the runner, run in its agent's VM. */
const isRunner = (each: Pick<Spawned, "program" | "args">) =>
  isSmolvm("exec")(each) && each.args.includes(RUNNER_BUNDLE);

/** Whether a spawn runs the platform's check of the agent's folder, wherever it runs. */
const isUnsavedCheck = (each: Pick<Spawned, "args">) => each.args.includes(UNSAVED_WORK_SCRIPT);

/** Whether a spawn is the signal to the agent's processes, run in its VM on its Node. */
const isSignal = (each: Pick<Spawned, "program" | "args">) =>
  isSmolvm("exec")(each) && each.args[each.args.indexOf("--") + 2] === "-e";

/** The value after a flag in an argument list, each place it stands. */
const valuesOf = (args: readonly string[], flag: string) =>
  args.flatMap((each, index) => (each === flag ? [args[index + 1] ?? ""] : []));

/** The clock nudged until the condition holds, as the follower's fibers, and the file writes they wait on, which wait on no clock, run up to their next wait. */
const until = (holds: () => boolean) =>
  Effect.gen(function* () {
    for (let round = 0; round < 20_000 && !holds(); round += 1) {
      yield* TestClock.adjust(Duration.zero);
      yield* Effect.yieldNow;
    }
    assert.ok(holds(), "the follower never got there");
  });

/** A launch line for the agent, its worktree under the home given. */
const launchLine = (home: string): DeviceAgentClaimedLine => ({
  line: {
    id: "0e9b7c1d-5a2f-4e63-8b40-7c1d2e3f4a5b",
    agentId: AGENT_ID,
    seq: 1,
    kind: DEVICE_AGENT_LINE_KIND.LAUNCH,
    payload: {
      checkoutPath: deviceAgentLayout(home, AGENT_ID).checkoutPath,
      repository: "acme/relay",
      startBranch: null,
      firstSequence: 0,
    },
  },
  secrets: { env: SECRET_ENV, stdin: "{}\n" },
});

/** A line of the kind given for the agent, carrying nothing. */
const plainLine = (id: string, seq: number, kind: DeviceAgentLine["kind"]): DeviceAgentLine => ({
  id,
  agentId: AGENT_ID,
  seq,
  kind,
  payload: {},
});

/** What `smolvm machine delete --error-format json` answers for a machine it has no record of. */
const NOT_FOUND = {
  exitCode: 1,
  stderr: '{"error":{"code":"NOT_FOUND","message":"vm not found"}}\n',
};

/** A machine `smolvm machine status --json` says stands, as it prints one. */
const statusOf = (name: string, state: string) => ({
  exitCode: 0,
  stdout: JSON.stringify({ name, state, image: IMAGE }, null, 2),
});

/**
 * The follower on a sandboxed box, with or without `/dev/kvm`, handed the
 * lines given in one read; `runnerExits` is how long its runner runs before it exits by itself, or
 * never. The fake smolvm holds the machines named in `machines`, stopped,
 * and those made through it, until each is deleted.
 */
const following = (input: {
  readonly nested: boolean;
  readonly lines: (home: string) => readonly DeviceAgentClaimedLine[];
  readonly runnerExits?: Duration.Input;
  /** Called as each smolvm command is spawned, before it runs, with everything spawned so far and whether the machine it names stands. */
  readonly onSmolvm?: (
    args: readonly string[],
    spawned: readonly Spawned[],
    stands: boolean,
  ) => void;
  /** Whether the platform checks an agent's folder for unsaved work before a discard, as This Mac's does. */
  readonly checksUnsavedWork?: boolean;
  /** The machines smolvm holds as the follower starts, by name. */
  readonly machines?: readonly string[];
  /** The agents the device's record names as ones it made, by id. */
  readonly owned?: readonly string[];
}) =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped("luke-smolvm-sandbox-");
    const home = `${root}/home`;
    const stateRoot = `${root}/state`;
    const layout = deviceAgentLayout(home, AGENT_ID);
    // Note that the worktree's script is scripted here, so the folder it would make is made by hand.
    mkdirSync(layout.checkoutPath, { recursive: true });
    for (const agentId of input.owned ?? []) {
      mkdirSync(`${stateRoot}/owned-agents`, { recursive: true });
      writeFileSync(`${stateRoot}/owned-agents/${agentId}`, "");
    }
    /** The machines the fake smolvm holds, by name, each with the state it says it is in. */
    const machines = new Map((input.machines ?? []).map((name) => [name, "stopped"]));
    const spawner: ScriptedSpawner = scriptedSpawner((program, args) => {
      if (program === "/bin/bash" && args[0] === "-l")
        return { stdout: "/usr/bin:/bin", exitCode: 0 };
      if (program === "/bin/bash" && args[0] === "-c") return { exitCode: 0 };
      if (program !== SMOLVM) return undefined;
      const each = { program, args };
      const name = valuesOf(args, "--name")[0] ?? "";
      input.onSmolvm?.(args, spawner.spawned, machines.has(name));
      if (isSmolvm("status")(each)) {
        const state = machines.get(name);
        return state === undefined ? { exitCode: 1 } : statusOf(name, state);
      }
      if (isSmolvm("create")(each)) machines.set(name, "created");
      if (isSmolvm("start")(each)) machines.set(name, "running");
      if (isSmolvm("stop")(each)) machines.set(name, "stopped");
      if (isSmolvm("delete")(each) && !machines.delete(name)) return NOT_FOUND;
      if (isRunner(each)) {
        return input.runnerExits === undefined ? {} : { exitCode: 0, after: input.runnerExits };
      }
      return { exitCode: 0 };
    });
    const claimed = input.lines(home);
    const asked: string[] = [];
    const registered: DeviceAgentDevice[] = [];
    let linesRead = 0;
    const client = {
      register: (_deviceId: string, registration: DeviceAgentDevice) =>
        Effect.sync(() => registered.push(registration)).pipe(Effect.as(true)),
      beat: () => Effect.succeed({}),
      lines: () =>
        linesRead++ === 0 ? Effect.succeed(claimed.map((each) => each.line)) : Effect.never,
      claimLine: (_deviceId: string, id: string) =>
        Effect.succeed(claimed.find((each) => each.line.id === id)),
      settleLine: () => Effect.succeed(true),
      requests: () => Effect.never,
      claimRequest: () => Effect.succeed({ claimed: false as const }),
      answerRequest: () => Effect.succeed(true),
      liveAgents: () => Effect.succeed(undefined),
      githubToken: (agentId: string) =>
        Effect.sync(() => {
          asked.push(agentId);
          return `ghs_fixture_${asked.length}`;
        }),

      saveState: () => Effect.succeed(undefined),
      commitState: () => Effect.succeed(undefined),
    };
    const vm = smolvmSandbox({
      smolvm: SMOLVM,
      stateRoot,
      runnerFolder: RUNNER_FOLDER,
      user: USER,
      nested: input.nested,
    });
    const services = Layer.mergeAll(
      spawner.layer,
      NodePath.layer,
      NodeFileSystem.layer,
      fakeHttpClientLayer(() => Promise.reject(new Error("this test fetches no tool"))),
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord({ HOME: home, SHELL: "/bin/bash" })),
      Layer.succeed(Reporter, { report: () => undefined }),
      Layer.succeed(LocalAgentPlatform, {
        launch: vm.launch,
        sandbox: vm.sandbox,
        runnerBundle: RUNNER_BUNDLE,
        runnerEnv: { LUKE_RUNNER_PLACE: "host" },
        formerlyDirect: false,
        deviceName: "rack-1",
        devicePlatform: DEVICE_PLATFORM.LINUX,
        deviceArch: DEVICE_ARCH.X64,
        deviceIsolation: DEVICE_ISOLATION.SANDBOX,
        deviceCapabilities: [],
        worktreeScript: () => "exit 0",
        unsavedWorkScript: input.checksUnsavedWork === true ? () => UNSAVED_WORK_SCRIPT : undefined,
        stateSealed: () => Effect.die("this device saves no state"),
        stateOpened: () => Effect.die("this device restores no state"),
      }),
    );
    const composer = yield* composeLocalAgents({
      kernel: { stateRoot, createId: () => "device-1", runMode: { sendsNetwork: true } },
      account: { capabilitiesActive: () => true },
      accountId: () => "user-fixture",
      switchedOn: Effect.succeed(true),
      client,
    }).pipe(Effect.provide(services));
    yield* composer.lifetime;
    const credentials = `${stateRoot}/sandboxes/${AGENT_ID}`;
    return {
      spawned: spawner.spawned,
      asked,
      registered,
      layout,
      credentials,
      machines,
      followed: () => linesRead > 0,
    };
  });

it.effect(
  "a sandboxed agent's VM is made with its folder at its own path and GitHub's credential fed from files outside it, its runner runs in it as the box's user, its token is renewed in those files, and once the turn ends the VM and its credential are gone and the folder's tmp is empty, a link the agent left there taken away unfollowed, the rest of the folder kept",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { spawned, asked, registered, layout, credentials, machines } = yield* following({
          nested: true,
          lines: (home) => [launchLine(home)],
          // Note that the turn outlasts a renewal, and then ends by itself.
          runnerExits: Duration.minutes(60),
        });
        yield* until(() => spawned.some(isRunner));

        const create = spawned.find(isSmolvm("create"));
        assert.deepEqual(create?.args, [
          "machine",
          "create",
          "--name",
          MACHINE,
          "--image",
          IMAGE,
          "--net",
          "--user",
          "0:0",
          "-v",
          `${layout.folder}:${layout.folder}`,
          "-v",
          `${RUNNER_FOLDER}:${RUNNER_FOLDER}:ro`,
          "--nested",
          "--secret-file",
          `GH_TOKEN=${credentials}/github-token`,
          "--credential",
          "github=GH_TOKEN@api.github.com",
          "--secret-file",
          `GIT_AUTH=${credentials}/git-authorization`,
          "--credential",
          "git=GIT_AUTH@github.com:set-header=authorization",
          "--",
          "sh",
          "-c",
          "while true; do sleep 3600; done",
        ]);
        // smolvm holds its seed folder to 9 GiB, about three seeds of the image, beside the device's own environment.
        assert.equal(create?.env?.SMOLVM_IMAGE_SEED_MAX_BYTES, "9663676416");
        assert.equal(create?.extendEnv, true);
        assert.ok(!credentials.startsWith(`${layout.folder}/`));
        const programs = spawned.map((each) => each.program);
        assert.ok(spawned.indexOf(create as Spawned) < spawned.findIndex(isRunner));
        assert.ok(programs.includes("/bin/bash"));

        // The runner runs in the VM through `exec -i`, as the box's user, its variables handed by name alone.
        const runner = spawned.find(isRunner);
        const args = runner?.args ?? [];
        assert.deepEqual(args.slice(0, 5), ["machine", "exec", "--name", MACHINE, "-i"]);
        assert.deepEqual(valuesOf(args, "--user"), ["990:991"]);
        assert.deepEqual(valuesOf(args, "-w"), [layout.checkoutPath]);
        assert.deepEqual(valuesOf(args, "-e"), [
          `HOME=${layout.folder}/home`,
          `XDG_CACHE_HOME=${layout.folder}/cache`,
          `PNPM_HOME=${layout.folder}/home/.local/share/pnpm`,
          `NPM_CONFIG_PREFIX=${layout.folder}/home/.npm-global`,
        ]);
        const handed = valuesOf(args, "--secret-env");
        assert.ok(handed.includes("CLAUDE_CODE_OAUTH_TOKEN=CLAUDE_CODE_OAUTH_TOKEN"));
        assert.ok(handed.includes("TMPDIR=TMPDIR"));
        for (const name of [
          "HOME",
          "PATH",
          "SHELL",
          "GH_CONFIG_DIR",
          "GH_TOKEN",
          "GIT_CONFIG_COUNT",
        ]) {
          assert.equal(
            handed.some((each) => each.startsWith(`${name}=`)),
            false,
            `${name} handed into the VM`,
          );
        }
        assert.deepEqual(args.slice(args.indexOf("--") + 5), ["node", RUNNER_BUNDLE]);
        assert.equal(runner?.env?.CLAUDE_CODE_OAUTH_TOKEN, SECRET_ENV.CLAUDE_CODE_OAUTH_TOKEN);
        assert.equal(runner?.env?.TMPDIR, `${layout.folder}/tmp`);
        assert.equal(runner?.extendEnv, false);
        assert.ok(statSync(`${layout.folder}/home`).isDirectory());
        // The device registers the VM's own Claude Code and Codex, never a copy of the box's.
        assert.deepEqual(
          registered.map((each) => [each.claudeExecutable, each.codexExecutable]),
          [["/usr/local/bin/claude", "/usr/local/bin/codex"]],
        );

        // The token stands outside the agent's folder, for smolvm alone, and the worktree's git reads it from there.
        const token = () => readFileSync(`${credentials}/github-token`, "utf8");
        const header = () => readFileSync(`${credentials}/git-authorization`, "utf8");
        assert.deepEqual(asked, [AGENT_ID]);
        assert.equal(token(), "ghs_fixture_1");
        assert.equal(header(), `Basic ${btoa("x-access-token:ghs_fixture_1")}`);
        assert.equal((statSync(`${credentials}/github-token`).mode & 0o777).toString(8), "600");
        assert.equal((statSync(credentials).mode & 0o777).toString(8), "700");
        assert.equal(existsSync(layout.githubConfig), false, "a gh sign-in in the agent's folder");
        const script = spawned.find(
          (each) => each.program === "/bin/bash" && each.args[0] === "-c",
        );
        assert.equal(script?.env?.GIT_CONFIG_KEY_1, "credential.https://github.com.helper");
        assert.ok(script?.env?.GIT_CONFIG_VALUE_1?.includes(`'${credentials}/github-token'`));

        // Renewed on the cadence, in the same files, with no restart of the VM.
        yield* TestClock.adjust(FIFTY_MINUTES);
        yield* until(
          () =>
            token() === "ghs_fixture_2" &&
            header() === `Basic ${btoa("x-access-token:ghs_fixture_2")}`,
        );
        assert.equal(spawned.filter(isSmolvm("create")).length, 1);
        assert.equal(spawned.some(isSmolvm("stop")), false);

        // The turn ends by itself, and lets go of its VM, its credential, and what it left in tmp, while the rest of its folder stays for the next.
        // Note that the agent left a link at tmp to a folder of the box's own, which the emptying must take away without following.
        const outside = `${layout.folder}/../outside`;
        mkdirSync(outside);
        writeFileSync(`${outside}/precious`, "the box's\n");
        rmSync(`${layout.folder}/tmp`, { recursive: true });
        symlinkSync(outside, `${layout.folder}/tmp`);
        writeFileSync(`${layout.folder}/home/kept`, "kept\n");
        writeFileSync(`${layout.checkoutPath}/notes.md`, "not committed\n");
        yield* TestClock.adjust(Duration.minutes(10));
        yield* until(() => !existsSync(credentials));
        assert.deepEqual([...machines.keys()], []);
        assert.deepEqual(spawned.find(isSmolvm("delete"))?.args, [
          "machine",
          "delete",
          "--name",
          MACHINE,
          "-f",
          "--error-format",
          "json",
        ]);
        // Note that tmp is taken away whole and made again, so a read while it is gone finds nothing yet.
        const temp = () => {
          try {
            return readdirSync(`${layout.folder}/tmp`);
          } catch {
            return undefined;
          }
        };
        yield* until(() => temp()?.length === 0);
        assert.equal(lstatSync(`${layout.folder}/tmp`).isDirectory(), true);
        assert.equal(readFileSync(`${outside}/precious`, "utf8"), "the box's\n");
        assert.equal(readFileSync(`${layout.folder}/home/kept`, "utf8"), "kept\n");
        assert.equal(readFileSync(`${layout.checkoutPath}/notes.md`, "utf8"), "not committed\n");

        for (const each of spawned) {
          assert.equal(
            each.args.join(" ").includes("ghs_fixture"),
            false,
            "a token in an argument",
          );
          assert.equal(
            each.args.join(" ").includes(SECRET_ENV.CLAUDE_CODE_OAUTH_TOKEN),
            false,
            "a secret in an argument",
          );
        }
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a sandboxed agent's stop signals its processes in the VM before its command is ended, the VM is deleted once the runner has ended, and a discard checks the folder for unsaved work in a VM made for the check, deleted before the agent's folder",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const seen: {
          signalWhileRunning?: boolean;
          stopAfterRunnerEnded?: boolean;
          /** At each delete of a machine that stood, whether the folder still stood and whether the check had run. */
          deletes: { folder: boolean; checked: boolean }[];
        } = { deletes: [] };
        let folder = "";
        const { spawned, layout, credentials, machines } = yield* following({
          nested: false,
          lines: (home) => [
            launchLine(home),
            {
              line: plainLine(
                "0e9b7c1d-0000-4000-8000-000000000002",
                2,
                DEVICE_AGENT_LINE_KIND.STOP,
              ),
            },
            {
              line: plainLine(
                "0e9b7c1d-0000-4000-8000-000000000003",
                3,
                DEVICE_AGENT_LINE_KIND.DISCARD,
              ),
            },
          ],
          // Note that the runner ends a second in, inside the grace its signal gives it.
          runnerExits: Duration.seconds(1),
          checksUnsavedWork: true,
          onSmolvm: (args, sofar, stands) => {
            const runner = sofar.find(isRunner);
            if (isSignal({ program: SMOLVM, args })) {
              seen.signalWhileRunning = runner?.ended === "running";
            }
            if (
              isSmolvm("stop")({ program: SMOLVM, args }) &&
              seen.stopAfterRunnerEnded === undefined
            ) {
              seen.stopAfterRunnerEnded = runner !== undefined && runner.ended !== "running";
            }
            if (isSmolvm("delete")({ program: SMOLVM, args }) && stands) {
              seen.deletes.push({
                folder: existsSync(folder),
                checked: sofar.some(isUnsavedCheck),
              });
            }
          },
        });
        folder = layout.folder;
        yield* until(() => spawned.some(isSignal));
        yield* TestClock.adjust(Duration.seconds(1));
        yield* until(() => !existsSync(layout.folder));

        assert.equal(spawned.find(isSmolvm("create"))?.args.includes("--nested"), false);
        const signal = spawned.find(isSignal);
        assert.deepEqual(signal?.args.slice(0, 6), [
          "machine",
          "exec",
          "--name",
          MACHINE,
          "--user",
          "990:991",
        ]);
        // Note that the turn's VM goes as its runner ends, and the check's, made fresh, once the check is done, before the folder.
        assert.deepEqual(seen, {
          signalWhileRunning: true,
          stopAfterRunnerEnded: true,
          deletes: [
            { folder: true, checked: false },
            { folder: true, checked: true },
          ],
        });
        assert.equal(spawned.filter(isSmolvm("create")).length, 2);
        assert.deepEqual([...machines.keys()], []);
        // Note that the device's own git never reads a repository the agent could rig: the check ran in the VM alone.
        assert.deepEqual(
          spawned.filter(isUnsavedCheck).map((each) => [each.program, ...each.args.slice(0, 4)]),
          [[SMOLVM, "machine", "exec", "--name", MACHINE]],
        );
        assert.deepEqual(spawned.find(isSmolvm("delete"))?.args, [
          "machine",
          "delete",
          "--name",
          MACHINE,
          "-f",
          "--error-format",
          "json",
        ]);
        assert.equal(existsSync(credentials), false);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a Mac's sandbox is ready only once its pinned smolvm checks out against the pin and the image is pulled, once; a smolvm whose digest is not the pin's never runs",
  () =>
    Effect.gen(function* () {
      const root = yield* temporaryDirectoryScoped("luke-smolvm-pinned-");
      const stateRoot = `${root}/state`;
      // Note that the released smolvm writes down each command it is handed rather than running it.
      const calls = `${root}/calls`;
      mkdirSync(`${root}/release/smolvm-9.9.9`, { recursive: true });
      writeFileSync(
        `${root}/release/smolvm-9.9.9/smolvm`,
        `#!/bin/sh\necho "$0 $@" >> '${calls}'\n`,
        {
          mode: 0o755,
        },
      );
      execFileSync("tar", ["-czf", `${root}/smolvm.tgz`, "-C", `${root}/release`, "smolvm-9.9.9"]);
      const archive = readFileSync(`${root}/smolvm.tgz`);
      const pin: AgentToolPin = {
        NAME: "smolvm",
        VERSION: "9.9.9",
        ARCHIVE: "https://releases.test/smolvm-9.9.9-darwin-arm64.tar.gz",
        SHA256: createHash("sha256").update(archive).digest("hex"),
        BYTES: archive.length,
        ROOT: "smolvm-9.9.9",
        MEMBERS: ["smolvm"],
        BINARY: "smolvm",
      };
      const vm = smolvmSandbox({
        smolvm: pin,
        stateRoot,
        runnerFolder: RUNNER_FOLDER,
        user: USER,
        nested: false,
      });
      const tampered = Uint8Array.from(archive);
      tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;

      const preparing: string[] = [];
      const refused = yield* vm.sandbox
        .ready(Effect.sync(() => preparing.push("refused")))
        .pipe(Effect.provide(fakeHttpClientLayer(() => new Response(tampered))), Effect.result);
      const ready = yield* vm.sandbox
        .ready(Effect.sync(() => preparing.push("ready")))
        .pipe(Effect.provide(fakeHttpClientLayer(() => new Response(archive))), Effect.result);
      const again = yield* vm.sandbox
        .ready(Effect.sync(() => preparing.push("again")))
        .pipe(
          Effect.provide(fakeHttpClientLayer(() => new Response("never asked", { status: 500 }))),
          Effect.result,
        );

      const smolvm = `${stateRoot}/agent-tools/smolvm/9.9.9/smolvm`;
      assert.deepEqual([refused, ready, again].map(Result.isSuccess), [false, true, true]);
      // Note that a Mac that has everything already says nothing of getting ready.
      assert.deepEqual(preparing, ["refused", "ready"]);
      assert.deepEqual(readFileSync(calls, "utf8").trim().split("\n"), [
        `${smolvm} machine run --net --image ${IMAGE} -- true`,
      ]);
      // Every command of an agent's runs the very smolvm that was checked.
      const runner = vm.launch({
        agentId: AGENT_ID,
        folder: `${root}/agent`,
        checkout: `${root}/agent/repository`,
        node: "node",
        bundle: RUNNER_BUNDLE,
        env: {},
      });
      assert.equal(runner.command, smolvm);
      assert.deepEqual(runner.args.slice(0, 2), ["machine", "exec"]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        NodeChildProcessSpawner.layer.pipe(
          Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
        ),
      ),
    ),
);

it.effect.each([
  {
    case: "a launch that finds no machine of the agent's makes one fresh",
    leftover: undefined,
    statusReads: true,
    deletes: true,
    verbs: ["status", "delete", "create", "start"],
    refused: undefined,
  },
  {
    case: "a launch that finds a machine a run that died left deletes it, the agent's folder and credential kept, and makes one fresh from the pinned image with the mounts of now",
    leftover: "running",
    statusReads: true,
    deletes: true,
    verbs: ["status", "stop", "delete", "create", "start"],
    refused: undefined,
  },
  {
    case: "a leftover whose status smolvm does not answer is deleted all the same, never taken for none",
    leftover: "stopped",
    statusReads: false,
    deletes: true,
    verbs: ["status", "delete", "create", "start"],
    refused: undefined,
  },
  {
    case: "a leftover smolvm will not delete stops the launch with words, and no machine is made",
    leftover: "stopped",
    statusReads: true,
    deletes: false,
    verbs: ["status", "delete"],
    refused: "the machine a run before left could not be deleted",
  },
])("$case", ({ leftover, statusReads, deletes, verbs, refused }) =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped("luke-smolvm-leftover-");
    const folder = `${root}/agent`;
    const stateRoot = `${root}/state`;
    const token = `${stateRoot}/sandboxes/${AGENT_ID}/github-token`;
    mkdirSync(`${stateRoot}/sandboxes/${AGENT_ID}`, { recursive: true });
    writeFileSync(token, "ghs_fixture_1");
    // Note that the fake smolvm holds the leftover machine, as `machine status --json` prints it, until it is deleted.
    let state = leftover;
    const spawner = scriptedSpawner((program, args) => {
      const each = { program, args };
      if (isSmolvm("status")(each)) {
        return state === undefined || !statusReads ? { exitCode: 1 } : statusOf(MACHINE, state);
      }
      if (isSmolvm("stop")(each)) state = "stopped";
      if (isSmolvm("delete")(each)) {
        if (state === undefined) return NOT_FOUND;
        if (!deletes) return { exitCode: 1, stderr: "machine is locked\n" };
        state = undefined;
      }
      if (isSmolvm("create")(each)) state = "created";
      return program === SMOLVM ? { exitCode: 0 } : undefined;
    });
    const vm = smolvmSandbox({
      smolvm: SMOLVM,
      stateRoot,
      runnerFolder: RUNNER_FOLDER,
      user: USER,
      nested: false,
    });

    const detail = yield* vm.sandbox
      .started({ agentId: AGENT_ID, folder, github: true })
      .pipe(
        Effect.provide(spawner.layer),
        Effect.match({ onFailure: (failed) => failed.detail, onSuccess: () => undefined }),
      );

    assert.deepEqual(
      spawner.spawned.map((each) => each.args[1]),
      verbs,
    );
    assert.equal(detail, refused);
    const create = spawner.spawned.find(isSmolvm("create"));
    if (create !== undefined) {
      assert.deepEqual(valuesOf(create.args, "--image"), [IMAGE]);
      assert.deepEqual(valuesOf(create.args, "-v"), [
        `${folder}:${folder}`,
        `${RUNNER_FOLDER}:${RUNNER_FOLDER}:ro`,
      ]);
    }
    assert.equal(readFileSync(token, "utf8"), "ghs_fixture_1");
  }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "as its gate opens, a device deletes every machine of an agent it made, and never one of an agent another Luke install made",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const mine = "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
        const theirs = "8f7e6d5c-4b3a-4c2d-9e1f-0a9b8c7d6e5f";
        const { spawned, machines, followed } = yield* following({
          nested: false,
          lines: () => [],
          machines: [`luke-${mine}`, `luke-${theirs}`],
          owned: [mine],
        });
        yield* until(followed);

        assert.deepEqual([...machines.keys()], [`luke-${theirs}`]);
        assert.equal(
          spawned.some((each) => each.args.includes(`luke-${theirs}`)),
          false,
          "a machine of another install's agent was touched",
        );
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a runner folder whose path holds a space, as a Mac's Application Support does, is mounted at a folder of its own in the VM, where the runner's bundle is launched from",
  () =>
    Effect.gen(function* () {
      const root = yield* temporaryDirectoryScoped("luke-smolvm-spaced-");
      const folder = `${root}/agent`;
      const spaced = "/Users/ada/Library/Application Support/Luke Host/luke-host/lib";
      // Note that the fake smolvm has no machine of the agent's, so the start makes one.
      const spawner = scriptedSpawner((program, args) => {
        if (program !== SMOLVM) return undefined;
        return isSmolvm("status")({ program, args }) ? { exitCode: 1 } : { exitCode: 0 };
      });
      const platform = hostPlatform({
        os: LINUX_HOST,
        installFolder: "/opt/luke-host",
        runnerFolder: spaced,
        arch: DEVICE_ARCH.ARM64,
        stateRoot: `${root}/state`,
        smolvm: SMOLVM,
        user: USER,
      });

      yield* platform.sandbox
        .started({ agentId: AGENT_ID, folder, github: false })
        .pipe(Effect.provide(spawner.layer));

      const create = spawner.spawned.find(isSmolvm("create"));
      assert.deepEqual(valuesOf(create?.args ?? [], "-v"), [
        `${folder}:${folder}`,
        `${spaced}:/opt/luke-runner:ro`,
      ]);
      assert.equal(platform.runnerBundle, "/opt/luke-runner/agent-runner.mjs");
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
);
