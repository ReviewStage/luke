/**
 * local-agent-orphans.test.ts -- the follower's passes over the agents this machine made, its agents run straight on the box and their folders kept for their life: a VM a run from before left deleted; an agent two answered reads in a row leave out removed whole, but kept, for a week, where the box's check finds work in its folder, whatever a save record from before says; never on a read that was not answered, never under a runner or a launch still kept, never another install's agent, at most five a pass, a folder with unsaved work kept once and never checked again, a listed folder never let go of past a warm window, a box with no smolvm never held up by it, and a pass that died never the last; and the agents an install ran before it kept its record of them taken as its own as the gate opens, a Mac's by its own state alone and never by the store it shares, a Linux host's by its folders and machines.
 *
 * The follower runs the real smolvm sandbox over a fake `smolvm` that keeps
 * its machines in a set, on a real temporary folder, against a fake service
 * whose live-agents read answers what each test lists, read by read, and
 * never answers past the last, so a test knows a pass is over once the next
 * read is asked. Note that the disk answers on no clock of the test's, so
 * the clock is moved only once nothing asked of the disk waits unanswered,
 * or a slow disk would let it run past a pass's window while the pass waits
 * on the disk. Synthetic ids throughout.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { setImmediate as nextTurn } from "node:timers/promises";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import type { DeviceAgentClaimedLine } from "@luke/features";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_ARCH,
  DEVICE_CAPABILITY,
  DEVICE_ISOLATION,
  DEVICE_PLATFORM,
  deviceAgentLayout,
} from "@luke/features/device-agent-wire";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { ConfigProvider, Deferred, Duration, Effect, Exit, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { composeLocalAgents } from "./compose-local-agents.js";
import { Environment, LocalAgentPlatform, Reporter } from "./effect/seams.js";
import { smolvmSandbox } from "./node/smolvm-sandbox.js";
import { fakeClis } from "./testing/fake-sandbox.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

const SMOLVM = "/usr/local/bin/smolvm";
const RUNNER_FOLDER = "/opt/luke-host/lib";
/** The runner's own start on the box, as the platform launches it. */
const RUNNER = "/opt/luke-host/node/bin/node";
const USER_ID = "user-fixture";
/** The platform's check of a worktree, named so the scripted spawner answers it, the worktree after it. */
const UNSAVED_WORK_SCRIPT = "check-for-unsaved-work";
/** What smolvm answers a delete of a machine it has no record of. */
const NOT_FOUND = {
  exitCode: 1,
  stderr: '{"error":{"code":"NOT_FOUND","message":"vm not found"}}\n',
};

/** When a saved agent's last turn ended, as a host that saved its agents' state recorded it: past its 15 minutes' warm window as the clock starts. */
const ENDED_PAST_WINDOW = -Duration.toMillis(Duration.minutes(16));
/** When a folder was first kept: half a pass short of a week as the second pass runs, five minutes in, and so half a pass past it as the third does. */
const KEPT_A_WEEK_BY_THE_THIRD_PASS =
  Duration.toMillis(Duration.minutes(7.5)) - Duration.toMillis(Duration.days(7));

const AGENT = {
  ORPHAN: "6f1c2a4e-0b7d-4c55-9a3e-2d8f61b0c9a1",
  LIVE: "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
  RUNNING: "1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7a8b",
  LAUNCH_KEPT: "2c3d4e5f-6071-4829-8b3c-4d5e6f7a8b9c",
  UNSAVED: "3d4e5f60-7182-4930-9c4d-5e6f7a8b9c0d",
  OTHER_INSTALL: "4e5f6071-8293-4a41-8d5e-6f7a8b9c0d1e",
  FROM_BEFORE: "607182a3-a4b5-4c63-8f70-8b9c0d1e2f30",
} as const;

/** How many turns in a row must find nothing asked of the disk unanswered before the follower is taken to wait on the clock alone. */
const QUIET_TURNS = 3;

/** Whether a request this process made of the disk is still unanswered. */
const diskAsked = () =>
  process.getActiveResourcesInfo().some((resource) => resource.startsWith("FSReq"));

/**
 * The follower's fibers given their turns, and the disk its time, until
 * `QUIET_TURNS` turns in a row find nothing asked of the disk unanswered, so
 * a test moves the clock only while the follower waits on it and never
 * while the disk keeps it, however slow the disk.
 */
const settled = Effect.gen(function* () {
  for (let quiet = 0; quiet < QUIET_TURNS; ) {
    yield* Effect.promise(() => nextTurn());
    quiet = diskAsked() ? 0 : quiet + 1;
  }
});

/** An id for the `index`th of many agents. */
const agentNumbered = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

/** The agents a device holds things for, as a test lays them out before the follower starts. */
interface Held {
  /** Agents with a VM a run from before left, its credentials, and a folder holding a worktree. */
  readonly whole?: readonly string[];
  /** Agents with a VM and nothing else. */
  readonly vmOnly?: readonly string[];
  /** Agents with a folder and nothing else. */
  readonly folderOnly?: readonly string[];
  /** Machines smolvm lists that are not agents' VMs. */
  readonly otherMachines?: readonly string[];
}

/**
 * The follower on a Linux host, or This Mac where `mac` says, whose agents
 * run straight on it, with what `held` lays out, every agent of it recorded
 * as this machine's but those `unowned` names, another install's, and those
 * `madeBeforeRecord` names, which this machine made before it kept that
 * record, in a folder and smolvm store shared with another install, as a
 * Mac's are, or its own alone where `storesOwned` says, as a Linux host's
 * are; with the save records `savedBefore` names, as a host that saved its
 * agents' state left them, and kept since when `kept` says; its check of a
 * worktree printing what `unsavedWork` names for its agent, and nothing for
 * any other; its live-agents read answering `reads` one after another; and
 * smolvm, where the box has it, as it does but where `noSmolvm` says,
 * refusing each delete `deleteFails` says, by the machine and how many
 * times it was asked to delete it. `launches` hands launch lines whose
 * runners run until the test ends, and `keptLaunches` are kept from a run
 * that ended, whose settles the service refuses.
 */
const following = (input: {
  readonly held: Held;
  readonly unowned?: readonly string[];
  readonly madeBeforeRecord?: readonly string[];
  readonly storesOwned?: boolean;
  readonly mac?: boolean;
  readonly savedBefore?: readonly string[];
  readonly kept?: Readonly<Record<string, number>>;
  readonly reads: readonly (readonly string[] | undefined)[];
  readonly unsavedWork?: Readonly<Record<string, string>>;
  readonly noSmolvm?: boolean;
  readonly deleteFails?: (machine: string, attempt: number) => boolean;
  readonly launches?: (home: string) => readonly DeviceAgentClaimedLine[];
  readonly keptLaunches?: readonly { readonly id: string; readonly agentId: string }[];
  /** The first listing of what the VMs hold dies, as a bug would. */
  readonly firstListingDies?: boolean;
}) =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped("luke-agent-orphans-");
    const home = `${root}/home`;
    const stateRoot = `${root}/state`;
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
    const owned = [
      ...(input.held.whole ?? []),
      ...(input.held.vmOnly ?? []),
      ...(input.held.folderOnly ?? []),
    ].filter((agentId) => !(input.unowned ?? []).includes(agentId));
    mkdirSync(`${stateRoot}/owned-agents`, { recursive: true });
    for (const agentId of owned.filter((each) => !(input.madeBeforeRecord ?? []).includes(each))) {
      writeFileSync(`${stateRoot}/owned-agents/${agentId}`, "");
    }
    const saves = Object.fromEntries(
      (input.savedBefore ?? []).map((agentId) => [
        agentId,
        { userId: USER_ID, generation: 1, endedAt: ENDED_PAST_WINDOW },
      ]),
    );
    writeFileSync(
      `${stateRoot}/local-agents.json`,
      JSON.stringify({
        devices: { [USER_ID]: "device-1" },
        launches: (input.keptLaunches ?? []).map((launch) => ({ userId: USER_ID, ...launch })),
        saves,
        ...(input.kept === undefined ? {} : { kept: input.kept }),
        // Note that This Mac records how each of its agents ran, these in VMs before they ran on the box.
        ...(input.mac === true
          ? {
              modes: Object.fromEntries(
                owned.map((agentId) => [agentId, DEVICE_ISOLATION.SANDBOX]),
              ),
            }
          : {}),
      }),
    );

    const deletes = new Map<string, number>();
    const killed = Deferred.makeUnsafe<void>();
    const spawner = scriptedSpawner((program, args) => {
      if (program === "/bin/bash" && args[0] === "-l")
        return { stdout: "/usr/bin:/bin", exitCode: 0 };
      const [check, worktree] = (args[1] ?? "").split(" ");
      if (program === "/bin/bash" && check === UNSAVED_WORK_SCRIPT) {
        const agentId = Object.keys(input.unsavedWork ?? {}).find(
          (each) => worktree === deviceAgentLayout(home, each).checkoutPath,
        );
        return {
          stdout: agentId === undefined ? "" : (input.unsavedWork?.[agentId] ?? ""),
          exitCode: 0,
        };
      }
      if (program === "/bin/bash") return { exitCode: 0 };
      // Note that a runner runs until its process group is killed, as the test's scope closes.
      if (program === RUNNER) {
        return {
          exitCode: 143,
          until: Deferred.await(killed),
          killed: Deferred.succeed(killed, undefined),
        };
      }
      // Note that a smolvm the box does not have never starts, as a missing program does not.
      if (program !== SMOLVM || input.noSmolvm === true || args[0] !== "machine") return undefined;
      const name = args[args.indexOf("--name") + 1] ?? "";
      switch (args[1]) {
        case "ls":
          return { stdout: [...machines].map((each) => `${each}\n`).join(""), exitCode: 0 };
        case "delete":
          deletes.set(name, (deletes.get(name) ?? 0) + 1);
          if (input.deleteFails?.(name, deletes.get(name) ?? 0) === true) return { exitCode: 1 };
          return machines.delete(name) ? { exitCode: 0 } : NOT_FOUND;
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
      saveState: () => Effect.die("a device whose agents run on the box saves no state"),
      commitState: () => Effect.die("a device whose agents run on the box saves no state"),
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
      smolvm: input.noSmolvm === true ? undefined : SMOLVM,
      stateRoot,
      runnerFolder: RUNNER_FOLDER,
      user: { uid: 990, gid: 991 },
      nested: false,
    });
    let listings = 0;
    const sandbox = {
      ...vm.sandbox,
      machines: Effect.suspend(() =>
        input.firstListingDies === true && listings++ === 0
          ? Effect.die(new Error("the listing broke"))
          : vm.sandbox.machines,
      ),
    };
    const reported: string[] = [];
    const clis = fakeClis();
    const services = Layer.mergeAll(
      spawner.layer,
      NodePath.layer,
      NodeFileSystem.layer,
      fakeHttpClientLayer(() => Promise.reject(new Error("this test fetches nothing"))),
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord({ HOME: home, SHELL: "/bin/bash" })),
      Layer.succeed(Reporter, { report: (line) => reported.push(line) }),
      Layer.succeed(LocalAgentPlatform, {
        launch: ({ node, env }) => ({ command: node, args: [], env }),
        tools: { node: RUNNER, claude: clis.paths.claude, codex: clis.paths.codex },
        sandbox,
        clis,
        runnerBundle: `${RUNNER_FOLDER}/agent-runner.mjs`,
        runnerEnv: {},
        formerlyDirect: input.mac === true,
        storesOwned: input.storesOwned === true,
        deviceName: "rack-1",
        devicePlatform: input.mac === true ? DEVICE_PLATFORM.DARWIN : DEVICE_PLATFORM.LINUX,
        deviceArch: input.mac === true ? DEVICE_ARCH.ARM64 : DEVICE_ARCH.X64,
        deviceIsolation: DEVICE_ISOLATION.DIRECT,
        deviceCapabilities: [DEVICE_CAPABILITY.DISCARD],
        worktreeScript: () => "exit 0",
        unsavedWorkScript: ({ worktree }) => `${UNSAVED_WORK_SCRIPT} ${worktree}`,
        stateSealed: () => Effect.die("this device saves no state"),
        stateOpened: () => Effect.die("this device restores no state"),
        diskFree: () => Effect.succeed(Option.none()),
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
     * time, each move once the follower has `settled`, until the `count`th
     * pass is over, which it is once the read after it is asked.
     */
    const passed = (count: number) =>
      Effect.gen(function* () {
        for (const gate of gates.slice(0, count)) Deferred.doneUnsafe(gate, Exit.void);
        // Note that two passes stand five minutes apart, and each round moves the clock a second.
        for (let round = 0; round < 20 * 60 * count && reads <= count; round += 1) {
          yield* settled;
          yield* TestClock.adjust(Duration.seconds(1));
        }
        assert.ok(reads > count, `the follower read ${reads} times, short of ${count + 1}`);
      });

    /** What the device holds of the agent: its VM, its credentials, and its folder. */
    const holdsOf = (agentId: string) => ({
      vm: machines.has(`luke-${agentId}`),
      credentials: existsSync(credentialsOf(agentId)),
      folder: existsSync(deviceAgentLayout(home, agentId).folder),
    });

    const checksRun = () =>
      spawner.spawned.filter((each) => (each.args[1] ?? "").startsWith(UNSAVED_WORK_SCRIPT)).length;
    const machineCommands = (agentId: string) =>
      spawner.spawned.filter((each) => each.args.includes(`luke-${agentId}`)).length;
    const keptRecorded = () =>
      Object.keys(JSON.parse(readFileSync(`${stateRoot}/local-agents.json`, "utf8")).kept ?? {});
    const ownedRecorded = () => readdirSync(`${stateRoot}/owned-agents`).sort();

    return {
      home,
      stateRoot,
      machines,
      reported,
      passed,
      holdsOf,
      checksRun,
      machineCommands,
      keptRecorded,
      ownedRecorded,
    };
  });

const NOTHING = { vm: false, credentials: false, folder: false };
const EVERYTHING = { vm: true, credentials: true, folder: true };

it.effect(
  "an agent left out of two reads in a row is removed whole, but not after one, while a listed agent stays and one whose check finds work keeps its folder",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = yield* following({
          held: { whole: [AGENT.ORPHAN, AGENT.LIVE], folderOnly: [AGENT.UNSAVED] },
          unsavedWork: { [AGENT.UNSAVED]: "it has changes not committed\n" },
          reads: [[AGENT.LIVE], [AGENT.LIVE]],
        });
        yield* device.passed(1);

        assert.equal(device.holdsOf(AGENT.ORPHAN).folder, true);
        yield* device.passed(2);

        assert.deepEqual(device.holdsOf(AGENT.ORPHAN), NOTHING);
        assert.equal(device.holdsOf(AGENT.LIVE).folder, true);
        assert.equal(device.holdsOf(AGENT.UNSAVED).folder, true);
        assert.deepEqual(device.keptRecorded(), [AGENT.UNSAVED]);
        assert.ok(device.reported.some((line) => line.endsWith(AGENT.ORPHAN)));
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("a read the service did not answer removes nothing and counts for nothing", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const device = yield* following({
        held: { folderOnly: [AGENT.ORPHAN] },
        reads: [[], undefined, []],
      });
      yield* device.passed(2);

      assert.equal(device.holdsOf(AGENT.ORPHAN).folder, true);
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
      assert.equal(device.holdsOf(AGENT.RUNNING).folder, true);
      // Note that a kept launch's VM from before goes as the gate opens, its turn let go of, and its folder stays.
      assert.deepEqual(device.holdsOf(AGENT.LAUNCH_KEPT), { ...NOTHING, folder: true });
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a folder whose check finds unsaved work is kept, recorded, and never checked again, whatever a save record from before says",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        // Note that its state was saved before the device stopped saving, which holds no copy Luke keeps for it any more.
        const device = yield* following({
          held: { whole: [AGENT.ORPHAN] },
          savedBefore: [AGENT.ORPHAN],
          reads: [[], [], [], []],
          unsavedWork: { [AGENT.ORPHAN]: "it has changes not committed\n" },
        });
        yield* device.passed(2);

        assert.deepEqual(device.holdsOf(AGENT.ORPHAN), { ...NOTHING, folder: true });
        assert.deepEqual(device.keptRecorded(), [AGENT.ORPHAN]);
        assert.equal(device.checksRun(), 1);
        // Note that two more reads leave it out, as two did before it was kept.
        yield* device.passed(4);

        assert.equal(device.checksRun(), 1);
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
  "another install's agent keeps its folder and machine through every pass, while this machine's are removed",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = yield* following({
          held: {
            whole: [AGENT.OTHER_INSTALL],
            vmOnly: [agentNumbered(1)],
            folderOnly: [agentNumbered(2)],
            otherMachines: ["devbox"],
          },
          unowned: [AGENT.OTHER_INSTALL],
          reads: [[], []],
        });
        yield* device.passed(2);

        assert.deepEqual(device.holdsOf(AGENT.OTHER_INSTALL), EVERYTHING);
        assert.deepEqual(device.holdsOf(agentNumbered(1)), NOTHING);
        assert.deepEqual(device.holdsOf(agentNumbered(2)), NOTHING);
        assert.deepEqual([...device.machines].sort(), ["devbox", `luke-${AGENT.OTHER_INSTALL}`]);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a listed agent's folder stays for its life, though a save record from before says its state was saved and its last turn ended past the warm window",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = yield* following({
          held: { folderOnly: [AGENT.LIVE] },
          savedBefore: [AGENT.LIVE],
          reads: [[AGENT.LIVE], [AGENT.LIVE]],
        });
        yield* device.passed(2);

        assert.equal(device.holdsOf(AGENT.LIVE).folder, true);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a listed agent's VM a run left standing is deleted by a pass, and its folder stays",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = yield* following({
          held: { whole: [AGENT.LIVE] },
          reads: [[AGENT.LIVE]],
          // Note that the delete as the gate opens fails, so the VM stands when the first pass runs.
          deleteFails: (_machine, attempt) => attempt === 1,
        });
        yield* device.passed(1);

        assert.deepEqual(device.holdsOf(AGENT.LIVE), { ...NOTHING, folder: true });
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a folder kept for work nowhere else stays until a week after it was first kept, and then goes whole",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = yield* following({
          held: { folderOnly: [AGENT.ORPHAN] },
          kept: { [AGENT.ORPHAN]: KEPT_A_WEEK_BY_THE_THIRD_PASS },
          reads: [[], [], []],
        });
        yield* device.passed(2);

        assert.equal(device.holdsOf(AGENT.ORPHAN).folder, true);
        yield* device.passed(3);

        assert.deepEqual(device.holdsOf(AGENT.ORPHAN), NOTHING);
        assert.deepEqual(device.keptRecorded(), []);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("a pass that died is reported, and the passes after it still run", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const device = yield* following({
        held: { folderOnly: [AGENT.ORPHAN] },
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

it.effect(
  "a Mac takes as its own, as its gate opens, an agent its state says it ran but never recorded, deleting its VM, and never one only the store it shares holds",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = yield* following({
          held: { whole: [AGENT.FROM_BEFORE, AGENT.OTHER_INSTALL] },
          madeBeforeRecord: [AGENT.FROM_BEFORE],
          unowned: [AGENT.OTHER_INSTALL],
          mac: true,
          reads: [[AGENT.FROM_BEFORE, AGENT.OTHER_INSTALL]],
        });
        yield* device.passed(1);

        assert.deepEqual(device.ownedRecorded(), [AGENT.FROM_BEFORE]);
        assert.deepEqual(device.holdsOf(AGENT.FROM_BEFORE), { ...NOTHING, folder: true });
        assert.deepEqual(device.holdsOf(AGENT.OTHER_INSTALL), EVERYTHING);
        assert.equal(device.machineCommands(AGENT.OTHER_INSTALL), 0);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a Linux host takes as its own, as its gate opens, every agent with a folder or a machine in its own store, deleting their VMs",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const [whole, vmOnly, folderOnly] = [agentNumbered(1), agentNumbered(2), agentNumbered(3)];
        const device = yield* following({
          held: { whole: [whole], vmOnly: [vmOnly], folderOnly: [folderOnly] },
          madeBeforeRecord: [whole, vmOnly, folderOnly],
          storesOwned: true,
          reads: [[whole, vmOnly, folderOnly]],
        });
        yield* device.passed(1);

        assert.deepEqual(device.ownedRecorded(), [whole, vmOnly, folderOnly]);
        assert.deepEqual(device.holdsOf(whole), { ...NOTHING, folder: true });
        assert.deepEqual(device.holdsOf(vmOnly), NOTHING);
        assert.deepEqual(device.holdsOf(folderOnly), { ...NOTHING, folder: true });
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a box whose service names no smolvm holds no VM, so its passes go on and an agent left out is removed whole, its record let go of",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = yield* following({
          held: { folderOnly: [AGENT.ORPHAN] },
          noSmolvm: true,
          reads: [[], []],
        });
        yield* device.passed(2);

        assert.deepEqual(device.holdsOf(AGENT.ORPHAN), NOTHING);
        assert.deepEqual(device.ownedRecorded(), []);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);
