/**
 * compose-local-agents.test.ts -- the follower as the operating system sees it run agents straight on the box: a device registered as direct, signed in to nothing, getting ready while it fetches its CLIs and ready to take an agent only once it has them, or why it could not have them, an agent launched on the box with a GitHub token from Luke in gh's config in its home, a launch whose claim's answer was lost claimed again and launched once, and, on This Mac alone, an agent that ran on the developer's own logins before refused with why.
 *
 * The follower runs over a scripted spawner, a file system that holds
 * nothing but what a test names, and a fake service that hands one launch line and a new GitHub
 * token at each ask, answers each claim as a test says, its first answer
 * lost where it says, and whose beat answers the launches it holds the
 * device to, on the test's clock. The device converges to that answer on
 * every beat: a launch it runs nothing for is settled, a settle not taken
 * is asked again, a runner whose launch is no longer named is stopped as a
 * stop line stops it, its process group killed, and neither a launch
 * claimed after the beat was sent nor one still starting is touched; a
 * launch kept from a run that ended is settled; and a runner's GitHub token is renewed by its age on the wall
 * clock. Synthetic ids and tokens throughout.
 */

import assert from "node:assert/strict";
import { NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import type { DeviceAgentClaimedLine, DeviceAgentDevice } from "@luke/features";
import { CHECKOUT_IDENTITY_SCRIPT } from "@luke/features/checkout-identity";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_ARCH,
  DEVICE_ISOLATION,
  DEVICE_LAUNCH_REFUSAL,
  DEVICE_PLATFORM,
  DEVICE_SETUP,
  type DeviceAgentLine,
  type DeviceLaunchRefusal,
  deviceAgentLayout,
} from "@luke/features/device-agent-wire";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Clock, ConfigProvider, Deferred, Duration, Effect, Layer } from "effect";
import * as FileSystem from "effect/FileSystem";
import { systemError } from "effect/PlatformError";
import { TestClock } from "effect/testing";
import { composeLocalAgents } from "./compose-local-agents.js";
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
const USER_ID = "user-fixture";
/** A launch the service holds the device to that this run of the follower never claimed. */
const GONE_LINE_ID = "3c5d7e9f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const GONE_AGENT_ID = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
const STATE_ROOT = "/Users/dev/Library/Application Support/Luke";
const LAYOUT = deviceAgentLayout(HOME, AGENT_ID);
const SECRET_ENV = { LUKE_RUNNER_TOKEN: "runner-secret" };
/** The runner's own start on the box, as the platform launches it. */
const RUNNER = "/opt/luke-host/node/bin/node";
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

/** Every follower a test started, by the files it was handed, so each mints a lease holder of its own. */
const holders: Map<string, string>[] = [];

/** The clock nudged until the condition holds, as the follower's fibers run up to their next wait. */
const until = (holds: () => boolean) =>
  Effect.gen(function* () {
    for (let round = 0; round < 200 && !holds(); round += 1) {
      yield* TestClock.adjust(Duration.zero);
    }
    assert.ok(holds(), "the follower never got there");
  });

/**
 * The follower on a device whose agents run straight on the box, This Mac
 * unless `formerlyDirect` says it is a host, with its CLIs ready once
 * `ready` succeeds; one launch line is handed. `madeBare` says the agent's
 * checkout already stands, as a launch from before the record left it.
 * With what it registered, spawned, asked, settled, and reported.
 */
const followingDevice = (
  ready: LocalAgentClis["ready"],
  options: {
    readonly madeBare?: boolean;
    readonly formerlyDirect?: boolean;
    /** The service refuses a register naming a setup, as one from before the field does. */
    readonly refusesSetup?: boolean;
    /** The files of the machine's state, shared with another follower on the same machine where given. */
    readonly files?: Map<string, string>;
    /** How the service answers each claim of the launch line, by the token it carries; the line with its secrets where not given. */
    readonly claim?: (
      token: string | undefined,
    ) => Effect.Effect<DeviceAgentClaimedLine | { readonly claimed: false } | undefined>;
    /** The lines the service hands, once, after `linesAfter`; the one launch where none are named. */
    readonly lines?: readonly DeviceAgentLine[];
    readonly linesAfter?: Duration.Input;
    /** The runner runs until its process group is killed, rather than ending by itself a second in. */
    readonly runsUntilSignalled?: boolean;
    /** How long making the agent's repository takes, no time where none is named. */
    readonly worktreeTakes?: Duration.Input;
    /** Making the agent's repository fails, as a clone that cannot be fetched does. */
    readonly worktreeFails?: boolean;
    /** The service's beat names no open launches, as one from before the list does. */
    readonly listsNoLaunches?: boolean;
    /** The clock the follower reads, the test's own where none is named. */
    readonly clock?: Clock.Clock;
  } = {},
) =>
  Effect.gen(function* () {
    const files = options.files ?? new Map<string, string>();
    holders.push(files);
    let minted = 0;
    const signal = yield* Deferred.make<void>();
    const runner: Script =
      options.runsUntilSignalled === true
        ? // Note that the runner ends as its group is signalled, as the runner on a SIGTERM does.
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
    const reported: string[] = [];
    const settled: { id: string; exitCode?: number; refusal?: DeviceLaunchRefusal }[] = [];
    /**
     * The service as the test steers it: the launches it holds the device
     * to, which a claim adds and a settle it takes removes; how many settles
     * it refuses next, and the ids of those it refused; and how long a beat
     * takes to answer, its answer read as it was asked.
     */
    const service = {
      held: new Set<string>(),
      refusing: 0,
      refused: [] as string[],
      beatTakes: Duration.zero as Duration.Input,
    };
    let launched = false;
    const client = {
      register: (_deviceId: string, device: DeviceAgentDevice) =>
        Effect.sync(() => registered.push(device)).pipe(
          Effect.as(options.refusesSetup !== true || device.setup === undefined),
        ),
      beat: () =>
        Effect.gen(function* () {
          beats.push(registered.length);
          const answer =
            options.listsNoLaunches === true ? {} : { openLaunches: [...service.held] };
          yield* Effect.sleep(service.beatTakes);
          return answer;
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
      settleLine: (
        _deviceId: string,
        id: string,
        exitCode?: number,
        refusal?: DeviceLaunchRefusal,
      ) =>
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
            ...(refusal === undefined ? undefined : { refusal }),
          });
          return true;
        }),
      requests: () => Effect.never,
      claimRequest: () => Effect.succeed({ claimed: false as const }),
      answerRequest: () => Effect.succeed(true),
      liveAgents: () => Effect.succeed(undefined),
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
        exists: (path) => Effect.succeed(options.madeBare === true && path === LAYOUT.checkoutPath),
        makeDirectory: () => Effect.void,
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
        link: (from, to) => {
          const held = files.get(from);
          return held === undefined || files.has(to)
            ? Effect.fail(
                systemError({
                  _tag: "AlreadyExists",
                  module: "FileSystem",
                  method: "link",
                  pathOrDescriptor: to,
                }),
              )
            : Effect.sync(() => void files.set(to, held));
        },
      }),
      fakeHttpClientLayer(() => Promise.reject(new Error("this test fetches no tool"))),
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord({ HOME, SHELL: "/bin/bash" })),
      Layer.succeed(Reporter, { report: (line) => reported.push(line) }),
      Layer.succeed(LocalAgentPlatform, {
        launch: ({ node, env }) => ({ command: node, args: [], env }),
        tools: { node: RUNNER, claude: CLIS.paths.claude, codex: CLIS.paths.codex },
        clis: fakeClis(ready),
        formerlyDirect: options.formerlyDirect ?? true,
        storesOwned: false,
        runnerBundle: "/opt/luke/agent-runner.mjs",
        runnerEnv: {},
        deviceName: "Studio",
        devicePlatform: DEVICE_PLATFORM.DARWIN,
        deviceArch: DEVICE_ARCH.ARM64,
        deviceIsolation: DEVICE_ISOLATION.DIRECT,
        deviceCapabilities: [],
        worktreeScript: () => "exit 0",
      }),
    );
    const clock = options.clock ?? (yield* Clock.Clock);
    const composer = yield* composeLocalAgents({
      kernel: {
        stateRoot: STATE_ROOT,
        // Note that each follower mints its own lease holder first, then the account's device id.
        createId: () => (minted++ === 0 ? `holder-${holders.length}` : "device-1"),
        runMode: { sendsNetwork: true },
      },
      account: { capabilitiesActive: () => true },
      accountId: () => USER_ID,
      switchedOn: Effect.succeed(true),
      client,
    }).pipe(Effect.provide(services), Effect.provideService(Clock.Clock, clock));
    yield* composer.lifetime.pipe(Effect.provideService(Clock.Clock, clock));
    return {
      registered,
      beats,
      spawned: spawner.spawned,
      asked,
      settled,
      service,
      files,
      reported,
    };
  });

it.effect(
  "a device registers as direct on the CLIs it keeps, signed in to nothing, and launches its agent on the box with a GitHub token from Luke in gh's config, its commit identity and gh's helper set in its repository first, keeping the agent as one it made",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { registered, spawned, asked, files } = yield* followingDevice(() => Effect.void);
        yield* until(() => spawned.some((each) => each.program === RUNNER));

        // Note that no login of the device's is what its agents run on, so the service pays with the sign-in saved in Luke, or refuses.
        assert.deepEqual(
          registered.map((each) => ({
            isolation: each.isolation,
            claudeExecutable: each.claudeExecutable,
            codexExecutable: each.codexExecutable,
            signedIn: each.signedIn,
          })),
          [
            {
              isolation: DEVICE_ISOLATION.DIRECT,
              claudeExecutable: CLIS.paths.claude,
              codexExecutable: CLIS.paths.codex,
              signedIn: { claudeCode: false, codex: false },
            },
          ],
        );
        assert.deepEqual(asked, [AGENT_ID]);
        assert.ok(files.get(GH_HOSTS)?.includes('oauth_token: "ghs_fixture_1"'));
        // Note that the uninstall removes the agents this record names, and no other Luke install's.
        assert.ok(
          files.has(`${STATE_ROOT}/owned-agents/${AGENT_ID}`),
          "the launch keeps the agent in the device's record of the agents it made",
        );
        const runner = spawned.find((each) => each.program === RUNNER);
        assert.equal(runner?.env?.LUKE_RUNNER_TOKEN, SECRET_ENV.LUKE_RUNNER_TOKEN);
        // Note that gh prefers a token in its environment to its config, so one there would never be renewed.
        assert.equal(runner?.env?.GH_TOKEN, undefined, "the runner's gh reads its config alone");
        // Note that the identity the launch carries is set in the agent's repository, as a cloud checkout sets it, beside gh's helper, before its runner starts.
        const identity = spawned.findIndex((each) =>
          each.args.some((arg) => arg.includes(CHECKOUT_IDENTITY_SCRIPT)),
        );
        assert.equal(spawned[identity]?.cwd, LAYOUT.checkoutPath);
        assert.equal(spawned[identity]?.env?.HOME, `${LAYOUT.folder}/home`);
        assert.equal(spawned[identity]?.env?.LUKE_GIT_NAME, IDENTITY.name);
        assert.equal(spawned[identity]?.env?.LUKE_GIT_EMAIL, IDENTITY.email);
        assert.equal(
          spawned[identity]?.env?.LUKE_GIT_CREDENTIAL_HELPER,
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
  "a device whose getting-ready register a service refuses beats nothing while it fetches, so its earlier ready row ages away, then registers ready",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { registered, beats, spawned } = yield* followingDevice(
          (preparing) => Effect.andThen(preparing, Effect.sleep(Duration.minutes(3))),
          { refusesSetup: true },
        );
        yield* TestClock.adjust(Duration.seconds(5));
        yield* until(() => registered.length > 0);
        yield* TestClock.adjust(Duration.minutes(3));
        yield* until(() => spawned.some((each) => each.program === RUNNER));

        assert.deepEqual(
          registered.map((each) => each.setup),
          [DEVICE_SETUP.PREPARING, undefined],
        );
        assert.deepEqual(
          beats.filter((after) => after === 1),
          [],
        );
        yield* TestClock.adjust(Duration.seconds(1));
      }),
    ),
);

it.effect(
  "a device whose CLIs could not be had registers why and beats, taking no agent, and tries again on its own after a wait that doubles, until it registers ready",
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
        // Note that the first wait is thirty seconds, give or take a fifth, so a twenty-second one has not ended it.
        yield* TestClock.adjust(Duration.seconds(20));

        assert.equal(tries, 1);
        assert.ok(beats.length >= 2, `beats ${beats.join(",")}`);
        assert.equal(
          spawned.some((each) => each.program === RUNNER),
          false,
        );
        yield* TestClock.adjust(Duration.seconds(20));
        yield* until(() => tries === 2);
        // Note that the second try came by thirty-six seconds in and its wait is doubled, sixty seconds give or take a fifth, so the third comes between seventy-two and a hundred and eight.
        yield* TestClock.adjust(Duration.seconds(30));
        assert.equal(tries, 2);
        yield* TestClock.adjust(Duration.seconds(40));
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
  "a device whose setup failed tries nothing again, and registers nothing, once another follower has taken the machine's lease",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let tries = 0;
        const files = new Map<string, string>();
        const { registered, reported } = yield* followingDevice(
          () =>
            Effect.suspend(() => {
              tries += 1;
              return Effect.fail(
                new LocalAgentClisUnavailable({ detail: "Codex couldn't be downloaded" }),
              );
            }),
          { files },
        );
        yield* until(() => tries === 1 && registered.length === 1);
        // Note that another follower's lease, renewed far ahead, stands for the whole test.
        const now = yield* Clock.currentTimeMillis;
        files.set(
          `${STATE_ROOT}/local-agents.lock`,
          JSON.stringify({ holder: "another-follower", renewedAt: now + 3_600_000 }),
        );
        yield* TestClock.adjust(Duration.seconds(10));
        yield* until(() =>
          reported.includes("this follower lost the machine's lease, so it stops"),
        );
        yield* TestClock.adjust(Duration.minutes(2));

        assert.deepEqual([tries, registered.length], [1, 1]);
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

it.effect(
  "an agent that ran on the developer's own logins on This Mac before is settled unstarted, naming why, and never started",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { spawned, settled, reported } = yield* followingDevice(() => Effect.void, {
          madeBare: true,
        });
        yield* until(() => settled.some((each) => each.id === LINE_ID));

        assert.deepEqual(settled, [
          { id: LINE_ID, exitCode: 1, refusal: DEVICE_LAUNCH_REFUSAL.RAN_DIRECTLY },
        ]);
        assert.equal(
          spawned.some((each) => each.program === RUNNER),
          false,
        );
        assert.deepEqual(reported, [
          "a local agent that ran on the developer's own logins on this Mac was not started, since its work is outside a folder of its own",
        ]);
      }),
    ),
);

it.effect(
  "a host, whose agents never ran on the developer's own logins, starts an agent whose checkout already stands",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { spawned, settled } = yield* followingDevice(() => Effect.void, {
          madeBare: true,
          formerlyDirect: false,
        });
        yield* until(() => spawned.some((each) => each.program === RUNNER));

        assert.equal(settled.length, 0);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* until(() => settled.some((each) => each.id === LINE_ID));
      }),
    ),
);

it.effect(
  "a second follower on the same machine follows nothing while the first holds its lease, and says why",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const files = new Map<string, string>();
        const first = yield* followingDevice(() => Effect.void, { files });
        yield* until(() => first.spawned.some((each) => each.program === RUNNER));
        const second = yield* followingDevice(() => Effect.void, { files });
        yield* until(() => second.reported.length > 0);
        yield* TestClock.adjust(Duration.seconds(30));

        assert.deepEqual(second.registered, []);
        assert.deepEqual(second.spawned, []);
        assert.deepEqual(second.reported, [
          "another follower runs this machine's local agents, so this one follows none",
        ]);
      }),
    ),
);

/** The ids of the launches the machine's state keeps. */
const keptLaunches = (files: Map<string, string>) => {
  const text = files.get(`${STATE_ROOT}/local-agents.json`);
  return text === undefined
    ? []
    : (JSON.parse(text) as { launches: { id: string }[] }).launches.map((each) => each.id);
};

/** The clock nudged on by whole beats, so each beat's answer is converged to. */
const beatsOn = (count: number) => TestClock.adjust(Duration.seconds(15 * count));

it.effect(
  "a runner's exit the service did not take is settled again on every beat, with its exit code, until it is taken, and only then let go of",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { service, settled, files, spawned } = yield* followingDevice(() => Effect.void);
        service.refusing = 2;
        yield* until(() => spawned.some((each) => each.program === RUNNER));
        yield* TestClock.adjust(Duration.seconds(1));
        yield* until(() => service.refused.length === 1);

        assert.deepEqual(keptLaunches(files), [LINE_ID]);
        yield* beatsOn(1);
        yield* until(() => service.refused.length === 2);
        assert.deepEqual(settled, []);
        yield* beatsOn(1);
        yield* until(() => settled.length > 0);

        assert.deepEqual(settled, [{ id: LINE_ID, exitCode: 0 }]);
        yield* until(() => keptLaunches(files).length === 0);
      }),
    ),
);

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

it.effect(
  "a runner whose launch the service no longer names is stopped as a stop line stops it, its process group signalled and killed after a grace, and its exit settled",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { service, settled, spawned, reported } = yield* followingDevice(() => Effect.void, {
          runsUntilSignalled: true,
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
        runsUntilSignalled: true,
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

it.effect("after a restart, a launch kept from the run before is settled as a runner gone", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const files = new Map([
        [
          `${STATE_ROOT}/local-agents.json`,
          `${JSON.stringify({
            devices: { [USER_ID]: "device-1" },
            launches: [{ userId: USER_ID, id: GONE_LINE_ID, agentId: GONE_AGENT_ID }],
          })}\n`,
        ],
      ]);
      const { settled } = yield* followingDevice(() => Effect.void, { files, lines: [] });
      yield* until(() => settled.length > 0);

      assert.deepEqual(settled, [{ id: GONE_LINE_ID }]);
      assert.deepEqual(keptLaunches(files), []);
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
          runsUntilSignalled: true,
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

it.effect(
  "a service whose beat names no open launches has the device stop and settle nothing by it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { service, settled, spawned } = yield* followingDevice(() => Effect.void, {
          runsUntilSignalled: true,
          listsNoLaunches: true,
        });
        yield* until(() => spawned.some((each) => each.program === RUNNER));
        service.held.clear();
        service.held.add(GONE_LINE_ID);
        yield* beatsOn(3);

        const runner = spawned.find((each) => each.program === RUNNER);
        assert.deepEqual([runner?.killed, settled, service.refused], [undefined, [], []]);
        assert.equal(runner?.ended, "running");
      }),
    ),
);

it.effect(
  "a kept launch the service no longer lists, as a stop queued after it hides it, is settled again until the service takes it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { service, settled, spawned } = yield* followingDevice(() => Effect.void);
        yield* until(() => spawned.some((each) => each.program === RUNNER));
        service.refusing = 2;
        yield* TestClock.adjust(Duration.seconds(1));
        yield* until(() => service.refused.length === 1);
        service.held.delete(LINE_ID);
        yield* beatsOn(1);
        yield* until(() => service.refused.length === 2);
        yield* beatsOn(1);
        yield* until(() => settled.length > 0);

        assert.deepEqual(settled, [{ id: LINE_ID, exitCode: 0 }]);
      }),
    ),
);
