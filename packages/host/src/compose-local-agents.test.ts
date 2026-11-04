/**
 * compose-local-agents.test.ts -- the follower as the operating system sees it run agents straight on the box: a device registered as direct, signed in to nothing, getting ready while it fetches its CLIs and ready to take an agent only once it has them, or why it could not have them, an agent launched on the box with a GitHub token from the service in gh's config in its home, and a launch whose claim's answer was lost claimed again and launched once.
 *
 * The follower runs over a scripted spawner, a file system that holds
 * nothing but what a test names, and a fake service that hands one launch line and a new GitHub
 * token at each ask, answers each claim as a test says, its first answer
 * lost where it says, and whose beat answers the launches it holds the
 * device to, on the test's clock. The device beats on time whatever an
 * answer sets off, a settle slower than a beat and a beat never answered
 * among it, and converges to that answer on every beat: a launch it runs
 * nothing for is settled, again where the settle was not taken, a runner
 * whose launch is no longer named is stopped as a stop line stops it, its
 * process group killed, and neither a launch claimed after the beat was
 * sent nor one still starting is touched; and a runner's GitHub token is renewed by its age on the wall
 * clock. A host updating itself (`daemon/host-update.ts`) runs on the
 * machine's own file system and processes in a releases folder of its own,
 * its release's tarball answered in place of GitHub, and switches only
 * once the device is idle. Synthetic ids and tokens throughout.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import type { DeviceAgentClaimedLine, DeviceAgentDevice, DeviceAgentUpdate } from "@repo/features";
import { CHECKOUT_IDENTITY_SCRIPT } from "@repo/features/checkout-identity";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  DEVICE_SETUP,
  type DeviceAgentLine,
  type DeviceAgentRelease,
  deviceAgentLayout,
  HOST_UPDATE,
} from "@repo/features/device-agent-wire";
import { HOST_TARGET, hostTarballUrl } from "@repo/features/host-release";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Clock, ConfigProvider, Deferred, Duration, Effect, Layer } from "effect";
import * as FileSystem from "effect/FileSystem";
import { systemError } from "effect/PlatformError";
import { TestClock } from "effect/testing";
import { composeLocalAgents, type LocalAgentsUpdate } from "./compose-local-agents.js";
import { hostUpdate } from "./daemon/host-update.js";
import {
  Environment,
  type LocalAgentClis,
  LocalAgentClisUnavailable,
  LocalAgentPlatform,
  Reporter,
} from "./effect/seams.js";
import { fakeClis } from "./testing/fake-clis.js";
import { type Script, scriptedSpawner } from "./testing/scripted-spawner.js";

const HOME = "/Users/dev";
const AGENT_ID = "6f1c2a4e-0b7d-4c55-9a3e-2d8f61b0c9a1";
const LINE_ID = "0e9b7c1d-5a2f-4e63-8b40-7c1d2e3f4a5b";
/** A launch the service holds the device to that this run of the follower never claimed. */
const GONE_LINE_ID = "3c5d7e9f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const STATE_ROOT = "/Users/dev/Library/Application Support/Vespin";
const LAYOUT = deviceAgentLayout(HOME, AGENT_ID);
const SECRET_ENV = { APP_RUNNER_TOKEN: "runner-secret" };
/** The runner's own start on the box, as the platform launches it. */
const RUNNER = "/opt/vespin-host/node/bin/node";
/** Where the agent's gh keeps its sign-in, which the follower writes the agent's GitHub token into. */
const GH_HOSTS = `${LAYOUT.folder}/home/.config/gh/hosts.yml`;
const CLIS = fakeClis();
const IDENTITY = { name: "Ada Lovelace", email: "7001+ada@users.noreply.github.com" };

const LAUNCH: DeviceAgentClaimedLine = {
  line: {
    id: LINE_ID,
    agentId: AGENT_ID,
    seq: 1,
    kind: DEVICE_AGENT_LINE_KIND.LAUNCH,
    payload: {
      checkoutPath: LAYOUT.checkoutPath,
      repository: "acme/relay",
      startBranch: null,
      firstSequence: 0,
      identity: IDENTITY,
    },
  },
  secrets: { env: SECRET_ENV, stdin: "{}\n" },
};

/** The clock nudged until the condition holds, as the follower's fibers run up to their next wait. */
const until = (holds: () => boolean) =>
  Effect.gen(function* () {
    for (let round = 0; round < 200 && !holds(); round += 1) {
      yield* TestClock.adjust(Duration.zero);
    }
    assert.ok(holds(), "the follower never got there");
  });

/**
 * The follower on a host whose agents run straight on the box, with its
 * CLIs ready once `ready` succeeds; one launch line is handed. With what it
 * registered, spawned, asked, settled, and reported.
 */
const followingDevice = (
  ready: LocalAgentClis["ready"],
  options: {
    /** How the service answers each claim of the launch line, by the token it carries; the line with its secrets where not given. */
    readonly claim?: (
      token: string | undefined,
    ) => Effect.Effect<DeviceAgentClaimedLine | { readonly claimed: false } | undefined>;
    /** The lines the service hands, once, after `linesAfter`; the one launch where none are named. */
    readonly lines?: readonly DeviceAgentLine[];
    readonly linesAfter?: Duration.Input;
    /** The runner runs until its process group is killed, rather than ending by itself a second in. */
    readonly runsUntilSignaled?: boolean;
    /** How long making the agent's repository takes, no time where none is named. */
    readonly worktreeTakes?: Duration.Input;
    /** Making the agent's repository fails, as a clone that cannot be fetched does. */
    readonly worktreeFails?: boolean;
    /** The clock the follower reads, the test's own where none is named. */
    readonly clock?: Clock.Clock;
    /** The host's update of itself, as a host's daemon hands it. */
    readonly update?: LocalAgentsUpdate;
    /** How long making a folder in the agent's own takes, as a files line's write makes one, none where none is named. */
    readonly writingTakes?: Duration.Input;
  } = {},
) =>
  Effect.gen(function* () {
    const files = new Map<string, string>();
    let minted = 0;
    const signal = yield* Deferred.make<void>();
    const runner: Script =
      options.runsUntilSignaled === true
        ? // Note that the runner ends as its group is signaled, as the runner on a SIGTERM does.
          {
            exitCode: 143,
            until: Deferred.await(signal),
            killed: Deferred.succeed(signal, undefined),
          }
        : // Note that the runner ends by itself a second in, so the test's end has no runner to wait out.
          { exitCode: 0, after: Duration.seconds(1) };
    const spawner = scriptedSpawner((program, args) => {
      if (program === "/bin/bash" && args[0] === "-l")
        return { stdout: "/usr/bin:/bin", exitCode: 0 };
      if (program === "/bin/bash" && args[1] === "exit 0")
        return {
          exitCode: options.worktreeFails === true ? 1 : 0,
          after: options.worktreeTakes ?? Duration.zero,
        };
      if (program === "/bin/bash") return { exitCode: 0 };
      if (program === RUNNER) return runner;
      return undefined;
    });
    const registered: DeviceAgentDevice[] = [];
    const asked: string[] = [];
    const beats: number[] = [];
    /** What each beat said of the host's update, none where it named none. */
    const said: (DeviceAgentUpdate | undefined)[] = [];
    const reported: string[] = [];
    const settled: { id: string; exitCode?: number }[] = [];
    /**
     * The service as the test steers it: the launches it holds the device
     * to, which a claim adds and a settle it takes removes; how many settles
     * it refuses next, and the ids of those it refused; how long a settle
     * takes to answer; how long a beat takes to answer, its answer read as
     * it was asked; and the release it names on each beat's answer, where it
     * publishes one newer.
     */
    const service = {
      held: new Set<string>(),
      refusing: 0,
      refused: [] as string[],
      settleTakes: Duration.zero as Duration.Input,
      beatTakes: Duration.zero as Duration.Input,
      release: undefined as DeviceAgentRelease | undefined,
    };
    let launched = false;
    const client = {
      register: (_deviceId: string, device: DeviceAgentDevice) =>
        Effect.sync(() => registered.push(device)).pipe(Effect.as(true)),
      beat: (_deviceId: string, updating?: DeviceAgentUpdate) =>
        Effect.gen(function* () {
          beats.push(registered.length);
          said.push(updating);
          const answer = { openLaunches: [...service.held] };
          const { release } = service;
          yield* Effect.sleep(service.beatTakes);
          return release === undefined ? answer : { ...answer, release };
        }),
      lines: () =>
        launched
          ? Effect.never
          : Effect.sync(() => {
              launched = true;
              return options.lines ?? [LAUNCH.line];
            }).pipe(Effect.delay(options.linesAfter ?? Duration.zero)),
      claimLine: (_deviceId: string, _id: string, token?: string) =>
        Effect.tap(
          options.claim === undefined ? Effect.succeed(LAUNCH) : options.claim(token),
          (answer) =>
            Effect.sync(() => {
              if (answer !== undefined && "line" in answer) service.held.add(answer.line.id);
            }),
        ),
      lineStep: () => Effect.succeed(true),
      settleLine: (_deviceId: string, id: string, exitCode?: number) =>
        Effect.andThen(
          Effect.sleep(service.settleTakes),
          Effect.sync(() => {
            if (service.refusing > 0) {
              service.refusing -= 1;
              service.refused.push(id);
              return false;
            }
            service.held.delete(id);
            settled.push({
              id,
              ...(exitCode === undefined ? undefined : { exitCode }),
            });
            return true;
          }),
        ),
      requests: () => Effect.never,
      claimRequest: () => Effect.succeed({ claimed: false as const }),
      answerRequest: () => Effect.succeed(true),
      githubToken: (agentId: string) =>
        Effect.sync(() => {
          asked.push(agentId);
          return `ghs_fixture_${asked.length}`;
        }),
    };
    const services = Layer.mergeAll(
      spawner.layer,
      NodePath.layer,
      FileSystem.layerNoop({
        exists: () => Effect.succeed(false),
        makeDirectory: (path) =>
          options.writingTakes !== undefined && path.startsWith(LAYOUT.folder)
            ? Effect.sleep(options.writingTakes)
            : Effect.void,
        chmod: () => Effect.void,
        readFileString: (path) => {
          const held = files.get(path);
          return held === undefined
            ? Effect.fail(
                systemError({
                  _tag: "NotFound",
                  module: "FileSystem",
                  method: "readFileString",
                  pathOrDescriptor: path,
                }),
              )
            : Effect.succeed(held);
        },
        writeFileString: (path, data) => Effect.sync(() => void files.set(path, data)),
        rename: (from, to) =>
          Effect.sync(() => {
            const held = files.get(from);
            files.delete(from);
            if (held !== undefined) files.set(to, held);
          }),
        remove: (path) => Effect.sync(() => void files.delete(path)),
      }),
      fakeHttpClientLayer(() => Promise.reject(new Error("this test fetches no tool"))),
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord({ HOME, SHELL: "/bin/bash" })),
      Layer.succeed(Reporter, { report: (line) => reported.push(line) }),
      Layer.succeed(LocalAgentPlatform, {
        launch: ({ node, env }) => ({ command: node, args: [], env }),
        tools: { node: RUNNER, claude: CLIS.paths.claude, codex: CLIS.paths.codex },
        clis: fakeClis(ready),
        runnerBundle: "/opt/agent/agent-runner/agent-runner.mjs",
        runnerEnv: {},
        deviceName: "Studio",
        deviceMachine: {},
        devicePlatform: DEVICE_PLATFORM.DARWIN,
        deviceArch: DEVICE_ARCH.ARM64,
        deviceCapabilities: [],
        worktreeScript: () => "exit 0",
      }),
    );
    const clock = options.clock ?? (yield* Clock.Clock);
    const composer = yield* composeLocalAgents({
      kernel: {
        stateRoot: STATE_ROOT,
        createId: () => `claim-${++minted}`,
      },
      deviceId: "device-1",
      switchedOn: Effect.succeed(true),
      client,
      update: options.update,
    }).pipe(Effect.provide(services), Effect.provideService(Clock.Clock, clock));
    yield* composer.lifetime.pipe(Effect.provideService(Clock.Clock, clock));
    return {
      registered,
      beats,
      said,
      spawned: spawner.spawned,
      asked,
      settled,
      service,
      files,
      reported,
    };
  });

it.effect(
  "a device registers on the CLIs it keeps and launches its agent on the box with a GitHub token from Vespin in gh's config, its commit identity and gh's helper set in its repository first, keeping the agent as one it made",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { registered, spawned, asked, files } = yield* followingDevice(() => Effect.void);
        yield* until(() => spawned.some((each) => each.program === RUNNER));

        assert.deepEqual(
          registered.map((each) => ({
            claudeExecutable: each.claudeExecutable,
            codexExecutable: each.codexExecutable,
          })),
          [{ claudeExecutable: CLIS.paths.claude, codexExecutable: CLIS.paths.codex }],
        );
        assert.deepEqual(asked, [AGENT_ID]);
        assert.ok(files.get(GH_HOSTS)?.includes('oauth_token: "ghs_fixture_1"'));
        // Note that the uninstall removes the agents this record names, and no other install's.
        assert.ok(
          files.has(`${STATE_ROOT}/owned-agents/${AGENT_ID}`),
          "the launch keeps the agent in the device's record of the agents it made",
        );
        const runner = spawned.find((each) => each.program === RUNNER);
        assert.equal(runner?.env?.APP_RUNNER_TOKEN, SECRET_ENV.APP_RUNNER_TOKEN);
        // Note that gh prefers a token in its environment to its config, so one there would never be renewed.
        assert.equal(runner?.env?.GH_TOKEN, undefined, "the runner's gh reads its config alone");
        // Note that the identity the launch carries is set in the agent's repository, as a cloud checkout sets it, beside gh's helper, before its runner starts.
        const identity = spawned.findIndex((each) =>
          each.args.some((arg) => arg.includes(CHECKOUT_IDENTITY_SCRIPT)),
        );
        assert.equal(spawned[identity]?.cwd, LAYOUT.checkoutPath);
        assert.equal(spawned[identity]?.env?.HOME, `${LAYOUT.folder}/home`);
        assert.equal(spawned[identity]?.env?.APP_GIT_NAME, IDENTITY.name);
        assert.equal(spawned[identity]?.env?.APP_GIT_EMAIL, IDENTITY.email);
        assert.equal(
          spawned[identity]?.env?.APP_GIT_CREDENTIAL_HELPER,
          `!'${CLIS.paths.gh}' auth git-credential`,
        );
        assert.ok(identity < spawned.findIndex((each) => each.program === RUNNER));
        yield* TestClock.adjust(Duration.seconds(1));
        yield* until(() => runner?.ended === "exited");
        // Note that a turn's end lets go of the token, which no turn reads any more.
        yield* until(() => !files.has(GH_HOSTS));
      }),
    ),
);

it.effect(
  "a device fetching its CLIs registers as getting ready once and beats while it fetches, then registers ready and follows",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { registered, beats, spawned } = yield* followingDevice((preparing) =>
          Effect.andThen(preparing, Effect.sleep(Duration.minutes(3))),
        );
        yield* TestClock.adjust(Duration.seconds(5));
        yield* until(() => registered.length > 0);

        assert.deepEqual(
          registered.map((each) => each.setup),
          [DEVICE_SETUP.PREPARING],
        );
        yield* TestClock.adjust(Duration.minutes(2));
        assert.equal(
          spawned.some((each) => each.program === RUNNER),
          false,
        );
        yield* TestClock.adjust(Duration.minutes(1));
        yield* until(() => spawned.some((each) => each.program === RUNNER));

        assert.deepEqual(
          registered.map((each) => each.setup),
          [DEVICE_SETUP.PREPARING, undefined],
        );
        // Note that it beat while preparing, so the menus kept it listed through the fetch.
        assert.ok(beats.filter((after) => after === 1).length >= 10, `beats ${beats.join(",")}`);
        yield* TestClock.adjust(Duration.seconds(1));
      }),
    ),
);

it.effect(
  "a device whose CLIs could not be had registers why and beats, taking no agent, and tries again on its own a minute later, until it registers ready",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let tries = 0;
        const { registered, beats, spawned, reported } = yield* followingDevice(() =>
          Effect.suspend(() => {
            tries += 1;
            return tries <= 2
              ? Effect.fail(
                  new LocalAgentClisUnavailable({ detail: "Codex couldn't be downloaded" }),
                )
              : Effect.void;
          }),
        );
        yield* until(() => reported.length > 0);
        yield* TestClock.adjust(Duration.seconds(50));

        assert.equal(tries, 1);
        assert.ok(beats.length >= 2, `beats ${beats.join(",")}`);
        assert.equal(
          spawned.some((each) => each.program === RUNNER),
          false,
        );
        yield* TestClock.adjust(Duration.seconds(10));
        yield* until(() => tries === 2);
        yield* TestClock.adjust(Duration.minutes(1));
        yield* until(() => spawned.some((each) => each.program === RUNNER));

        assert.deepEqual(
          registered.map((each) => [each.setup, each.setupFailure]),
          [
            [DEVICE_SETUP.FAILED, "Codex couldn't be downloaded"],
            [DEVICE_SETUP.FAILED, "Codex couldn't be downloaded"],
            [undefined, undefined],
          ],
        );
        assert.deepEqual(reported, [
          "the local agents' setup failed: Codex couldn't be downloaded",
          "the local agents' setup failed: Codex couldn't be downloaded",
        ]);
        yield* TestClock.adjust(Duration.seconds(1));
      }),
    ),
);

it.effect(
  "a launch whose claim landed but whose answer was lost is claimed again under the same token and launched once",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        // Note that the service takes the first claim and keeps its token, but its answer never arrives.
        let landed: string | undefined;
        const claims: (string | undefined)[] = [];
        const { spawned, settled } = yield* followingDevice(() => Effect.void, {
          claim: (token) =>
            Effect.sync(() => {
              claims.push(token);
              if (landed === undefined) {
                landed = token;
                return undefined;
              }
              return token !== undefined && token === landed ? LAUNCH : { claimed: false as const };
            }),
        });
        yield* until(() => claims.length === 1);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* until(() => spawned.some((each) => each.program === RUNNER));
        yield* TestClock.adjust(Duration.seconds(1));
        yield* until(() => settled.some((each) => each.id === LINE_ID));

        assert.equal(claims.length, 2);
        assert.equal(claims[1], claims[0], "the retry is the same claim");
        assert.equal(spawned.filter((each) => each.program === RUNNER).length, 1);
        assert.deepEqual(settled, [{ id: LINE_ID, exitCode: 0 }]);
      }),
    ),
);

it.effect(
  "a launch whose repository could not be made is settled unstarted and lets go of the GitHub token it was handed",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { spawned, settled, asked, files } = yield* followingDevice(() => Effect.void, {
          worktreeFails: true,
        });
        yield* until(() => settled.some((each) => each.id === LINE_ID));

        assert.deepEqual(asked, [AGENT_ID]);
        assert.deepEqual(settled, [{ id: LINE_ID, exitCode: 1 }]);
        assert.equal(files.has(GH_HOSTS), false, "the token stays readable with no turn running");
        assert.equal(
          spawned.some((each) => each.program === RUNNER),
          false,
        );
      }),
    ),
);

it.effect(
  "a launch whose claim was answered again with its secrets gone is settled as a runner gone and never started",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { spawned, settled } = yield* followingDevice(() => Effect.void, {
          claim: () => Effect.succeed({ line: LAUNCH.line, secretsGone: true as const }),
        });
        yield* until(() => settled.some((each) => each.id === LINE_ID));

        assert.deepEqual(settled, [{ id: LINE_ID }]);
        assert.equal(
          spawned.some((each) => each.program === RUNNER),
          false,
        );
      }),
    ),
);

/** The clock nudged on by whole beats, so each beat's answer is converged to. */
const beatsOn = (count: number) => TestClock.adjust(Duration.seconds(15 * count));

it.effect(
  "a launch the service holds the device to that it runs nothing for is settled as a runner gone, again on the next beat where the service did not take it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { service, settled } = yield* followingDevice(() => Effect.void, { lines: [] });
        service.held.add(GONE_LINE_ID);
        service.refusing = 1;
        yield* beatsOn(1);
        yield* until(() => service.refused.length === 1);
        yield* beatsOn(1);
        yield* until(() => settled.length > 0);

        assert.deepEqual(service.refused, [GONE_LINE_ID]);
        assert.deepEqual(settled, [{ id: GONE_LINE_ID }]);
      }),
    ),
);

it.effect("a settle that takes longer than a beat holds up none of the beats after it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { service, beats } = yield* followingDevice(() => Effect.void, { lines: [] });
      // Note that the device runs nothing for the launch the service holds it to, so a beat's answer has it settled, and each settle takes forty seconds.
      service.held.add(GONE_LINE_ID);
      service.settleTakes = Duration.seconds(40);
      yield* until(() => beats.length > 0);
      const before = beats.length;
      yield* beatsOn(3);
      yield* until(() => beats.length >= before + 3);
    }),
  ),
);

it.effect("a beat left unanswered is given up, so the next is sent on time", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { service, beats } = yield* followingDevice(() => Effect.void, { lines: [] });
      yield* until(() => beats.length > 0);
      yield* TestClock.adjust(Duration.seconds(1));
      const before = beats.length;
      // Note that every beat from here on is never answered, so only its deadline lets the next go.
      service.beatTakes = Duration.hours(1);
      yield* TestClock.adjust(Duration.seconds(14));
      yield* until(() => beats.length === before + 1);
      yield* beatsOn(1);
      yield* until(() => beats.length === before + 2);
    }),
  ),
);

it.effect(
  "a runner whose launch the service no longer names is stopped as a stop line stops it, its process group signaled and killed after a grace, and its exit settled",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { service, settled, spawned, reported } = yield* followingDevice(() => Effect.void, {
          runsUntilSignaled: true,
        });
        yield* until(() => spawned.some((each) => each.program === RUNNER));
        yield* beatsOn(1);
        const runner = spawned.find((each) => each.program === RUNNER);
        assert.equal(runner?.killed, undefined, "a runner the service holds it to runs on");

        service.held.delete(LINE_ID);
        yield* beatsOn(1);
        yield* until(() => settled.length > 0);

        assert.deepEqual(runner?.killed, { killSignal: "SIGTERM", forceKillAfterMillis: 3_000 });
        assert.equal(runner?.ended, "exited");
        assert.deepEqual(settled, [{ id: LINE_ID, exitCode: 143 }]);
        assert.deepEqual(reported, [
          "a local agent's runner was stopped, since the service no longer holds it here",
        ]);
      }),
    ),
);

it.effect("a runner claimed after the beat was sent is not stopped by that beat's answer", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { service, spawned, beats } = yield* followingDevice(() => Effect.void, {
        runsUntilSignaled: true,
        linesAfter: Duration.seconds(1),
      });
      // Note that the first beat is answered three seconds after it was read, by which time the launch was claimed.
      service.beatTakes = Duration.seconds(3);
      yield* until(() => beats.length > 0);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* until(() => spawned.some((each) => each.program === RUNNER));
      yield* TestClock.adjust(Duration.seconds(3));
      service.beatTakes = Duration.zero;
      yield* beatsOn(2);

      const runner = spawned.find((each) => each.program === RUNNER);
      assert.deepEqual([runner?.killed, runner?.ended], [undefined, "running"]);
    }),
  ),
);

it.effect(
  "a launch still starting, its repository not yet made, is not settled by a beat naming it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { service, settled, spawned } = yield* followingDevice(() => Effect.void, {
          worktreeTakes: Duration.seconds(40),
        });
        yield* until(() => service.held.has(LINE_ID));
        yield* beatsOn(2);

        assert.deepEqual([settled, service.refused], [[], []]);
        yield* TestClock.adjust(Duration.seconds(15));
        yield* until(() => spawned.some((each) => each.program === RUNNER));
        yield* TestClock.adjust(Duration.seconds(1));
        yield* until(() => settled.length > 0);
        assert.deepEqual(settled, [{ id: LINE_ID, exitCode: 0 }]);
      }),
    ),
);

it.effect(
  "a runner's GitHub token is renewed in gh's config once it is fifty minutes old by the wall clock, though the machine slept through the wait",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const test = yield* Clock.Clock;
        // Note that the wall clock runs ahead of the clock waits are armed on, as it does over a machine's sleep.
        const slept = { millis: 0 };
        const wall = () => test.currentTimeMillisUnsafe() + slept.millis;
        const clock: Clock.Clock = {
          currentTimeMillisUnsafe: wall,
          currentTimeMillis: Effect.sync(wall),
          currentTimeNanosUnsafe: () => BigInt(wall()) * 1_000_000n,
          currentTimeNanos: Effect.sync(() => BigInt(wall()) * 1_000_000n),
          monotonicTimeNanosUnsafe: () => test.monotonicTimeNanosUnsafe(),
          monotonicTimeNanos: test.monotonicTimeNanos,
          sleep: (duration) => test.sleep(duration),
        };
        const { asked, spawned, files } = yield* followingDevice(() => Effect.void, {
          runsUntilSignaled: true,
          clock,
        });
        yield* until(() => spawned.some((each) => each.program === RUNNER));
        yield* TestClock.adjust(Duration.minutes(1));
        assert.deepEqual(asked, [AGENT_ID], "a young token is not renewed");

        slept.millis = Duration.toMillis(Duration.minutes(50));
        yield* TestClock.adjust(Duration.minutes(1));
        yield* until(() => asked.length === 2);
        // Note that the renewal is written where the running agent's gh and git read it on every call.
        yield* until(() => files.get(GH_HOSTS)?.includes('oauth_token: "ghs_fixture_2"') === true);
      }),
    ),
);

/** The machine's own file system and processes, which a host's update runs on. */
const NODE = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

/** The version a host runs, and the newer one the service names. */
const RUNNING = "0.3.0";
const NEWER = "0.4.0";

/** The newer release's tarball, as CI packs one: its `vespin-host` command, which answers its version, under one `vespin-host/` folder. */
const newerTarball = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const scratch = yield* temporaryDirectoryScoped("host-tarball-");
  yield* fileSystem.makeDirectory(`${scratch}/vespin-host/bin`, { recursive: true });
  yield* fileSystem.writeFileString(
    `${scratch}/vespin-host/bin/vespin-host`,
    `#!/bin/sh\necho ${NEWER}\n`,
    { mode: 0o755 },
  );
  execFileSync("tar", ["-czf", `${scratch}/vespin-host.tar.gz`, "-C", scratch, "vespin-host"]);
  const archive = readFileSync(`${scratch}/vespin-host.tar.gz`);
  const sha256 = createHash("sha256").update(archive).digest("hex");
  const release: DeviceAgentRelease = {
    version: NEWER,
    sha256: { [HOST_TARGET.LINUX_X64]: sha256, [HOST_TARGET.LINUX_ARM64]: sha256 },
  };
  return { archive, release };
});

/**
 * A Linux host's update of itself, in a releases folder of the test's own
 * as the account install lays it out: `RUNNING` and an older release under
 * `versions/`, `current` naming `RUNNING`, and GitHub answering the newer
 * release's tarball with the bytes given. With every address it fetched.
 */
const updatingHost = (tarball: Uint8Array<ArrayBuffer>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const folder = yield* temporaryDirectoryScoped("host-releases-");
    for (const version of ["0.2.0", RUNNING]) {
      yield* fileSystem.makeDirectory(`${folder}/versions/${version}/bin`, { recursive: true });
    }
    yield* fileSystem.symlink(`versions/${RUNNING}`, `${folder}/current`);
    const fetched: string[] = [];
    const update = yield* hostUpdate({
      releases: { folder, running: RUNNING },
      version: RUNNING,
      target: HOST_TARGET.LINUX_X64,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NODE,
          fakeHttpClientLayer((url) => {
            fetched.push(url);
            return new Response(tarball);
          }),
          Layer.succeed(Reporter, { report: () => undefined }),
        ),
      ),
    );
    const current = fileSystem.readLink(`${folder}/current`);
    const versions = Effect.map(fileSystem.readDirectory(`${folder}/versions`), (names) =>
      [...names].sort(),
    );
    return { folder, update, fetched, current, versions };
  });

/** Waits until the condition holds, each round a read of the disk, so the update's own processes and file writes, which wait on no clock, finish meanwhile. */
const untilOnDisk = <E, R>(holds: Effect.Effect<boolean, E, R>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    for (let round = 0; round < 50_000; round += 1) {
      if (yield* holds) return;
      yield* Effect.ignore(fileSystem.exists("/"));
    }
    assert.fail("the update never got there");
  });

it.effect(
  "a host holding a newer release waits while an agent runs, and switches once it ends: current names the new release, the running one is kept, and older ones go",
  () =>
    Effect.gen(function* () {
      const { archive, release } = yield* newerTarball;
      const { update, fetched, current, versions } = yield* updatingHost(archive);
      const { service, spawned, said } = yield* followingDevice(() => Effect.void, {
        runsUntilSignaled: true,
        update: update.follower,
      });
      service.release = release;
      yield* until(() => spawned.some((each) => each.program === RUNNER));
      yield* untilOnDisk(update.follower.waiting);
      yield* beatsOn(2);
      // Note that a switch would hold up the beats it runs on, so the third is waited for on the disk.
      yield* untilOnDisk(Effect.sync(() => said.length >= 3));

      assert.deepEqual(fetched, [hostTarballUrl(NEWER, HOST_TARGET.LINUX_X64)]);
      assert.deepEqual(said.at(-1), { update: HOST_UPDATE.WAITING });
      assert.equal(yield* current, `versions/${RUNNING}`);

      service.held.delete(LINE_ID);
      yield* beatsOn(2);
      yield* untilOnDisk(Effect.map(current, (link) => link === `versions/${NEWER}`));

      assert.ok(said.some((each) => each?.update === HOST_UPDATE.UPDATING));
      assert.deepEqual(yield* versions, [RUNNING, NEWER]);
      yield* update.ended;
    }).pipe(Effect.scoped, Effect.provide(NODE)),
);

it.effect(
  "a launch claimed while a host holding a newer release looked idle keeps it on the release it runs, and the launch runs",
  () =>
    Effect.gen(function* () {
      const { archive, release } = yield* newerTarball;
      const { update, current } = yield* updatingHost(archive);
      // Note that the launch's claim is under way from the fourteenth second to the seventeenth, across the beat at the fifteenth.
      const { service, spawned, said, beats } = yield* followingDevice(() => Effect.void, {
        runsUntilSignaled: true,
        linesAfter: Duration.seconds(14),
        claim: () => Effect.delay(Effect.succeed(LAUNCH), Duration.seconds(3)),
        update: update.follower,
      });
      service.release = release;
      yield* untilOnDisk(update.follower.waiting);
      yield* TestClock.adjust(Duration.seconds(14));
      yield* TestClock.adjust(Duration.seconds(1));
      yield* TestClock.adjust(Duration.seconds(2));
      yield* until(() => spawned.some((each) => each.program === RUNNER));
      yield* beatsOn(1);
      yield* until(() => beats.length >= 3);

      assert.ok(said.every((each) => each?.update !== HOST_UPDATE.UPDATING));
      assert.equal(yield* current, `versions/${RUNNING}`);
      assert.equal(spawned.find((each) => each.program === RUNNER)?.ended, "running");
    }).pipe(Effect.scoped, Effect.provide(NODE)),
);

it.effect(
  "a newer release whose download does not match its SHA-256 has every beat say the update failed and why, leaves the releases as they were, and is fetched again about an hour later",
  () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { archive, release } = yield* newerTarball;
      const tampered = Uint8Array.from(archive);
      tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
      const { folder, update, fetched, current, versions } = yield* updatingHost(tampered);
      const { service, said } = yield* followingDevice(() => Effect.void, {
        lines: [],
        update: update.follower,
      });
      service.release = release;
      yield* untilOnDisk(Effect.map(update.follower.beating, (now) => now !== undefined));
      yield* beatsOn(1);

      assert.deepEqual(said.at(-1), {
        update: HOST_UPDATE.FAILED,
        updateFailure: `the ${NEWER} download did not match its SHA-256`,
      });
      assert.equal(yield* current, `versions/${RUNNING}`);
      assert.deepEqual(yield* versions, ["0.2.0", RUNNING]);
      assert.deepEqual([...(yield* fileSystem.readDirectory(folder))].sort(), [
        "current",
        "versions",
      ]);

      yield* TestClock.adjust(Duration.minutes(75));
      yield* untilOnDisk(Effect.sync(() => fetched.length === 2));
    }).pipe(Effect.scoped, Effect.provide(NODE)),
);

it.effect(
  "a line a host holding a newer release claimed keeps it on the release it runs while the line is being delivered",
  () =>
    Effect.gen(function* () {
      const { archive, release } = yield* newerTarball;
      const { update, current } = yield* updatingHost(archive);
      const files: DeviceAgentLine = {
        id: GONE_LINE_ID,
        agentId: AGENT_ID,
        seq: 1,
        kind: DEVICE_AGENT_LINE_KIND.FILES,
        payload: {
          files: [{ path: `${LAYOUT.folder}/home/notes.txt`, mode: 0o600, contents: "bm90ZXM=" }],
        },
      };
      // Note that the files line is claimed at once and its write takes an hour, across every beat the test sends.
      const { service, said } = yield* followingDevice(() => Effect.void, {
        lines: [files],
        claim: () => Effect.succeed({ line: files }),
        writingTakes: Duration.hours(1),
        update: update.follower,
      });
      service.release = release;
      yield* untilOnDisk(update.follower.waiting);
      yield* beatsOn(2);
      yield* untilOnDisk(Effect.sync(() => said.length >= 3));

      assert.ok(said.every((each) => each?.update !== HOST_UPDATE.UPDATING));
      assert.equal(yield* current, `versions/${RUNNING}`);
    }).pipe(Effect.scoped, Effect.provide(NODE)),
);
