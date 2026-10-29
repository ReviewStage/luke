/**
 * local-agent-orphans.test.ts -- the follower letting go of what a device holds for agents the service no longer lists there: an agent's VM, credentials and folder removed once two successful reads in a row leave it out, never on a read that was not answered, never under a runner or a launch still kept, never anything not named as an agent's, a Mac's folder with unsaved work kept once and never checked again, at most five a pass, and a VM whose delete failed tried again, and a pass that died never the last.
 *
 * The follower runs the real smolvm sandbox over a fake `smolvm` that keeps
 * its machines in a set, on a real temporary folder, against a fake service
 * whose live-agents read answers what each test lists, read by read, and
 * never answers past the last, so a test knows a pass is over once the next
 * read is asked. Synthetic ids throughout.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import type { DeviceAgentClaimedLine } from "@luke/features";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_ARCH,
  DEVICE_ISOLATION,
  DEVICE_PLATFORM,
  deviceAgentLayout,
} from "@luke/features/device-agent-wire";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { ConfigProvider, Deferred, Duration, Effect, Exit, Layer } from "effect";
import { TestClock } from "effect/testing";
import { composeLocalAgents } from "./compose-local-agents.js";
import { Environment, LocalAgentPlatform, Reporter } from "./effect/seams.js";
import { smolvmSandbox } from "./node/smolvm-sandbox.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

const SMOLVM = "/usr/local/bin/smolvm";
const RUNNER_FOLDER = "/opt/luke-host/lib";
const USER_ID = "user-fixture";
/** The platform's check of a worktree, named so the fake smolvm answers it. */
const UNSAVED_WORK_SCRIPT = "check-for-unsaved-work";

const AGENT = {
  ORPHAN: "6f1c2a4e-0b7d-4c55-9a3e-2d8f61b0c9a1",
  LIVE: "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
  RUNNING: "1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7a8b",
  LAUNCH_KEPT: "2c3d4e5f-6071-4829-8b3c-4d5e6f7a8b9c",
} as const;

/** An id for the `index`th of many agents. */
const agentNumbered = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

/** The agents a device holds things for, as a test lays them out before the follower starts. */
interface Held {
  /** Agents with a VM, its credentials, and a folder holding a worktree. */
  readonly whole?: readonly string[];
  /** Agents with a VM and nothing else. */
  readonly vmOnly?: readonly string[];
  /** Agents with a folder and nothing else. */
  readonly folderOnly?: readonly string[];
  /** Machines smolvm lists that are not agents' VMs. */
  readonly otherMachines?: readonly string[];
}

/**
 * The follower on a host, or a Mac where `unsavedWork` names what its check
 * prints, with what `held` lays out, its live-agents read answering `reads`
 * one after another, and `failedDeletes` of smolvm's first deletes failing.
 * `launches` hands launch lines whose runners run until the test ends, and
 * `keptLaunches` are kept from a run that ended, whose settles the service
 * refuses.
 */
const following = (input: {
  readonly held: Held;
  readonly reads: readonly (readonly string[] | undefined)[];
  readonly unsavedWork?: string;
  readonly failedDeletes?: number;
  readonly launches?: (home: string) => readonly DeviceAgentClaimedLine[];
  readonly keptLaunches?: readonly { readonly id: string; readonly agentId: string }[];
  /** The first listing of what the VMs hold dies, as a bug would. */
  readonly firstListingDies?: boolean;
}) =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped("luke-agent-orphans-");
    const home = `${root}/home`;
    const stateRoot = `${root}/state`;
    const agentsRoot = `${home}/.luke/agents`;
    const credentialsOf = (agentId: string) => `${stateRoot}/sandboxes/${agentId}`;
    const machines = new Set<string>();
    for (const agentId of [...(input.held.whole ?? []), ...(input.held.vmOnly ?? [])]) {
      machines.add(`luke-${agentId}`);
    }
    for (const name of input.held.otherMachines ?? []) machines.add(name);
    for (const agentId of input.held.whole ?? []) {
      mkdirSync(credentialsOf(agentId), { recursive: true });
      writeFileSync(`${credentialsOf(agentId)}/github-token`, "");
    }
    for (const agentId of [...(input.held.whole ?? []), ...(input.held.folderOnly ?? [])]) {
      mkdirSync(deviceAgentLayout(home, agentId).checkoutPath, { recursive: true });
    }
    if (input.keptLaunches !== undefined) {
      writeFileSync(
        `${stateRoot}/local-agents.json`,
        JSON.stringify({
          devices: { [USER_ID]: "device-1" },
          launches: input.keptLaunches.map((launch) => ({ userId: USER_ID, ...launch })),
        }),
      );
    }

    let failedDeletes = input.failedDeletes ?? 0;
    const signalled = Deferred.makeUnsafe<void>();
    const spawner = scriptedSpawner((program, args) => {
      if (program === "/bin/bash" && args[0] === "-l")
        return { stdout: "/usr/bin:/bin", exitCode: 0 };
      if (program === "/bin/bash") return { exitCode: 0 };
      if (program !== SMOLVM || args[0] !== "machine") return undefined;
      const name = args[args.indexOf("--name") + 1] ?? "";
      switch (args[1]) {
        case "ls":
          return { stdout: [...machines].map((each) => `${each}\n`).join(""), exitCode: 0 };
        case "create":
          machines.add(name);
          return { exitCode: 0 };
        case "start":
          return machines.has(name)
            ? { exitCode: 0 }
            : { exitCode: 1, stderr: '{"error":{"code":"NOT_FOUND","message":"no machine"}}\n' };
        case "delete":
          if (failedDeletes > 0) {
            failedDeletes -= 1;
            return { exitCode: 1 };
          }
          return machines.delete(name) ? { exitCode: 0 } : { exitCode: 1 };
        case "exec":
          if (args.includes(UNSAVED_WORK_SCRIPT)) {
            return { stdout: input.unsavedWork ?? "", exitCode: 0 };
          }
          // Note that a runner runs until its processes are signalled in its VM, as the test's scope closes.
          if (args.some((each) => each.includes("process.kill"))) {
            Deferred.doneUnsafe(signalled, Exit.void);
            return { exitCode: 0 };
          }
          return args.includes(`${RUNNER_FOLDER}/agent-runner.mjs`)
            ? { exitCode: 143, until: Deferred.await(signalled) }
            : { exitCode: 0 };
        default:
          return { exitCode: 0 };
      }
    });

    let reads = 0;
    /** Each read's answer held back until the test lets its pass run (`passed`). */
    const gates = input.reads.map(() => Deferred.makeUnsafe<void>());
    const launches = input.launches?.(home) ?? [];
    let linesRead = 0;
    const client = {
      register: () => Effect.succeed(true),
      beat: () => Effect.succeed({}),
      lines: () =>
        linesRead++ === 0 && launches.length > 0
          ? Effect.succeed(launches.map((each) => each.line))
          : Effect.never,
      claimLine: (_deviceId: string, id: string) =>
        Effect.succeed(launches.find((each) => each.line.id === id)),
      // Note that the service refuses every settle, so a launch kept from an earlier run stays kept.
      settleLine: () => Effect.succeed(false),
      requests: () => Effect.never,
      claimRequest: () => Effect.succeed({ claimed: false as const }),
      answerRequest: () => Effect.succeed(true),
      githubToken: () => Effect.succeed(undefined),
      liveAgents: () =>
        Effect.suspend(() => {
          const index = reads;
          reads += 1;
          const gate = gates[index];
          return gate === undefined
            ? Effect.never
            : Effect.as(Deferred.await(gate), input.reads[index]);
        }),
    };
    const vm = smolvmSandbox({
      smolvm: SMOLVM,
      stateRoot,
      runnerFolder: RUNNER_FOLDER,
      user: { uid: 990, gid: 991 },
      nested: false,
    });
    let listings = 0;
    const sandbox = {
      ...vm.sandbox,
      held: Effect.suspend(() =>
        input.firstListingDies === true && listings++ === 0
          ? Effect.die(new Error("the listing broke"))
          : vm.sandbox.held,
      ),
    };
    const reported: string[] = [];
    const services = Layer.mergeAll(
      spawner.layer,
      NodePath.layer,
      NodeFileSystem.layer,
      fakeHttpClientLayer(() => Promise.reject(new Error("this test fetches nothing"))),
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord({ HOME: home, SHELL: "/bin/bash" })),
      Layer.succeed(Reporter, { report: (line) => reported.push(line) }),
      Layer.succeed(LocalAgentPlatform, {
        launch: vm.launch,
        sandbox,
        runnerBundle: `${RUNNER_FOLDER}/agent-runner.mjs`,
        runnerEnv: {},
        formerlyDirect: false,
        deviceName: "rack-1",
        devicePlatform: DEVICE_PLATFORM.LINUX,
        deviceArch: DEVICE_ARCH.X64,
        deviceIsolation: DEVICE_ISOLATION.SANDBOX,
        deviceCapabilities: [],
        worktreeScript: () => "exit 0",
        unsavedWorkScript: input.unsavedWork === undefined ? undefined : () => UNSAVED_WORK_SCRIPT,
      }),
    );
    const composer = yield* composeLocalAgents({
      kernel: { stateRoot, createId: () => "device-1", runMode: { sendsNetwork: true } },
      account: { capabilitiesActive: () => true },
      accountId: () => USER_ID,
      switchedOn: Effect.succeed(true),
      client,
    }).pipe(Effect.provide(services));
    yield* composer.lifetime;

    /**
     * The first `count` reads answered, and the clock moved on a second at a
     * time, the follower's fibers and the disk they wait on, which waits on
     * no clock, given their turn between, until the `count`th pass is over,
     * which it is once the read after it is asked.
     */
    const passed = (count: number) =>
      Effect.gen(function* () {
        for (const gate of gates.slice(0, count)) Deferred.doneUnsafe(gate, Exit.void);
        // Note that two passes stand ten minutes apart, and each round moves the clock a second.
        for (let round = 0; round < 20 * 60 * count && reads <= count; round += 1) {
          yield* TestClock.adjust(Duration.seconds(1));
          for (let turn = 0; turn < 4; turn += 1) yield* Effect.yieldNow;
        }
        assert.ok(reads > count, `the follower read ${reads} times, short of ${count + 1}`);
      });

    /** What the device holds of the agent: its VM, its credentials, and its folder. */
    const holdsOf = (agentId: string) => ({
      vm: machines.has(`luke-${agentId}`),
      credentials: existsSync(credentialsOf(agentId)),
      folder: existsSync(deviceAgentLayout(home, agentId).folder),
    });

    const deletesAsked = () =>
      spawner.spawned.filter((each) => each.program === SMOLVM && each.args[1] === "delete");
    const checksRun = () =>
      spawner.spawned.filter((each) => each.args.includes(UNSAVED_WORK_SCRIPT)).length;
    const machineCommands = (agentId: string) =>
      spawner.spawned.filter((each) => each.args.includes(`luke-${agentId}`)).length;
    const keptRecorded = () =>
      JSON.parse(readFileSync(`${stateRoot}/local-agents.json`, "utf8")).kept ?? [];

    return {
      home,
      agentsRoot,
      stateRoot,
      machines,
      reported,
      passed,
      holdsOf,
      deletesAsked,
      checksRun,
      machineCommands,
      keptRecorded,
    };
  });

const NOTHING = { vm: false, credentials: false, folder: false };
const EVERYTHING = { vm: true, credentials: true, folder: true };

it.effect(
  "an agent left out of two reads in a row has its VM, credentials and folder removed, but not after one, and a listed agent is left be",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = yield* following({
          held: { whole: [AGENT.ORPHAN, AGENT.LIVE] },
          reads: [[AGENT.LIVE], [AGENT.LIVE]],
        });
        yield* device.passed(1);

        assert.deepEqual(device.holdsOf(AGENT.ORPHAN), EVERYTHING);
        yield* device.passed(2);

        assert.deepEqual(device.holdsOf(AGENT.ORPHAN), NOTHING);
        assert.deepEqual(device.holdsOf(AGENT.LIVE), EVERYTHING);
        assert.ok(device.reported.some((line) => line.endsWith(AGENT.ORPHAN)));
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("a read the service did not answer removes nothing and counts for nothing", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const device = yield* following({
        held: { whole: [AGENT.ORPHAN] },
        reads: [[], undefined, []],
      });
      yield* device.passed(2);

      assert.deepEqual(device.holdsOf(AGENT.ORPHAN), EVERYTHING);
      // Note that the read before the unanswered one still counts, so the next answered read is the second in a row.
      yield* device.passed(3);

      assert.deepEqual(device.holdsOf(AGENT.ORPHAN), NOTHING);
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("an agent whose runner runs, or whose launch is still kept, is left be", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const device = yield* following({
        held: { whole: [AGENT.LAUNCH_KEPT], folderOnly: [AGENT.ORPHAN] },
        reads: [[], []],
        keptLaunches: [{ id: "4d5e6f70-8192-4a3b-8c4d-5e6f7a8b9c0d", agentId: AGENT.LAUNCH_KEPT }],
        launches: (home) => [
          {
            line: {
              id: "5e6f7081-92a3-4b4c-9d5e-6f7a8b9c0d1e",
              agentId: AGENT.RUNNING,
              seq: 1,
              kind: DEVICE_AGENT_LINE_KIND.LAUNCH,
              payload: {
                checkoutPath: deviceAgentLayout(home, AGENT.RUNNING).checkoutPath,
                repository: null,
                startBranch: null,
                firstSequence: 0,
              },
            },
            secrets: { env: {}, stdin: "{}\n" },
          },
        ],
      });
      yield* device.passed(2);

      assert.deepEqual(device.holdsOf(AGENT.ORPHAN), NOTHING, "the pass never ran");
      assert.equal(device.holdsOf(AGENT.RUNNING).vm, true);
      assert.deepEqual(device.holdsOf(AGENT.LAUNCH_KEPT), EVERYTHING);
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a Mac's folder whose check finds unsaved work is kept, its VM deleted, recorded, and never checked again",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = yield* following({
          held: { whole: [AGENT.ORPHAN] },
          reads: [[], [], [], []],
          unsavedWork: "it has changes not committed\n",
        });
        yield* device.passed(2);

        assert.deepEqual(device.holdsOf(AGENT.ORPHAN), {
          vm: false,
          credentials: false,
          folder: true,
        });
        assert.deepEqual(device.keptRecorded(), [AGENT.ORPHAN]);
        assert.equal(device.checksRun(), 1);
        const before = device.machineCommands(AGENT.ORPHAN);
        // Note that two more reads leave it out, as two did before it was kept.
        yield* device.passed(4);

        assert.equal(device.checksRun(), 1);
        assert.equal(device.machineCommands(AGENT.ORPHAN), before, "its VM was woken again");
        assert.equal(device.holdsOf(AGENT.ORPHAN).folder, true);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("a pass lets go of five agents at most, and the next pass of the rest", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const agents = Array.from({ length: 7 }, (_, index) => agentNumbered(index + 1));
      const device = yield* following({ held: { folderOnly: agents }, reads: [[], [], []] });
      yield* device.passed(2);

      assert.equal(agents.filter((agentId) => device.holdsOf(agentId).folder).length, 2);
      yield* device.passed(3);

      assert.equal(agents.filter((agentId) => device.holdsOf(agentId).folder).length, 0);
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a folder or a machine not named as an agent's is never touched, and a VM with no folder and a folder with no VM are both removed",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = yield* following({
          held: {
            vmOnly: [agentNumbered(1)],
            folderOnly: [agentNumbered(2)],
            otherMachines: ["devbox", "luke-scratch", `other-${AGENT.ORPHAN}`],
          },
          reads: [[], []],
        });
        mkdirSync(`${device.agentsRoot}/notes`, { recursive: true });
        mkdirSync(`${device.agentsRoot}/${AGENT.ORPHAN}-copy`, { recursive: true });
        mkdirSync(`${device.stateRoot}/sandboxes/scratch`, { recursive: true });
        yield* device.passed(2);

        assert.deepEqual(device.holdsOf(agentNumbered(1)), NOTHING);
        assert.deepEqual(device.holdsOf(agentNumbered(2)), NOTHING);
        assert.deepEqual(
          [...device.machines].sort(),
          ["devbox", "luke-scratch", `other-${AGENT.ORPHAN}`].sort(),
        );
        assert.equal(existsSync(`${device.agentsRoot}/notes`), true);
        assert.equal(existsSync(`${device.agentsRoot}/${AGENT.ORPHAN}-copy`), true);
        assert.equal(existsSync(`${device.stateRoot}/sandboxes/scratch`), true);
        assert.deepEqual(
          device.deletesAsked().map((each) => each.args[3]),
          [`luke-${agentNumbered(1)}`, `luke-${agentNumbered(2)}`],
        );
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "an agent whose VM smolvm would not delete keeps its folder and is tried again the next pass",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = yield* following({
          held: { whole: [AGENT.ORPHAN] },
          reads: [[], [], []],
          failedDeletes: 1,
        });
        yield* device.passed(2);

        assert.deepEqual(device.holdsOf(AGENT.ORPHAN), EVERYTHING);
        yield* device.passed(3);

        assert.deepEqual(device.holdsOf(AGENT.ORPHAN), NOTHING);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("a pass that died is reported, and the passes after it still run", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const device = yield* following({
        held: { whole: [AGENT.ORPHAN] },
        reads: [[], []],
        firstListingDies: true,
      });
      // Note that the pass that died read nothing, so the two reads are the two passes after it.
      yield* device.passed(2);

      assert.deepEqual(device.holdsOf(AGENT.ORPHAN), NOTHING);
      assert.ok(device.reported.some((line) => line.includes("failed")));
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);
