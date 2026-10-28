/**
 * smolvm-sandbox.test.ts -- a sandboxed device's agents as the operating system sees the follower run them through `smolvm`: the VM made with the agent's folder at its own path and GitHub's credential fed from files outside it, the runner and a tool's command run in it, the token renewed in those files, the runner signalled before its command is ended, the VM stopped once the runner ends, and deleted before the agent's folder.
 *
 * The follower runs over a scripted spawner standing in for `smolvm`, a
 * real temporary folder for the device's home and state, and a fake service
 * that hands the lines each test names and a new GitHub token at each ask,
 * on the test's clock. Synthetic ids and tokens throughout.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import type { AgentToolPin } from "@luke/agent-runner/pins";
import type { DeviceAgentClaimedLine, DeviceAgentDevice } from "@luke/features";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_AGENT_REQUEST_KIND,
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

/** A command one of the agent's tools asks the box to run in its worktree. */
const COMMAND = {
  id: "3c2b1a0f-9e8d-4c7b-a6f5-e4d3c2b1a0f9",
  agentId: AGENT_ID,
  kind: DEVICE_AGENT_REQUEST_KIND.RUN_COMMAND,
  args: { command: "git status" },
};

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

/**
 * The follower on a sandboxed box, with or without `/dev/kvm`, handed the
 * lines given in one read, and a command of the agent's tools a second in;
 * `runnerExits` is how long its runner runs before it exits by itself, or
 * never. `smolvm machine start` finds no machine until one is made.
 */
const following = (input: {
  readonly nested: boolean;
  readonly lines: (home: string) => readonly DeviceAgentClaimedLine[];
  readonly runnerExits?: Duration.Input;
  /** Called as each smolvm command is spawned, before it runs, with everything spawned so far. */
  readonly onSmolvm?: (args: readonly string[], spawned: readonly Spawned[]) => void;
  /** Whether the platform checks an agent's folder for unsaved work before a discard, as This Mac's does. */
  readonly checksUnsavedWork?: boolean;
}) =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped("luke-smolvm-sandbox-");
    const home = `${root}/home`;
    const stateRoot = `${root}/state`;
    const layout = deviceAgentLayout(home, AGENT_ID);
    // Note that the worktree's script is scripted here, so the folder it would make is made by hand.
    mkdirSync(layout.checkoutPath, { recursive: true });
    let made = false;
    const spawner: ScriptedSpawner = scriptedSpawner((program, args) => {
      if (program === "/bin/bash" && args[0] === "-l")
        return { stdout: "/usr/bin:/bin", exitCode: 0 };
      if (program === "/bin/bash" && args[0] === "-c") return { exitCode: 0 };
      if (program !== SMOLVM) return undefined;
      input.onSmolvm?.(args, spawner.spawned);
      if (isSmolvm("create")({ program, args })) made = true;
      if (isSmolvm("start")({ program, args })) {
        return made
          ? { exitCode: 0 }
          : { exitCode: 1, stderr: '{"error":{"code":"NOT_FOUND","message":"no such machine"}}\n' };
      }
      if (isRunner({ program, args })) {
        return input.runnerExits === undefined ? {} : { exitCode: 0, after: input.runnerExits };
      }
      return { exitCode: 0 };
    });
    const claimed = input.lines(home);
    const asked: string[] = [];
    const registered: DeviceAgentDevice[] = [];
    let linesRead = 0;
    let requestsRead = 0;
    const client = {
      register: (_deviceId: string, registration: DeviceAgentDevice) =>
        Effect.sync(() => registered.push(registration)).pipe(Effect.as(true)),
      beat: () => Effect.succeed({}),
      lines: () =>
        linesRead++ === 0 ? Effect.succeed(claimed.map((each) => each.line)) : Effect.never,
      claimLine: (_deviceId: string, id: string) =>
        Effect.succeed(claimed.find((each) => each.line.id === id)),
      settleLine: () => Effect.succeed(true),
      // Note that the command is asked once the runner runs, so the launch's spawns come first.
      requests: () =>
        requestsRead++ === 0
          ? Effect.sleep(Duration.seconds(1)).pipe(Effect.as([COMMAND]))
          : Effect.never,
      claimRequest: () => Effect.succeed(COMMAND),
      answerRequest: () => Effect.succeed(true),
      githubToken: (agentId: string) =>
        Effect.sync(() => {
          asked.push(agentId);
          return `ghs_fixture_${asked.length}`;
        }),
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
    return { spawned: spawner.spawned, asked, registered, layout, credentials };
  });

it.effect(
  "a sandboxed agent's VM is made with its folder at its own path and GitHub's credential fed from files outside it, its runner and its tools' commands run in it as the box's user, and its token is renewed in those files",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { spawned, asked, registered, layout, credentials } = yield* following({
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

        // A command the agent's tools ask runs in its VM, never on the box.
        const isCommand = (each: Spawned) => each.args.includes(COMMAND.args.command);
        yield* until(() => spawned.some(isCommand));
        const command = spawned.find(isCommand);
        assert.equal(command?.program, SMOLVM);
        assert.deepEqual(command?.args.slice(command.args.indexOf("--") + 5), [
          "/bin/bash",
          "-l",
          "-c",
          COMMAND.args.command,
        ]);

        // The turn ends by itself, and the VM is stopped with it.
        yield* TestClock.adjust(Duration.minutes(10));
        yield* until(() => spawned.some(isSmolvm("stop")));
        assert.deepEqual(spawned.find(isSmolvm("stop"))?.args, [
          "machine",
          "stop",
          "--name",
          MACHINE,
        ]);

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
  "a sandboxed agent's stop signals its processes in the VM before its command is ended, the VM stops once the runner has ended, and a discard checks the folder for unsaved work inside the VM, then deletes the VM before the agent's folder",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const seen: {
          signalWhileRunning?: boolean;
          stopAfterRunnerEnded?: boolean;
          folderAtDelete?: boolean;
          checkedBeforeDelete?: boolean;
        } = {};
        let folder = "";
        const { spawned, layout, credentials } = yield* following({
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
          onSmolvm: (args, sofar) => {
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
            if (isSmolvm("delete")({ program: SMOLVM, args })) {
              seen.folderAtDelete = existsSync(folder);
              seen.checkedBeforeDelete = sofar.some(isUnsavedCheck);
            }
          },
        });
        folder = layout.folder;
        yield* until(() => spawned.some(isSignal));
        yield* TestClock.adjust(Duration.seconds(1));
        yield* until(() => spawned.some(isSmolvm("delete")) && !existsSync(layout.folder));

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
        assert.deepEqual(seen, {
          signalWhileRunning: true,
          stopAfterRunnerEnded: true,
          folderAtDelete: true,
          checkedBeforeDelete: true,
        });
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
