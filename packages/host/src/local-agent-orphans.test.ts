/**
 * local-agent-orphans.test.ts -- the follower's passes over the agents this machine made, its agents run straight on the box and their folders kept between turns: an agent two answered reads in a row leave out removed whole, but kept, for a week, where the box's check finds work in its folder; never on a read that was not answered, never under a runner or a launch still kept, never another install's agent, at most five a pass, a folder with unsaved work kept once and never checked again, and a pass that died never the last; an idle agent's folder cleared a week after its last use where its work is all on GitHub, the agent kept as this machine's, one from before the stamp not until a week after the start that stamps it, and never a busy agent's, nor one with unpushed work, which is checked once while its agent stays idle; and the agents an install ran before it kept its record of them taken as its own as the gate opens, a Mac's by its own state alone and never by the folders it shares, a Linux host's by its folders.
 *
 * The follower runs on a real temporary folder, against a fake service
 * whose live-agents read answers what each test lists, read by read, and
 * never answers past the last, so a test knows a pass is over once the next
 * read is asked. Note that the disk answers on no clock of the test's, so
 * the clock is moved only once nothing asked of the disk waits unanswered,
 * or a slow disk would let it run past a pass's window while the pass waits
 * on the disk. Synthetic ids throughout.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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
import { ConfigProvider, Deferred, Duration, Effect, Exit, Layer } from "effect";
import { TestClock } from "effect/testing";
import { composeLocalAgents } from "./compose-local-agents.js";
import { Environment, LocalAgentPlatform, Reporter } from "./effect/seams.js";
import { fakeClis } from "./testing/fake-clis.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

const RUNNER_FOLDER = "/opt/luke-host/lib";
/** The runner's own start on the box, as the platform launches it. */
const RUNNER = "/opt/luke-host/node/bin/node";
const USER_ID = "user-fixture";
/** The platform's check of a worktree, named so the scripted spawner answers it, the worktree after it. */
const UNSAVED_WORK_SCRIPT = "check-for-unsaved-work";
/** Half a pass short of a week before the second pass runs, five minutes in, and so half a pass past a week before the third: when a folder was first kept, or an agent last used. */
const A_WEEK_BY_THE_THIRD_PASS =
  Duration.toMillis(Duration.minutes(7.5)) - Duration.toMillis(Duration.days(7));
/** When an agent unused for over a week as the clock starts was last used. */
const USED_OVER_A_WEEK_AGO = -Duration.toMillis(Duration.days(8));

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

/**
 * The follower on a Linux host, or This Mac where `mac` says, whose agents
 * run straight on it, with a folder holding a worktree for each agent
 * `held` names, every one recorded as this machine's but those `unowned`
 * names, another install's, and those `madeBeforeRecord` names, which this
 * machine made before it kept that record, in folders shared with another
 * install, as a Mac's are, or its own alone where `storesOwned` says, as a
 * Linux host's are; with each folder kept since when `kept` says; each
 * agent last used when `used` says, and each folder from before that record
 * last changed when `changedAt` says; its check of a worktree printing what
 * `unsavedWork` names for its agent, and nothing for any other; and its
 * live-agents read answering `reads` one after another, the first dying
 * before them where `firstReadDies` says. `launches` hands launch lines
 * whose runners run until the test ends, and `keptLaunches` are kept from
 * a run that ended, whose settles the service refuses.
 */
const following = (input: {
  readonly held: readonly string[];
  readonly unowned?: readonly string[];
  readonly madeBeforeRecord?: readonly string[];
  readonly storesOwned?: boolean;
  readonly mac?: boolean;
  readonly kept?: Readonly<Record<string, number>>;
  readonly used?: Readonly<Record<string, number>>;
  readonly changedAt?: Readonly<Record<string, number>>;
  readonly reads: readonly (readonly string[] | undefined)[];
  readonly unsavedWork?: Readonly<Record<string, string>>;
  readonly launches?: (home: string) => readonly DeviceAgentClaimedLine[];
  readonly keptLaunches?: readonly { readonly id: string; readonly agentId: string }[];
  /** The first read of the live agents dies, as a bug would. */
  readonly firstReadDies?: boolean;
}) =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped("luke-agent-orphans-");
    const home = `${root}/home`;
    const stateRoot = `${root}/state`;
    for (const agentId of input.held) {
      mkdirSync(deviceAgentLayout(home, agentId).checkoutPath, { recursive: true });
    }
    for (const [agentId, at] of Object.entries(input.changedAt ?? {})) {
      utimesSync(deviceAgentLayout(home, agentId).folder, new Date(at), new Date(at));
    }
    const owned = input.held.filter((agentId) => !(input.unowned ?? []).includes(agentId));
    mkdirSync(`${stateRoot}/owned-agents`, { recursive: true });
    for (const agentId of owned.filter((each) => !(input.madeBeforeRecord ?? []).includes(each))) {
      writeFileSync(`${stateRoot}/owned-agents/${agentId}`, "");
    }
    writeFileSync(
      `${stateRoot}/local-agents.json`,
      JSON.stringify({
        devices: { [USER_ID]: "device-1" },
        launches: (input.keptLaunches ?? []).map((launch) => ({ userId: USER_ID, ...launch })),
        ...(input.kept === undefined ? {} : { kept: input.kept }),
        ...(input.used === undefined ? {} : { lastUsed: input.used }),
        // Note that This Mac records how each of its agents ran, these on the box.
        ...(input.mac === true
          ? {
              modes: Object.fromEntries(owned.map((agentId) => [agentId, DEVICE_ISOLATION.DIRECT])),
            }
          : {}),
      }),
    );

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
      return undefined;
    });

    let reads = 0;
    let died = false;
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
          if (input.firstReadDies === true && !died) {
            died = true;
            return Effect.die(new Error("the read broke"));
          }
          const index = reads;
          reads += 1;
          const gate = gates[index];
          return gate === undefined
            ? Effect.never
            : Effect.as(Deferred.await(gate), input.reads[index]);
        }),
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

    /** Whether the agent's folder stands. */
    const folderStands = (agentId: string) => existsSync(deviceAgentLayout(home, agentId).folder);

    const checksRun = () =>
      spawner.spawned.filter((each) => (each.args[1] ?? "").startsWith(UNSAVED_WORK_SCRIPT)).length;
    const keptRecorded = () =>
      Object.keys(JSON.parse(readFileSync(`${stateRoot}/local-agents.json`, "utf8")).kept ?? {});
    const ownedRecorded = () => readdirSync(`${stateRoot}/owned-agents`).sort();

    return {
      home,
      stateRoot,
      reported,
      passed,
      folderStands,
      checksRun,
      keptRecorded,
      ownedRecorded,
    };
  });

it.effect(
  "an agent left out of two reads in a row is removed whole, but not after one, while a listed agent stays and one whose check finds work keeps its folder",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = yield* following({
          held: [AGENT.ORPHAN, AGENT.LIVE, AGENT.UNSAVED],
          unsavedWork: { [AGENT.UNSAVED]: "it has changes not committed\n" },
          reads: [[AGENT.LIVE], [AGENT.LIVE]],
        });
        yield* device.passed(1);

        assert.equal(device.folderStands(AGENT.ORPHAN), true);
        yield* device.passed(2);

        assert.equal(device.folderStands(AGENT.ORPHAN), false);
        assert.equal(device.folderStands(AGENT.LIVE), true);
        assert.equal(device.folderStands(AGENT.UNSAVED), true);
        assert.deepEqual(device.keptRecorded(), [AGENT.UNSAVED]);
        assert.ok(device.reported.some((line) => line.endsWith(AGENT.ORPHAN)));
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("a read the service did not answer removes nothing and counts for nothing", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const device = yield* following({
        held: [AGENT.ORPHAN],
        reads: [[], undefined, []],
      });
      yield* device.passed(2);

      assert.equal(device.folderStands(AGENT.ORPHAN), true);
      // Note that the read before the unanswered one still counts, so the next answered read is the second in a row.
      yield* device.passed(3);

      assert.equal(device.folderStands(AGENT.ORPHAN), false);
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("an agent whose runner runs, or whose launch is still kept, is left be", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const device = yield* following({
        held: [AGENT.LAUNCH_KEPT, AGENT.ORPHAN],
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

      assert.equal(device.folderStands(AGENT.ORPHAN), false, "the pass never ran");
      assert.equal(device.folderStands(AGENT.RUNNING), true);
      // Note that a kept launch's turn is let go of as the gate opens, and its folder stays.
      assert.equal(device.folderStands(AGENT.LAUNCH_KEPT), true);
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a folder whose check finds unsaved work is kept, recorded, and never checked again",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = yield* following({
          held: [AGENT.ORPHAN],
          reads: [[], [], [], []],
          unsavedWork: { [AGENT.ORPHAN]: "it has changes not committed\n" },
        });
        yield* device.passed(2);

        assert.equal(device.folderStands(AGENT.ORPHAN), true);
        assert.deepEqual(device.keptRecorded(), [AGENT.ORPHAN]);
        assert.equal(device.checksRun(), 1);
        // Note that two more reads leave it out, as two did before it was kept.
        yield* device.passed(4);

        assert.equal(device.checksRun(), 1);
        assert.equal(device.folderStands(AGENT.ORPHAN), true);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("a pass lets go of five agents at most, and the next pass of the rest", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const agents = Array.from({ length: 7 }, (_, index) => agentNumbered(index + 1));
      const device = yield* following({ held: agents, reads: [[], [], []] });
      yield* device.passed(2);

      assert.equal(agents.filter(device.folderStands).length, 2);
      yield* device.passed(3);

      assert.equal(agents.filter(device.folderStands).length, 0);
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "another install's agent keeps its folder through every pass, while this machine's is removed",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = yield* following({
          held: [AGENT.OTHER_INSTALL, AGENT.ORPHAN],
          unowned: [AGENT.OTHER_INSTALL],
          reads: [[], []],
        });
        yield* device.passed(2);

        assert.equal(device.folderStands(AGENT.OTHER_INSTALL), true);
        assert.equal(device.folderStands(AGENT.ORPHAN), false);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a folder kept for work nowhere else stays until a week after it was first kept, and then goes whole",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = yield* following({
          held: [AGENT.ORPHAN],
          kept: { [AGENT.ORPHAN]: A_WEEK_BY_THE_THIRD_PASS },
          reads: [[], [], []],
        });
        yield* device.passed(2);

        assert.equal(device.folderStands(AGENT.ORPHAN), true);
        yield* device.passed(3);

        assert.equal(device.folderStands(AGENT.ORPHAN), false);
        assert.deepEqual(device.keptRecorded(), []);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("a pass that died is reported, and the passes after it still run", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const device = yield* following({
        held: [AGENT.ORPHAN],
        reads: [[], []],
        firstReadDies: true,
      });
      // Note that the pass that died read nothing, so the two reads are the two passes after it.
      yield* device.passed(2);

      assert.equal(device.folderStands(AGENT.ORPHAN), false);
      assert.ok(device.reported.some((line) => line.includes("failed")));
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a Mac takes as its own, as its gate opens, an agent its state says it ran but never recorded, and never one only the folders it shares hold",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = yield* following({
          held: [AGENT.FROM_BEFORE, AGENT.OTHER_INSTALL],
          madeBeforeRecord: [AGENT.FROM_BEFORE],
          unowned: [AGENT.OTHER_INSTALL],
          mac: true,
          reads: [[AGENT.FROM_BEFORE, AGENT.OTHER_INSTALL]],
        });
        yield* device.passed(1);

        assert.deepEqual(device.ownedRecorded(), [AGENT.FROM_BEFORE]);
        assert.equal(device.folderStands(AGENT.FROM_BEFORE), true);
        assert.equal(device.folderStands(AGENT.OTHER_INSTALL), true);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a Linux host takes as its own, as its gate opens, every agent with a folder there, its agents' folders its own alone",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = yield* following({
          held: [AGENT.FROM_BEFORE],
          madeBeforeRecord: [AGENT.FROM_BEFORE],
          storesOwned: true,
          reads: [[AGENT.FROM_BEFORE]],
        });
        yield* device.passed(1);

        assert.deepEqual(device.ownedRecorded(), [AGENT.FROM_BEFORE]);
        assert.equal(device.folderStands(AGENT.FROM_BEFORE), true);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a pass clears an idle agent's folder a week after its last use, its work all on GitHub and its agent still this machine's, but one from before the stamp not until a week after the start that stamps it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const [used, fromBefore] = [agentNumbered(1), agentNumbered(2)];
        const listed = [used, fromBefore];
        const device = yield* following({
          held: listed,
          used: { [used]: A_WEEK_BY_THE_THIRD_PASS },
          // Note that its folder last changed long before the clock starts, which dates nothing.
          changedAt: { [fromBefore]: USED_OVER_A_WEEK_AGO },
          reads: [listed, listed, listed],
        });
        yield* device.passed(2);

        assert.equal(device.folderStands(used), true);
        yield* device.passed(3);

        assert.equal(device.folderStands(used), false);
        assert.equal(device.folderStands(fromBefore), true);
        assert.deepEqual(device.ownedRecorded(), listed);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a pass never clears the folder of an agent unused for a week whose launch is still kept, nor one with unpushed work, which it checks once while that agent stays idle",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const listed = [AGENT.LAUNCH_KEPT, AGENT.UNSAVED];
        const device = yield* following({
          held: listed,
          used: {
            [AGENT.LAUNCH_KEPT]: USED_OVER_A_WEEK_AGO,
            [AGENT.UNSAVED]: USED_OVER_A_WEEK_AGO,
          },
          keptLaunches: [
            { id: "4d5e6f70-8192-4a3b-8c4d-5e6f7a8b9c0d", agentId: AGENT.LAUNCH_KEPT },
          ],
          unsavedWork: { [AGENT.UNSAVED]: "it has commits on no remote branch\n" },
          reads: [listed, listed],
        });
        yield* device.passed(2);

        assert.equal(device.folderStands(AGENT.LAUNCH_KEPT), true);
        assert.equal(device.folderStands(AGENT.UNSAVED), true);
        assert.equal(device.checksRun(), 1);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);
